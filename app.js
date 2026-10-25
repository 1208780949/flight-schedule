import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, serverTimestamp, runTransaction,
  getDocsFromServer,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from './firebase.js';
import { REGIONS, regionName, esc, progress, normaliseTrip, canActivate, describeRoute, grouped, airlineName } from './domain.mjs';
import { assignNumbers, comboKey, tripTitle, validNumber } from './numbering.mjs';
import { installLegKeyboardNavigation } from './leg-keyboard.mjs';
import { installLegReordering } from './leg-reorder.mjs';
import { inspectArchive, validateArchive, validateArchivedTrip } from './archive-integrity.mjs';
import { cleanGroups, createGroup, renameGroup, deleteGroup, moveType, assignedGroup, matchesAircraft, UNGROUPED } from './aircraft-groups.mjs';
import { validateTripSequence, firstUpcomingLeg, validateCompletionUpdate, blankLegAfter } from './trip-validation.mjs';
import { fitRouteSummary } from './route-summary.mjs';

const firebase = initializeApp(firebaseConfig);
const auth = getAuth(firebase);
const db = getFirestore(firebase);
const $ = id => document.getElementById(id);
const state = { numberingBusy:false, user: null, unsubscribe: null, unsubscribeGroups: null, trips: [], groups: [], loading: true, view: 'planned', region: 'all', aircraft: 'all', aircraftGroup: null, collapsedGroups: new Set(), airline: 'all', modalTripId: null, editorLegs: [] };
const views = {
  planned: ['PLANNING', 'Flight planning', 'Build and organise itineraries for every aircraft type.', 'Planned itineraries'],
  active: ['ACTIVE FLIGHTS', 'Active trips', 'One active itinerary per region. Track progress leg by leg.', 'Currently flying'],
  archived: ['ARCHIVE', 'Flight archive', 'Your history of completed trips and flight legs.', 'Completed itineraries'],
};
let toastTimer;
function toast(message, error = false) {
  const box = $('toast'); box.textContent = message; box.className = `toast${error ? ' error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => box.classList.add('hidden'), 6500);
}
function errorMessage(error) {
  const codes = {
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/too-many-requests': 'Too many attempts. Try again later.',
    'permission-denied': 'Permission denied. Publish firestore.rules in Firebase Console → Firestore → Rules.',
    'unavailable': 'Cannot contact Firestore. Check the internet connection.',
  };
  return codes[error.code] || error.message || String(error);
}
function getTrip(id) { return state.trips.find(t => t.id === id); }
function tripsRef() { return collection(db, 'users', state.user.uid, 'trips'); }
function tripRef(id) { return doc(db, 'users', state.user.uid, 'trips', id); }
function slotRef(region) { return doc(db, 'users', state.user.uid, 'activeSlots', region); }
function numberingRef() { return doc(db, 'users', state.user.uid, 'metadata', 'numbering'); }
function groupsRef() { return doc(db, 'users', state.user.uid, 'settings', 'aircraftGroups'); }

// Local presentation preference only; group membership remains synced via Firestore.
function collapsedStorageKey(uid) { return `flight-planner-collapsed-groups-${uid}`; }
function loadCollapsedGroups(uid) {
  try {
    const ids=JSON.parse(localStorage.getItem(collapsedStorageKey(uid))||'[]');
    return new Set(Array.isArray(ids)?ids.filter(id=>typeof id==='string'):[]);
  } catch { return new Set(); }
}
function toggleGroupCollapsed(id) {
  if(state.collapsedGroups.has(id)) state.collapsedGroups.delete(id);
  else state.collapsedGroups.add(id);
  try { localStorage.setItem(collapsedStorageKey(state.user.uid),JSON.stringify([...state.collapsedGroups])); }
  catch { /* Private-browsing storage can be unavailable; collapsing still works this session. */ }
  render();
}

onAuthStateChanged(auth, (user) => {
  if (state.unsubscribe) { state.unsubscribe(); state.unsubscribe = null; }
  if (state.unsubscribeGroups) { state.unsubscribeGroups(); state.unsubscribeGroups = null; }
  state.user = user; state.trips = []; state.groups = []; state.loading = true; state.aircraft = 'all'; state.aircraftGroup = null; state.collapsedGroups = user ? loadCollapsedGroups(user.uid) : new Set(); state.airline = 'all'; closeModal();
  $('authScreen').classList.toggle('hidden', !!user);
  $('mainApp').classList.toggle('hidden', !user);
  if (!user) return;
  $('accountEmail').textContent = user.email || 'Signed in';
  $('connectionStatus').textContent = 'Connecting to Firestore…';
  state.unsubscribeGroups = onSnapshot(groupsRef(), snapshot => {
    try { state.groups = cleanGroups(snapshot.exists() ? snapshot.data().groups : []); render(); }
    catch (error) { toast(`Cannot load aircraft groups: ${errorMessage(error)}`, true); }
  }, error => toast(`Aircraft group sync failed: ${errorMessage(error)}`, true));
  state.unsubscribe = onSnapshot(tripsRef(), snapshot => {
    state.loading = false;
    state.trips = snapshot.docs.map(x => ({ ...x.data(), id: x.id }));
    $('connectionStatus').textContent = snapshot.metadata.fromCache ? 'Offline / cached data' : 'All changes synced';
    render();
    refreshDetailIfOpen();
    if (!snapshot.metadata.fromCache && state.trips.some(t => !validNumber(t.tripNumber) || t.title !== tripTitle(t))) void ensureNumbering();
  }, error => {
    state.loading = false; $('connectionStatus').textContent = 'Sync unavailable';
    $('board').innerHTML = `<div class="warning-box">${esc(errorMessage(error))}</div>`;
    toast(errorMessage(error), true);
  });
  render();
});

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault(); $('authError').textContent = ''; $('loginButton').disabled = true;
  try { await signInWithEmailAndPassword(auth, $('loginEmail').value.trim(), $('loginPassword').value); $('loginPassword').value = ''; }
  catch (err) { $('authError').textContent = errorMessage(err); }
  finally { $('loginButton').disabled = false; }
});
$('signOutButton').addEventListener('click', () => signOut(auth).catch(err => toast(errorMessage(err), true)));
$('newTripButton').addEventListener('click', () => openEditor(null, {region: state.region === 'all' ? 'north-america' : state.region}));
$('importButton').addEventListener('click', () => $('importFile').click());
$('exportButton').addEventListener('click', backup);
$('airlineFilter').addEventListener('change', e => { state.airline = e.target.value; render(); });
$('importFile').addEventListener('change', async e => {
  const file = e.target.files?.[0]; e.target.value = '';
  if (!file) return;
  try { await importFile(file); } catch (err) { toast(`Import failed: ${errorMessage(err)}`, true); }
});

// Route text is recalculated to fit the actual card width, including when the
// browser or a region column is resized. Never infer fit from character count.
const routeMeasureCanvas = document.createElement('canvas');
const routeMeasureContext = routeMeasureCanvas.getContext('2d');
const routeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
  for (const entry of entries) updateRouteSummary(entry.target);
});
function updateRouteSummary(element) {
  const trip=getTrip(element.dataset.routeTrip);
  if (!trip) return;
  const style=getComputedStyle(element);
  if (routeMeasureContext) routeMeasureContext.font=style.font;
  const measure=text=>routeMeasureContext ? routeMeasureContext.measureText(text).width : text.length*7.5;
  const width=element.getBoundingClientRect().width;
  if (width>0) element.textContent=fitRouteSummary(trip.legs,width,measure);
}
function watchRouteSummaries() {
  routeObserver?.disconnect();
  document.querySelectorAll('[data-route-trip]').forEach(element=>{
    updateRouteSummary(element);
    routeObserver?.observe(element);
  });
}
if (document.fonts?.ready) void document.fonts.ready.then(() => watchRouteSummaries());

function render() {
  const cfg = views[state.view];
  $('breadcrumbPage').textContent = cfg[0]; $('pageTitle').textContent = cfg[1]; $('pageSubtitle').textContent = cfg[2];
  $('boardTitle').textContent = cfg[3];
  for (const btn of document.querySelectorAll('[data-view]')) btn.classList.toggle('selected', btn.dataset.view === state.view);
  for (const status of ['planned', 'active', 'archived']) $('nav' + status[0].toUpperCase() + status.slice(1)).textContent = state.trips.filter(t => t.status === status).length;
  const counts = Object.fromEntries(['planned', 'active', 'archived'].map(s => [s, state.trips.filter(t => t.status === s).length]));
  const completedLegs = state.trips.reduce((n, t) => n + t.legs.filter(l => l.completed).length, 0);
  $('stats').innerHTML = [
    ['Planned trips', counts.planned, 'Itineraries ready to fly'],
    ['Active regions', `${counts.active} / 3`, 'Maximum one in each region'],
    ['Archived trips', counts.archived, 'Historical flight collections'],
    ['Flown legs', completedLegs, 'Legs marked as complete'],
  ].map(([label, value, desc]) => `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-description">${desc}</div></div>`).join('');
  const known = [...new Set(state.trips.map(t => t.aircraft))].sort((a,b) => a.localeCompare(b,undefined,{numeric:true}));
  if (state.aircraft !== 'all' && !known.includes(state.aircraft)) state.aircraft = 'all';
  if (state.aircraftGroup && state.aircraftGroup !== UNGROUPED && !state.groups.some(g=>g.id===state.aircraftGroup)) state.aircraftGroup = null;
  const countFor = type => state.trips.filter(t=>t.aircraft===type).length;
  const typeRow = a => `<div class="aircraft-type-row" draggable="true" data-drag-aircraft="${esc(a)}" title="Drag ${esc(a)} into another group"><span class="drag-handle" aria-hidden="true">⠿</span><button data-aircraft="${esc(a)}" class="aircraft-item aircraft-child ${state.aircraft===a?'selected':''}" title="Show trips for ${esc(a)}"><span>✈</span> ${esc(a)} <span class="aircraft-count">${countFor(a)}</span></button><button class="move-aircraft" data-move-aircraft="${esc(a)}" aria-label="Move ${esc(a)} into a group" title="Move to group">↗</button></div>`;
  const groupedTypes = new Set(state.groups.flatMap(g => g.types.map(t=>t.toLocaleLowerCase('en'))));
  const ungrouped = known.filter(a=>!groupedTypes.has(a.toLocaleLowerCase('en')));
  const renderFolder = (id,name,types,ungroupedFolder=false) => {
    const folderCount=types.reduce((total,a)=>total+countFor(a),0);
    const collapsed=state.collapsedGroups.has(id);
    return `<section class="aircraft-folder ${collapsed?'is-collapsed':''}" data-drop-group="${esc(id)}"><div class="folder-head"><button type="button" class="folder-toggle" data-toggle-group="${esc(id)}" aria-expanded="${!collapsed}" aria-controls="aircraft-children-${esc(id)}" aria-label="${collapsed?'Expand':'Collapse'} ${esc(name)}" title="${collapsed?'Show':'Hide'} aircraft types in ${esc(name)}">${collapsed?'▸':'▾'}</button><button data-group="${esc(id)}" class="aircraft-item folder-filter ${state.aircraftGroup===id&&state.aircraft==='all'?'selected':''}" title="Filter by ${esc(name)}">${esc(name)} <span class="aircraft-count">${folderCount}</span></button>${ungroupedFolder?'':`<button data-rename-group="${esc(id)}" class="folder-action" title="Rename ${esc(name)}" aria-label="Rename ${esc(name)}">✎</button><button data-delete-group="${esc(id)}" class="folder-action" title="Delete ${esc(name)} group (flights unchanged)" aria-label="Delete ${esc(name)} group">×</button>`}</div><div id="aircraft-children-${esc(id)}" class="folder-children" ${collapsed?'hidden':''}>${types.length?types.map(typeRow).join(''):`<div class="folder-drop-hint">Drag aircraft here</div>`}</div></section>`;
  };
  $('aircraftFilters').innerHTML = `<button data-aircraft="all" class="aircraft-item ${state.aircraft==='all' && !state.aircraftGroup?'selected':''}"><span>▦</span> All aircraft <span class="aircraft-count">${state.trips.length}</span></button>`+
    state.groups.map(g=>renderFolder(g.id,g.name,g.types.filter(a=>known.some(k=>k.toLocaleLowerCase('en')===a.toLocaleLowerCase('en'))))).join('')+
    renderFolder(UNGROUPED,'Ungrouped',ungrouped,true);
  $('regionFilters').innerHTML = [{id:'all',label:'All regions'},...REGIONS].map(r => `<button data-region="${r.id}" class="region-tab ${state.region === r.id ? 'selected' : ''}">${r.label}</button>`).join('');
  const airlines = [...new Set(state.trips.map(t => airlineName(t.airline)))].sort((a,b) => a.localeCompare(b));
  if (state.airline !== 'all' && !airlines.includes(state.airline)) state.airline = 'all';
  $('airlineFilter').innerHTML = '<option value="all">All airlines</option>' +
    airlines.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
  $('airlineFilter').value = state.airline;
  const visible = grouped(state.trips, state.view, 'all', state.region, state.airline).filter(t=>matchesAircraft(t.aircraft,state.aircraft,state.aircraftGroup,state.groups));
  $('boardCount').textContent = `${visible.length} ${visible.length === 1 ? 'trip' : 'trips'}`;
  if (state.loading) { $('board').innerHTML = '<div class="loading">Loading schedules from Firestore…</div>'; return; }
  const regions = REGIONS.filter(r => state.region === 'all' || state.region === r.id);
  $('board').innerHTML = `<div class="regions-grid ${regions.length === 1 ? 'single-region' : ''}">${regions.map(region => {
    const items = visible.filter(t => t.region === region.id).sort((a,b) => {
      const ai = a.updatedAt?.seconds || 0, bi = b.updatedAt?.seconds || 0;
      return a.title.localeCompare(b.title,undefined,{numeric:true,sensitivity:'base'}) || a.id.localeCompare(b.id);
    });
    return `<section class="region-column"><div class="region-heading"><span class="region-mark">${region.emblem}</span><h3>${region.label}</h3><small>${items.length} ${items.length === 1 ? 'trip':'trips'}</small></div><div class="cards-stack">${items.length ? items.map(renderCard).join('') : emptyRegion(region)}</div></section>`;
  }).join('')}</div>`;
  watchRouteSummaries();
}
function emptyRegion(region) {
  return `<div class="empty-region"><span class="empty-icon">✈</span><span>${state.view === 'active' ? 'No active trip in this region.' : state.view === 'archived' ? 'No archived trips here yet.' : 'No planned itineraries here yet.'}</span>${state.view === 'planned' ? `<button class="text-action" data-new-region="${region.id}">+ Add a trip</button>` : ''}</div>`;
}
function renderCard(t) {
  const p = progress(t), pct = p.total ? Math.round(100*p.done/p.total):0;
  const upcomingIndex = t.status==='active' ? firstUpcomingLeg(t.legs) : -1;
  const upcoming = upcomingIndex>=0 ? t.legs[upcomingIndex] : null;
  const upcomingHTML = t.status!=='active' ? '' : upcoming ? `<div class="upcoming-leg"><div class="upcoming-label">NEXT FLIGHT · LEG ${upcomingIndex+1}</div><div class="upcoming-main"><div class="upcoming-route"><strong>${esc(upcoming.departure)} → ${esc(upcoming.arrival)}</strong>${upcoming.flightNumber?`<small>Flight ${esc(upcoming.flightNumber)}</small>`:''}</div><button type="button" class="complete-next-btn" data-check-upcoming="${esc(t.id)}" data-leg-index="${upcomingIndex}" title="Mark this next flight complete" aria-label="Mark leg ${upcomingIndex+1} ${esc(upcoming.departure)} to ${esc(upcoming.arrival)} complete"><span class="next-checkbox" aria-hidden="true"></span> Complete</button></div></div>` : '<div class="upcoming-leg upcoming-done">All legs complete — ready to archive</div>';
  return `<article class="trip-card"><div class="trip-card-top"><span class="trip-status">${p.total} ${p.total===1?'LEG':'LEGS'}</span></div><h4>${esc(t.title)}</h4><div class="trip-route card-route" data-route-trip="${esc(t.id)}">${esc(describeRoute(t.legs))}</div>${upcomingHTML}<div class="card-footer"><span class="mini-progress">${p.done}/${p.total} completed</span><div class="trip-actions">${t.status === 'planned' ? `<button class="text-action" data-activate="${esc(t.id)}">Activate →</button>` : ''}<button class="text-action" data-open="${esc(t.id)}">View details →</button></div></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div></article>`;
}

// Delegate navigation and card actions to the document; rendered elements have stable data-* attributes.
document.addEventListener('click', async e => {
  const button = e.target.closest('button'); if (!button) return;
  if (button.dataset.view) { state.view = button.dataset.view; render(); return; }
  if (button.dataset.region) { state.region = button.dataset.region; render(); return; }
  if (button.dataset.aircraft !== undefined) { state.aircraft = button.dataset.aircraft; state.aircraftGroup=null; render(); return; }
  if (button.dataset.group !== undefined) { state.aircraft='all'; state.aircraftGroup=button.dataset.group; render(); return; }
  if (button.dataset.toggleGroup !== undefined) { toggleGroupCollapsed(button.dataset.toggleGroup); return; }
  if (button.dataset.createGroup !== undefined) { await promptCreateGroup(); return; }
  if (button.dataset.renameGroup !== undefined) { await promptRenameGroup(button.dataset.renameGroup); return; }
  if (button.dataset.deleteGroup !== undefined) { await promptDeleteGroup(button.dataset.deleteGroup); return; }
  if (button.dataset.moveAircraft !== undefined) { await promptMoveAircraft(button.dataset.moveAircraft); return; }
  if (button.dataset.newRegion) { openEditor(null,{region:button.dataset.newRegion}); return; }
  if (button.dataset.open) { openDetail(button.dataset.open); return; }
  if (button.dataset.activate) { await changeStatus(button.dataset.activate,'active'); return; }
  if (button.dataset.checkUpcoming !== undefined) {
    const trip=getTrip(button.dataset.checkUpcoming);
    const index=Number(button.dataset.legIndex);
    if (!trip || trip.status!=='active' || !trip.legs[index]) return;
    button.disabled=true;
    await toggleLeg(trip.id,index,{completeOnly:true,expected:trip.legs[index]});
    if(button.isConnected)button.disabled=false;
    return;
  }
});

// Aircraft folders are private user settings, live-synced on all devices.
// Transactions re-read the latest settings to prevent two browsers overwriting each other.
async function modifyGroups(change) {
  if(!state.user) throw new Error('Please sign in.');
  await runTransaction(db, async tx => {
    const ref=groupsRef();const snapshot=await tx.get(ref);
    const before=cleanGroups(snapshot.exists()?snapshot.data().groups:[]);
    const updated=cleanGroups(change(before));
    tx.set(ref,{groups:updated,updatedAt:serverTimestamp()});
  });
}
async function promptCreateGroup() {
  const name=window.prompt('Name of the new aircraft group (e.g. Boeing, Airbus, Classic Jets):');
  if(name===null)return;
  try {
    const id=doc(tripsRef()).id;
    await modifyGroups(groups=>createGroup(groups,id,name));
    state.aircraft='all';state.aircraftGroup=id;
    toast(`Created aircraft group ${name.trim()}. Drag aircraft types into it.`);
  }catch(e){toast(errorMessage(e),true);}
}
async function promptRenameGroup(id) {
  const group=state.groups.find(g=>g.id===id);if(!group)return;
  const name=window.prompt('New aircraft group name:',group.name);
  if(name===null)return;
  try {await modifyGroups(groups=>renameGroup(groups,id,name));toast('Aircraft group renamed.');}
  catch(e){toast(errorMessage(e),true);}
}
async function promptDeleteGroup(id) {
  const group=state.groups.find(g=>g.id===id);if(!group)return;
  if(!window.confirm(`Delete the group "${group.name}"? Its aircraft types will become Ungrouped. No flights or trips will be deleted.`))return;
  try {await modifyGroups(groups=>deleteGroup(groups,id));if(state.aircraftGroup===id)state.aircraftGroup=null;toast('Aircraft group deleted; trips were not changed.');}
  catch(e){toast(errorMessage(e),true);}
}
async function promptMoveAircraft(type) {
  const destinations=['Ungrouped',...state.groups.map(g=>g.name)].join(', ');
  const defaultName=state.groups.find(g=>g.id===assignedGroup(state.groups,type))?.name||'Ungrouped';
  const selected=window.prompt(`Move ${type} to which group? Enter a group name.
Available: ${destinations}`,defaultName);
  if(selected===null)return;
  const target=selected.trim().toLocaleLowerCase('en')==='ungrouped'?UNGROUPED:state.groups.find(g=>g.name.toLocaleLowerCase('en')===selected.trim().toLocaleLowerCase('en'))?.id;
  if(!target){toast('Unknown group name. Create the group first.',true);return;}
  try {await modifyGroups(groups=>moveType(groups,type,target));toast(`${type} moved to ${selected.trim()}.`);}
  catch(e){toast(errorMessage(e),true);}
}
const aircraftSidebar=$('aircraftFilters');
aircraftSidebar.addEventListener('dragstart',e=>{
  const row=e.target.closest('[data-drag-aircraft]');if(!row)return;
  e.dataTransfer.setData('text/plain',row.dataset.dragAircraft);
  e.dataTransfer.effectAllowed='move';row.classList.add('dragging');
});
aircraftSidebar.addEventListener('dragover',e=>{
  const target=e.target.closest('[data-drop-group]');if(!target)return;
  e.preventDefault();e.dataTransfer.dropEffect='move';
  aircraftSidebar.querySelectorAll('.drag-over').forEach(el=>el.classList.remove('drag-over'));
  target.classList.add('drag-over');
});
aircraftSidebar.addEventListener('dragleave',e=>{
  const target=e.target.closest('[data-drop-group]');
  if(target&&!target.contains(e.relatedTarget))target.classList.remove('drag-over');
});
aircraftSidebar.addEventListener('dragend',()=>{
  aircraftSidebar.querySelectorAll('.drag-over,.dragging').forEach(el=>el.classList.remove('drag-over','dragging'));
});
aircraftSidebar.addEventListener('drop',async e=>{
  const target=e.target.closest('[data-drop-group]');
  if(!target)return;
  e.preventDefault();
  aircraftSidebar.querySelectorAll('.drag-over,.dragging').forEach(el=>el.classList.remove('drag-over','dragging'));
  const type=e.dataTransfer.getData('text/plain');
  if(!state.trips.some(t=>t.aircraft===type)){toast('Only known aircraft types can be dragged.',true);return;}
  try {
    await modifyGroups(groups=>moveType(groups,type,target.dataset.dropGroup));
    const name=target.dataset.dropGroup===UNGROUPED?'Ungrouped':state.groups.find(g=>g.id===target.dataset.dropGroup)?.name||'group';
    toast(`${type} moved to ${name}.`);
  }catch(error){toast(errorMessage(error),true);}
});

// All renumbering changes are serialized by a per-account revision record. The server
// collection is re-read on transaction retries, so concurrent browsers cannot allocate
// the same (airline, aircraft, trip number). Every status and region participates.
async function numberedMutation(change) {
  if (!state.user) throw new Error('Please sign in.');
  return runTransaction(db, async txn => {
    const lockRef = numberingRef();
    const lock = await txn.get(lockRef);
    const snapshot = await getDocsFromServer(tripsRef());
    const originals = new Map(snapshot.docs.map(s => [s.id,{...s.data(),id:s.id}]));
    const staged = new Map(); // id => full normalized value or null to delete
    const slotChanges = new Map();
    const slotReads = new Map();
    const api = {
      trips: [...originals.values()],
      priorityId: null,
      getTrip: async id => {
        const ref = tripRef(id), snap = await txn.get(ref);
        return snap.exists() ? {...snap.data(),id} : null;
      },
      put: (id,value) => { staged.set(id,normaliseTrip(value)); },
      remove: id => {staged.set(id,null);},
      moveSlot: async (oldTrip,newId,newRegion) => {
        const oldRegion = oldTrip?.status === 'active' ? oldTrip.region : null;
        if(oldRegion) {
          const ref=slotRef(oldRegion);
          const slot=slotReads.get(oldRegion) || await txn.get(ref);
          slotReads.set(oldRegion,slot);
          if(slot.exists() && slot.data().tripId!==oldTrip.id)
            throw new Error('Active region changed on another device; reload and retry.');
          if(oldRegion !== newRegion) slotChanges.set(oldRegion,null);
        }
        if(newRegion) {
          const pendingOwner=slotChanges.get(newRegion);
          if(pendingOwner && pendingOwner!==newId && pendingOwner!==oldTrip?.id)
            throw new Error(`Only one trip may be active in ${regionName(newRegion)}.`);
          if(!REGIONS.some(r=>r.id===newRegion))throw new Error('Invalid active region.');
          const ref=slotRef(newRegion);
          const slot=slotReads.get(newRegion) || await txn.get(ref);
          slotReads.set(newRegion,slot);
          if(slot.exists() && slot.data().tripId!==newId && slot.data().tripId!==oldTrip?.id)
            throw new Error(`Only one trip may be active in ${regionName(newRegion)}. Archive or move the other trip first.`);
          slotChanges.set(newRegion,newId);
        }
      },
    };
    const result = await change(api);
    const combined = new Map(originals);
    for(const [id,data] of staged) {
      if(data===null)combined.delete(id);
      else combined.set(id,{...(originals.get(id)||{}),...data,id});
    }
    const numbered = assignNumbers([...combined.values()],{priorityId:api.priorityId});
    if(numbered.length > 4000)throw new Error('Too many trips for this version.');
    let writes=1+slotChanges.size+Array.from(staged.values()).filter(x=>x===null).length;
    for (const t of numbered) {
      const old=originals.get(t.id);
      const newInput=staged.get(t.id);
      const changedNumber=!old || old.tripNumber!==t.tripNumber || old.title!==t.title || old.numberManual!==t.numberManual || old.numberLocked!==t.numberLocked;
      if(!changedNumber && newInput===undefined) continue;
      writes++;
    }
    if(writes>450)throw new Error('This operation affects more than 450 documents. Contact me to add chunked migration support.');
    // All transaction reads above; now apply writes.
    for(const [id,data] of staged)if(data===null)txn.delete(tripRef(id));
    for (const t of numbered) {
      const old=originals.get(t.id);
      const newInput=staged.get(t.id);
      const changedNumber=!old || old.tripNumber!==t.tripNumber || old.title!==t.title || old.numberManual!==t.numberManual || old.numberLocked!==t.numberLocked;
      if(newInput!==undefined) {
        const {id:storedId,...storedTrip}=t;
        txn.set(tripRef(t.id), {
          ...storedTrip,
          createdAt:old?.createdAt || serverTimestamp(), updatedAt:serverTimestamp(),
          activatedAt:t.status==='active'?(old?.status==='active' ? old.activatedAt || serverTimestamp():serverTimestamp()):(old?.activatedAt || null),
          archivedAt:t.status==='archived'?(old?.status==='archived' ? old.archivedAt || serverTimestamp():serverTimestamp()):(old?.archivedAt || null),
        });
      } else if(changedNumber) txn.update(tripRef(t.id),{title:t.title,tripNumber:t.tripNumber,numberManual:t.numberManual,numberLocked:t.numberLocked,updatedAt:serverTimestamp()});
    }
    for (const [region,id] of slotChanges) {
      if(id===null)txn.delete(slotRef(region));
      else txn.set(slotRef(region),{tripId:id});
    }
    txn.set(lockRef,{revision:(lock.exists()?lock.data().revision||0:0)+1,updatedAt:serverTimestamp()});
    return result;
  });
}
// Renames legacy v1.x documents in place without changing their IDs or flight legs.
async function ensureNumbering() {
  if (state.numberingBusy || !state.user) return;
  state.numberingBusy=true;
  try { await numberedMutation(async()=>{}); }
  catch(e){console.error('Numbering upgrade:',e);toast(`Trip numbering update failed: ${errorMessage(e)}. Ensure the new firestore.rules were published.`,true);}
  finally{state.numberingBusy=false;}
}
async function saveTrip(nextInput, id, allowCreateId = false) {
  const next=normaliseTrip(nextInput);
  validateArchivedTrip(next);
  const newId=id || doc(tripsRef()).id;
  await numberedMutation(async api=>{
    const old=await api.getTrip(newId);
    if(id && !old && !allowCreateId)throw new Error('Trip deleted on another device; reload and retry.');
    await api.moveSlot(old,newId,next.status==='active'?next.region:null);
    api.put(newId,next);
  });
  return newId;
}
async function changeStatus(id, to) {
  const trip = getTrip(id); if (!trip) return;
  if (to === 'archived') { await archiveCompleted(id); return; }
  if (to === 'active' && !canActivate(state.trips, id, trip.region)) {
    toast(`You already have an active trip in ${regionName(trip.region)}.`,true);return;
  }
  try { await saveTrip({...trip,status:to},id); toast(to==='active'?'Trip promoted to active.':to==='planned'?'Trip moved to planning.':'Trip moved to archive.'); closeModal(); }
  catch(e){toast(errorMessage(e),true);}
}
async function toggleLeg(id,index,{completeOnly=false,expected=null}={}) {
  const ref=tripRef(id);
  try {
    await runTransaction(db,async txn=>{
      const snap=await txn.get(ref);if(!snap.exists())throw new Error('Trip no longer exists.');
      if(snap.data().status!=='active')throw new Error('Only active trips can have flights marked complete in trip details or on a card.');
      const legs=snap.data().legs.map(x=>({...x}));
      if(!legs[index])throw new Error('That leg has changed. Reopen the trip.');
      if(expected && ['departure','arrival','flightNumber'].some(field=>String(legs[index][field]||'')!==String(expected[field]||'')))
        throw new Error('The upcoming flight has changed on another device. Refresh and try again.');
      if(completeOnly && legs[index].completed===true)throw new Error('This flight has already been completed.');
      const next=validateCompletionUpdate(legs,index);
      txn.update(ref,{legs:next,updatedAt:serverTimestamp()});
    });
  }catch(e){toast(errorMessage(e),true);}
}

async function deleteTrip(id){
  if(!window.confirm('Permanently delete this trip and every leg? Automatic trip numbers in its airline/aircraft group may be reassigned.'))return;
  try {
    await numberedMutation(async api=>{
      const old=await api.getTrip(id); if(!old)return;
      await api.moveSlot(old,null,null);
      api.remove(id);
    });
    closeModal();toast('Trip deleted and automatic trip numbers updated.');
  }catch(e){toast(errorMessage(e),true);}
}
async function archiveCompleted(id) {
  try {
    const outcome=await numberedMutation(async api=>{
      const current=await api.getTrip(id);
      if(!current)throw new Error('Trip no longer exists.');
      if(current.status==='archived')throw new Error('This trip is already archived.');
      const {done,remaining}=validateArchive(current);
      // A legacy trip may not yet have a number when first opened.
      const now=assignNumbers(api.trips).find(t=>t.id===id);
      const n=now?.tripNumber;
      if(!validNumber(n))throw new Error('Unable to determine trip number. Refresh and retry.');
      const archived={...current,tripNumber:n,legs:done,status:'archived',numberLocked:true};
      const newId=remaining.length?doc(tripsRef()).id:null;
      const successor=remaining.length?{
        aircraft:current.aircraft,airline:current.airline,region:current.region,status:current.status,
        title:'',notes:current.notes,legs:remaining,tripNumber:n+1,
        numberManual:false,numberLocked:false,splitFrom:id,
      }:null;
      await api.moveSlot(current,newId,current.status==='active'&&newId ? current.region:null);
      api.put(id,archived);
      if(successor) {api.put(newId,successor);api.priorityId=newId;}
      return {remaining:remaining.length,done:done.length,n,newId};
    });
    closeModal();
    toast(outcome.remaining ? `Archived ${outcome.done} completed legs as Trip ${outcome.n}; ${outcome.remaining} remaining legs moved to Trip ${outcome.n+1}.` : `Archived completed Trip ${outcome.n}.`);
  }catch(e){toast(errorMessage(e),true);}
}
function modalHTML(title, subtitle, body, footer, small=false) {
  $('modalRoot').innerHTML = `<div class="modal-backdrop" id="modalBackdrop"><section role="dialog" aria-modal="true" aria-label="${esc(title)}" class="modal ${small?'small':''}"><div class="modal-header"><div><div class="eyebrow">${esc(subtitle)}</div><h2>${esc(title)}</h2></div><button class="icon-btn" data-close aria-label="Close">×</button></div><div class="modal-body">${body}</div><div class="modal-footer">${footer}</div></section></div>`;
  $('modalBackdrop').addEventListener('click', e=> {if(e.target===$('modalBackdrop'))closeModal();});
  $('modalRoot').querySelector('[data-close]').addEventListener('click',closeModal);
}
function closeModal() { state.modalTripId=null; $('modalRoot').innerHTML=''; }
window.addEventListener('keydown', e=> {if(e.key==='Escape'&&$('modalRoot').innerHTML)closeModal();});
function openDetail(id) {
  const t=getTrip(id);if(!t)return;
  state.modalTripId=id;
  const p=progress(t),pct=p.total?Math.round(100*p.done/p.total):0;
  const integrity=inspectArchive(t);
  const archivedInvalid=t.status==='archived' && t.legs.some(l=>l.completed!==true);
  const archiveWarning=archivedInvalid ? `<div class="archive-warning" role="alert"><strong>Archived trip integrity issue.</strong> Every archived flight must be complete. Use Edit itinerary to correct its completion markers.</div>` :
    t.status!=='archived'&&p.done>0&&!integrity.valid?`<div class="archive-warning" role="alert"><strong>Archive integrity check failed.</strong> ${esc(integrity.reason)}</div>`:'';
  const body=`<div class="detail-head"><span class="pill">${esc(t.aircraft)}</span><span class="pill">${esc(regionName(t.region))}</span><span class="pill ${t.status==='active'?'green':'gray'}">${esc(t.status.toUpperCase())}</span></div><div class="trip-route" style="font-size:14px">${esc(describeRoute(t.legs))}</div>${t.notes?`<div class="detail-note">${esc(t.notes)}</div>`:''}<div class="detail-progress"><span>FLIGHT PROGRESS</span><span>${p.done} of ${p.total} legs · ${pct}%</span></div><div class="progress-track" style="height:7px;margin:2px 0 20px"><div class="progress-fill" style="width:${pct}%"></div></div>${archiveWarning}<div style="overflow:auto"><table class="legs-table"><thead><tr><th>Done</th><th>Leg / Route</th><th>Flight number</th><th>Callsign</th><th>Notes</th></tr></thead><tbody>${t.legs.map((leg,i)=>`<tr class="${leg.completed?'completed-leg':''}"><td><button class="checkbox-button ${leg.completed?'checked':''}" data-check="${i}" ${t.status!=='active'?'disabled title="Completion can only be changed for active trips"':''} aria-label="${leg.completed?'Unmark':'Mark'} leg ${i+1} complete">${leg.completed?'✓':''}</button></td><td>${i+1}. ${esc(leg.departure)} <span class="route-arrow">→</span> ${esc(leg.arrival)}</td><td>${esc(leg.flightNumber)||'—'}</td><td>${esc(leg.callsign)||'—'}</td><td class="leg-notes">${esc(leg.notes)||'—'}</td></tr>`).join('')}</tbody></table></div>`;
  const actions=[];
  if(t.status==='planned')actions.push(`<button id="promoteButton" class="btn primary">Activate trip →</button>`);
  if(t.status!=='archived')actions.push(`<button id="archiveButton" class="btn primary" ${!integrity.valid?'disabled title="Complete a consecutive prefix of legs before archiving"':''}>${p.done===p.total?'Archive completed trip':'Archive completed legs'} →</button>`);
  if(t.status==='active'||t.status==='archived')actions.push('<button id="returnPlanningButton" class="btn neutral">Move to planning</button>');
  if(t.status==='archived')actions.push('<button id="reactivateButton" class="btn neutral">Reactivate</button>');
  const footer=`<button id="deleteButton" class="btn danger small">Delete</button><div class="footer-actions"><button id="editButton" class="btn neutral">Edit itinerary</button>${actions.join('')}</div>`;
  modalHTML(t.title,'TRIP DETAILS',body,footer);
  $('modalRoot').querySelectorAll('[data-check]').forEach(b=>{
    if(t.status!=='active') {b.disabled=true;b.title=t.status==='planned'?'Activate this trip before marking flights complete.':'Archived flights must remain complete.';}
    else b.addEventListener('click',async()=>{b.disabled=true;await toggleLeg(id,Number(b.dataset.check),{expected:t.legs[Number(b.dataset.check)]});if(b.isConnected)b.disabled=false;});
  });
  $('editButton').addEventListener('click',()=>openEditor(id));$('deleteButton').addEventListener('click',()=>deleteTrip(id));
  $('promoteButton')?.addEventListener('click',()=>changeStatus(id,'active'));
  $('returnPlanningButton')?.addEventListener('click',()=>changeStatus(id,'planned'));
  $('reactivateButton')?.addEventListener('click',()=>changeStatus(id,'active'));
  $('archiveButton')?.addEventListener('click',()=>{
    const current=getTrip(id);if(!current)return;
    const {done,remaining}=validateArchive(current);
    const detail=remaining.length?`Archive ${done.length} completed legs under the current trip number and create a new trip for the ${remaining.length} unfinished legs?`:`Archive this completed trip (${done.length} legs)?`;
    if(window.confirm(detail))void archiveCompleted(id);
  });
}
// Keep details current after live Firestore updates; don't replace an actively edited form.
function refreshDetailIfOpen() {
  if (state.modalTripId && $('modalRoot').querySelector('[data-check]')) {
    const id=state.modalTripId;
    if(getTrip(id))openDetail(id);else closeModal();
  }
}

function blankLeg() {return {flightNumber:'',callsign:'',departure:'',arrival:'',notes:'',completed:false};}
function editorRow(leg,i) {
  return `<div class="leg-edit-row" data-leg-row data-leg-index="${i}"><span class="rownum">${i+1}</span><input aria-label="Flight number for leg ${i+1}" data-field="flightNumber" placeholder="Flight #" value="${esc(leg.flightNumber)}"><input aria-label="Departure for leg ${i+1}" data-field="departure" placeholder="DEP" maxlength="5" value="${esc(leg.departure)}" required><input aria-label="Arrival for leg ${i+1}" data-field="arrival" placeholder="ARR" maxlength="5" value="${esc(leg.arrival)}" required><input aria-label="Callsign for leg ${i+1}" data-field="callsign" placeholder="Callsign" value="${esc(leg.callsign)}"><input aria-label="Notes for leg ${i+1}" data-field="notes" placeholder="Leg notes" value="${esc(leg.notes)}"><label title="Completed"><input type="checkbox" data-field="completed" ${leg.completed?'checked':''}></label><div class="row-actions"><button type="button" class="leg-grab" draggable="true" data-leg-drag-handle title="Drag to reorder leg ${i+1}" aria-label="Drag leg ${i+1} to another position">⠿</button><button type="button" data-leg-action="up" data-index="${i}" title="Move leg up" aria-label="Move leg ${i+1} up">↑</button><button type="button" data-leg-action="down" data-index="${i}" title="Move leg down" aria-label="Move leg ${i+1} down">↓</button><button type="button" data-leg-action="delete" data-index="${i}" title="Delete leg" aria-label="Delete leg ${i+1}">×</button><button type="button" class="leg-insert-inline" data-insert-at="${i+1}" title="Insert leg after leg ${i+1}" aria-label="Insert new leg after leg ${i+1}">＋</button></div></div>`;
}
function editorRows(legs) {
  $('editorLegRows').innerHTML=legs.map(editorRow).join('');
}
function readEditorLegs() {
  return [...$('editorLegRows').querySelectorAll('[data-leg-row]')].map(row=>{
    const val=key=>row.querySelector(`[data-field="${key}"]`).value;
    return {flightNumber:val('flightNumber'),callsign:val('callsign'),departure:val('departure'),arrival:val('arrival'),notes:val('notes'),completed:row.querySelector('[data-field="completed"]').checked};
  });
}
function openEditor(id=null,defaults={}) {
  const t=id?getTrip(id):null;if(id&&!t)return;
  state.modalTripId=null;
  const trip=t || {title:'',tripNumber:null,numberManual:false,numberLocked:false,aircraft:state.aircraft==='all'?'':state.aircraft,airline:state.airline==='all'||state.airline==='Unassigned'?'':state.airline,region:defaults.region||'north-america',notes:'',legs:[blankLeg()],status:'planned'};
  const known=[...new Set(state.trips.map(x=>x.aircraft).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const aircraftChoices=known.map(a=>`<option value="${esc(a)}" ${trip.aircraft===a?'selected':''}>${esc(a)}</option>`).join('');
  const knownAirlines=[...new Set(state.trips.map(x=>airlineName(x.airline)).filter(x=>x!=='Unassigned'))].sort((a,b)=>a.localeCompare(b));
  const airlineChoices=knownAirlines.map(a=>`<option value="${esc(a)}"></option>`).join('');
  const members=state.trips.filter(x=>comboKey(x)===comboKey(trip) && (!t || x.id!==t.id));
  const suggested = validNumber(trip.tripNumber) ? trip.tripNumber : members.length+1;
  const body=`<form id="tripForm"><div class="numbering-panel"><div class="field"><label for="tripPreview">Automatically generated trip name</label><div class="generated-trip-title" id="tripPreview">${esc(tripTitle({...trip,tripNumber:suggested}))}</div><p id="numberHelp" class="edit-footnote">Trip numbers are unique for each airline and aircraft, across all regions and statuses.</p></div><div class="field"><label for="tripNumber">Trip number (n)</label><input id="tripNumber" type="number" min="1" max="100000" step="1" value="${suggested}" required><label class="manual-number-label"><input id="tripNumberManual" type="checkbox" ${trip.numberManual?'checked':''}> Reserve this number manually</label></div></div><div class="edit-grid"><div class="field"><label for="tripAircraft">Aircraft type</label><input id="tripAircraft" maxlength="100" list="aircraftOptions" placeholder="e.g. B707" value="${esc(trip.aircraft)}" required><datalist id="aircraftOptions">${aircraftChoices}</datalist></div><div class="field"><label for="tripAirline">Airline</label><input id="tripAirline" maxlength="120" list="airlineOptions" placeholder="e.g. British Airways" value="${esc(airlineName(trip.airline)==='Unassigned'&&!t?'':airlineName(trip.airline))}" required><datalist id="airlineOptions">${airlineChoices}</datalist></div><div class="field"><label for="tripRegion">Region</label><select id="tripRegion">${REGIONS.map(r=>`<option value="${r.id}" ${trip.region===r.id?'selected':''}>${r.label}</option>`).join('')}</select></div></div><div class="field"><label for="tripNotes">Trip notes</label><textarea id="tripNotes" rows="2" maxlength="10000" placeholder="Optional general itinerary notes">${esc(trip.notes)}</textarea></div><div class="editor-section"><h3>Flight legs</h3><div class="editor-toolbar"><button type="button" id="insertFirstLegButton" class="btn neutral small" title="Insert a blank leg before the first leg">＋ Insert first</button><button type="button" id="addLegButton" class="btn neutral small">+ Add leg</button></div></div><div class="editor-leg-header"><span>#</span><span>Flight #</span><span>DEP</span><span>ARR</span><span>Callsign</span><span>Notes</span><span>Done</span><span>Actions / Insert</span></div><div id="editorLegRows"></div><p class="edit-footnote">Use the <strong>＋</strong> button at the right of each row to insert a leg below it, or <strong>Insert first</strong> to add a leg at the top. Shift+Enter also inserts below the current leg. Drag by the ⠿ grip to reorder flights; ↑/↓ buttons also change order. Arrow keys navigate cells as before. Changes save only when you click Save trip.</p><div id="legEditorAnnounce" class="visually-hidden" role="status" aria-live="polite"></div><div id="tripValidationError" class="trip-validation-error hidden" role="alert"></div></form>`;
  modalHTML(t?'Edit itinerary':'Create a new trip',t?'UPDATE FLIGHT PLAN':'FLIGHT PLANNING',body,`<button type="button" class="btn neutral" id="cancelEditor">Cancel</button><button type="submit" form="tripForm" class="btn primary" id="saveTripButton">Save trip</button>`);
  const updateNumberPreview=()=>{
    const temporary={airline:$('tripAirline').value.trim()||'Unassigned',aircraft:$('tripAircraft').value.trim()};
    const count=state.trips.filter(x=>comboKey(x)===comboKey(temporary) && (!t||x.id!==t.id)).length+1;
    const n=Number($('tripNumber').value);
    $('tripNumber').max=String(count);
    $('tripPreview').textContent=tripTitle({...temporary,tripNumber:validNumber(n)?n:null});
    $('numberHelp').textContent=`Valid numbers for this airline and aircraft: 1–${count}. ${$('tripNumberManual').checked?'Manually reserved numbers cannot be used by another trip.':'Automatic numbers are reassigned around manually reserved numbers.'}`;
    $('numberHelp').classList.toggle('invalid-number', !validNumber(n)||n>count);
  };
  for(const el of ['tripAircraft','tripAirline']) $(el).addEventListener('input',()=>{
    const temporary={airline:$('tripAirline').value,aircraft:$('tripAircraft').value};
    const matches=state.trips.filter(x=>comboKey(x)===comboKey(temporary) && (!t||x.id!==t.id));
    if(!t || comboKey(temporary)!==comboKey(t)) {
      if(!$('tripNumberManual').checked) $('tripNumber').value=String(matches.length+1);
    }
    updateNumberPreview();
  });
  $('tripNumber').addEventListener('input',()=>{$('tripNumberManual').checked=true;updateNumberPreview();});
  $('tripNumberManual').addEventListener('change',()=>updateNumberPreview());
  updateNumberPreview();
  editorRows(trip.legs);
  const makeInsertedLeg=(rows,index)=>blankLegAfter(rows,index,blankLeg);
  installLegKeyboardNavigation($('editorLegRows'), {readLegs: readEditorLegs, renderLegs: editorRows, blankLeg,createInsertedLeg:makeInsertedLeg});
  installLegReordering($('editorLegRows'), {readLegs: readEditorLegs, renderLegs: editorRows, blankLeg, createInsertedLeg:makeInsertedLeg, onChange: message => {$('legEditorAnnounce').textContent = message;}});
  $('cancelEditor').addEventListener('click',closeModal);
  $('insertFirstLegButton').addEventListener('click',()=>{const rows=readEditorLegs();rows.unshift(makeInsertedLeg(rows,0));editorRows(rows);$('editorLegRows').querySelector('[data-leg-row] [data-field="flightNumber"]')?.focus();});
  $('addLegButton').addEventListener('click',()=>{const rows=readEditorLegs();rows.push(makeInsertedLeg(rows,rows.length));editorRows(rows);[...$('editorLegRows').querySelectorAll('[data-leg-row]')].at(-1)?.querySelector('[data-field="flightNumber"]')?.focus();});
  $('editorLegRows').addEventListener('click',e=>{
    const btn=e.target.closest('[data-leg-action]');if(!btn)return;
    let rows=readEditorLegs();const i=Number(btn.dataset.index),what=btn.dataset.legAction;
    if(what==='delete') { if(rows.length===1){toast('A trip must have at least one leg.',true);return;} rows.splice(i,1); }
    else if(what==='up'&&i>0) [rows[i-1],rows[i]]=[rows[i],rows[i-1]];
    else if(what==='down'&&i<rows.length-1) [rows[i+1],rows[i]]=[rows[i],rows[i+1]];
    editorRows(rows);
  });
  $('editorLegRows').addEventListener('input',()=>{ $('tripValidationError').classList.add('hidden');$('editorLegRows').querySelectorAll('.leg-validation-invalid').forEach(r=>r.classList.remove('leg-validation-invalid')); });
  $('editorLegRows').addEventListener('change',()=>{ $('tripValidationError').classList.add('hidden'); });
  $('tripForm').addEventListener('submit',async e=>{
    e.preventDefault();const btn=$('saveTripButton');btn.disabled=true;
    try {
      const candidate={...(t||{}),aircraft:$('tripAircraft').value,airline:$('tripAirline').value,region:$('tripRegion').value,notes:$('tripNotes').value,legs:readEditorLegs(),tripNumber:$('tripNumberManual').checked?Number($('tripNumber').value):(!t || comboKey(t)!==comboKey({airline:$('tripAirline').value,aircraft:$('tripAircraft').value})?null:t.tripNumber),numberManual:$('tripNumberManual').checked,numberLocked:t?.numberLocked===true && !$('tripNumberManual').checked};
      const sequenceCheck=validateTripSequence(candidate.legs);
      if(!sequenceCheck.valid){
        const error=$('tripValidationError');error.textContent=sequenceCheck.message;error.classList.remove('hidden');
        const row=$('editorLegRows').querySelectorAll('[data-leg-row]')[sequenceCheck.index];
        row?.classList.add('leg-validation-invalid');
        row?.querySelector(`[data-field="${sequenceCheck.kind==='route'?'departure':'completed'}"]`)?.focus();
        throw new Error(sequenceCheck.message);
      }
      $('tripValidationError').classList.add('hidden');
      const comboCount=state.trips.filter(x=>comboKey(x)===comboKey(candidate) && (!t||x.id!==t.id)).length+1;
      if($('tripNumberManual').checked && (!validNumber(candidate.tripNumber) || candidate.tripNumber>comboCount))throw new Error(`Trip number must be between 1 and ${comboCount} for this airline and aircraft.`);
      await saveTrip(candidate,id);closeModal();toast(t?'Trip updated.':'Trip created.');
    }catch(e){toast(errorMessage(e),true);}finally{if(btn.isConnected)btn.disabled=false;}
  });
}

function saveJSON(filename,content) {
  const blob=new Blob([JSON.stringify(content,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function backup() {
  if(!state.user||state.loading)return;
  const contents=state.trips.map(t=>({id:t.id,...normaliseTrip(t)}));
  const today=new Date().toISOString().slice(0,10);
  saveJSON(`flight-schedule-backup-${today}.json`,{format:'flight-planner-backup-v4',exportedAt:new Date().toISOString(),aircraftGroups:state.groups,trips:contents});
  toast(`Backup downloaded (${contents.length} trips). Keep it in a private location.`);
}
async function importFile(file) {
  if(!state.user)throw new Error('You must sign in first.');
  if(file.size>15_000_000)throw new Error('Import file exceeds 15 MB.');
  const raw=JSON.parse(await file.text());
  if(!['flight-planner-v1','flight-planner-v2','flight-planner-backup-v1','flight-planner-backup-v2','flight-planner-backup-v3','flight-planner-backup-v4'].includes(raw.format)||!Array.isArray(raw.trips))throw new Error('Unsupported Flight Schedule import/backup file.');
  if(raw.trips.length>4000)throw new Error('Import exceeds 4,000 trips.');
  const inputs=raw.trips.map(t=>({id:String(t.id||''),...normaliseTrip(t)}));
  if(new Set(inputs.map(x=>x.id)).size!==inputs.length||inputs.some(x=>!/^[-a-zA-Z0-9_]{8,160}$/.test(x.id)))throw new Error('One or more import IDs are invalid or repeated.');
  const current=await getDocsFromServer(tripsRef());
  const existingIds=new Set(current.docs.map(x=>x.id));
  const pending=inputs.filter(x=>!existingIds.has(x.id));
  if(!pending.length) {
    if(Array.isArray(raw.aircraftGroups)&&raw.aircraftGroups.length) {
      const incoming=cleanGroups(raw.aircraftGroups);
      if(window.confirm(`All trip IDs exist already. Restore the ${incoming.length} aircraft groups from this backup? This replaces the current group layout, but does not affect trips.`)) {
        await modifyGroups(()=>incoming);toast('Aircraft groups restored; existing trips were not changed.');
      }
    }else toast('Nothing to import: all trip IDs already exist.');
    return;
  }
  if(!window.confirm(`Import ${pending.length} new trips? Existing trips will not be overwritten; names will be renumbered by airline and aircraft where required.`))return;
  let imported=0,skipped=0;
  for(let i=0;i<pending.length;i+=150) {
    const chunk=pending.slice(i,i+150);
    const result=await numberedMutation(async api=>{
      let added=0,notAdded=0;
      for(const entry of chunk) {
        const already=await api.getTrip(entry.id);
        if(already){notAdded++;continue;}
        const {id,...data}=entry;
        if(data.status==='active') {
          try {await api.moveSlot(null,id,data.region);}
          catch(err){notAdded++;continue;}
        }
        validateArchivedTrip(data);
        api.put(id,data);added++;
      }
      return {added,notAdded};
    });
    imported+=result.added;skipped+=result.notAdded;
  }
  if(Array.isArray(raw.aircraftGroups)&&raw.aircraftGroups.length) {
    try {
      const incoming=cleanGroups(raw.aircraftGroups);
      if(window.confirm(`This backup includes ${incoming.length} aircraft groups. Restore them? Current aircraft groups will be replaced (trips are unaffected).`)) {
        await modifyGroups(()=>incoming);
      }
    }catch(error){toast(`Trips imported, but aircraft groups could not be restored: ${errorMessage(error)}`,true);return;}
  }
  toast(`Imported ${imported} trips and generated sequential names.${skipped?' '+skipped+' already existing or conflicting active trips skipped.':''}`);
}
