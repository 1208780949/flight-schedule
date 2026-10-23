import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, serverTimestamp, runTransaction,
  getDocs, writeBatch,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from './firebase.js';
import { REGIONS, regionName, esc, progress, normaliseTrip, canActivate, describeRoute, grouped } from './domain.mjs';

const firebase = initializeApp(firebaseConfig);
const auth = getAuth(firebase);
const db = getFirestore(firebase);
const $ = id => document.getElementById(id);
const state = { user: null, unsubscribe: null, trips: [], loading: true, view: 'planned', region: 'all', aircraft: 'all', modalTripId: null, editorLegs: [] };
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

onAuthStateChanged(auth, (user) => {
  if (state.unsubscribe) { state.unsubscribe(); state.unsubscribe = null; }
  state.user = user; state.trips = []; state.loading = true; state.aircraft = 'all'; closeModal();
  $('authScreen').classList.toggle('hidden', !!user);
  $('mainApp').classList.toggle('hidden', !user);
  if (!user) return;
  $('accountEmail').textContent = user.email || 'Signed in';
  $('connectionStatus').textContent = 'Connecting to Firestore…';
  state.unsubscribe = onSnapshot(tripsRef(), snapshot => {
    state.loading = false;
    state.trips = snapshot.docs.map(x => ({ ...x.data(), id: x.id }));
    $('connectionStatus').textContent = snapshot.metadata.fromCache ? 'Offline / cached data' : 'All changes synced';
    render();
    refreshDetailIfOpen();
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
$('importFile').addEventListener('change', async e => {
  const file = e.target.files?.[0]; e.target.value = '';
  if (!file) return;
  try { await importFile(file); } catch (err) { toast(`Import failed: ${errorMessage(err)}`, true); }
});

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
  $('aircraftFilters').innerHTML = `<button data-aircraft="all" class="aircraft-item ${state.aircraft === 'all' ? 'selected' : ''}"><span>▦</span> All aircraft <span class="aircraft-count">${state.trips.length}</span></button>` +
    known.map(a => `<button data-aircraft="${esc(a)}" class="aircraft-item ${state.aircraft === a ? 'selected' : ''}"><span>✈</span> ${esc(a)} <span class="aircraft-count">${state.trips.filter(t => t.aircraft === a).length}</span></button>`).join('');
  $('regionFilters').innerHTML = [{id:'all',label:'All regions'},...REGIONS].map(r => `<button data-region="${r.id}" class="region-tab ${state.region === r.id ? 'selected' : ''}">${r.label}</button>`).join('');
  const visible = grouped(state.trips, state.view, state.aircraft, state.region);
  $('boardCount').textContent = `${visible.length} ${visible.length === 1 ? 'trip' : 'trips'}`;
  if (state.loading) { $('board').innerHTML = '<div class="loading">Loading schedules from Firestore…</div>'; return; }
  const regions = REGIONS.filter(r => state.region === 'all' || state.region === r.id);
  $('board').innerHTML = `<div class="regions-grid ${regions.length === 1 ? 'single-region' : ''}">${regions.map(region => {
    const items = visible.filter(t => t.region === region.id).sort((a,b) => {
      const ai = a.updatedAt?.seconds || 0, bi = b.updatedAt?.seconds || 0;
      return bi - ai || a.title.localeCompare(b.title);
    });
    return `<section class="region-column"><div class="region-heading"><span class="region-mark">${region.emblem}</span><h3>${region.label}</h3><small>${items.length} ${items.length === 1 ? 'trip':'trips'}</small></div><div class="cards-stack">${items.length ? items.map(renderCard).join('') : emptyRegion(region)}</div></section>`;
  }).join('')}</div>`;
}
function emptyRegion(region) {
  return `<div class="empty-region"><span class="empty-icon">✈</span><span>${state.view === 'active' ? 'No active trip in this region.' : state.view === 'archived' ? 'No archived trips here yet.' : 'No planned itineraries here yet.'}</span>${state.view === 'planned' ? `<button class="text-action" data-new-region="${region.id}">+ Add a trip</button>` : ''}</div>`;
}
function renderCard(t) {
  const p = progress(t), pct = p.total ? Math.round(100*p.done/p.total):0;
  return `<article class="trip-card"><div class="trip-card-top"><span class="trip-type">${esc(t.aircraft)}</span><span class="trip-status">${p.total} ${p.total===1?'LEG':'LEGS'}</span></div><h4>${esc(t.title)}</h4><div class="trip-route">${esc(describeRoute(t.legs))}</div><div class="card-footer"><span class="mini-progress">${p.done}/${p.total} completed</span><div class="trip-actions">${t.status === 'planned' ? `<button class="text-action" data-activate="${esc(t.id)}">Activate →</button>` : ''}<button class="text-action" data-open="${esc(t.id)}">View details →</button></div></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div></article>`;
}

// Delegate navigation and card actions to the document; rendered elements have stable data-* attributes.
document.addEventListener('click', async e => {
  const button = e.target.closest('button'); if (!button) return;
  if (button.dataset.view) { state.view = button.dataset.view; render(); return; }
  if (button.dataset.region) { state.region = button.dataset.region; render(); return; }
  if (button.dataset.aircraft !== undefined) { state.aircraft = button.dataset.aircraft; render(); return; }
  if (button.dataset.newRegion) { openEditor(null,{region:button.dataset.newRegion}); return; }
  if (button.dataset.open) { openDetail(button.dataset.open); return; }
  if (button.dataset.activate) { await changeStatus(button.dataset.activate,'active'); return; }
});

// A transaction protects each region's one-active-trip slot even when two browsers act simultaneously.
async function saveTrip(nextInput, id, allowCreateId = false) {
  if (!state.user) throw new Error('Please sign in.');
  const next = normaliseTrip(nextInput);
  const ref = id ? tripRef(id) : doc(tripsRef());
  await runTransaction(db, async txn => {
    const existingSnap = await txn.get(ref), previous = existingSnap.exists() ? existingSnap.data() : null;
    if (id && !previous && !allowCreateId) throw new Error('This trip has been deleted on another device. Refresh and retry.');
    const oldRegion = previous?.status === 'active' ? previous.region : null;
    const newRegion = next.status === 'active' ? next.region : null;
    const oldSlotRef = oldRegion ? slotRef(oldRegion) : null;
    const newSlotRef = newRegion ? slotRef(newRegion) : null;
    const oldSlotSnap = oldSlotRef ? await txn.get(oldSlotRef) : null;
    const newSlotSnap = newSlotRef && newRegion !== oldRegion ? await txn.get(newSlotRef) : oldSlotSnap;
    if (newSlotSnap?.exists() && newSlotSnap.data().tripId !== ref.id)
      throw new Error(`Only one trip may be active in ${regionName(newRegion)}. Archive or move the other trip back to Planned first.`);
    if (oldRegion && oldSlotSnap?.exists() && oldSlotSnap.data().tripId !== ref.id)
      throw new Error('The active-region slot has changed. Reload before saving.');
    const data = {
      ...(previous || {}), ...next,
      updatedAt: serverTimestamp(),
      createdAt: previous?.createdAt || serverTimestamp(),
      activatedAt: next.status === 'active' ? (previous?.status === 'active' ? previous.activatedAt || serverTimestamp() : serverTimestamp()) : (previous?.activatedAt || null),
      archivedAt: next.status === 'archived' ? (previous?.status === 'archived' ? previous.archivedAt || serverTimestamp() : serverTimestamp()) : (previous?.archivedAt || null),
    };
    txn.set(ref, data);
    if (oldRegion && oldRegion !== newRegion && oldSlotSnap?.exists()) txn.delete(oldSlotRef);
    if (newRegion) txn.set(newSlotRef, { tripId:ref.id });
  });
  return ref.id;
}
async function changeStatus(id, to) {
  const trip = getTrip(id); if (!trip) return;
  if (to === 'active' && !canActivate(state.trips, id, trip.region)) {
    toast(`You already have an active trip in ${regionName(trip.region)}.`,true);return;
  }
  try { await saveTrip({...trip,status:to},id); toast(to==='active'?'Trip promoted to active.':to==='planned'?'Trip moved to planning.':'Trip moved to archive.'); closeModal(); }
  catch(e){toast(errorMessage(e),true);}
}
async function toggleLeg(id,index) {
  const ref=tripRef(id);
  try {
    await runTransaction(db,async txn=>{
      const snap=await txn.get(ref);if(!snap.exists())throw new Error('Trip no longer exists.');
      const legs=snap.data().legs.map(x=>({...x}));
      if(!legs[index])throw new Error('That leg has changed. Reopen the trip.');
      legs[index].completed=!legs[index].completed;
      txn.update(ref,{legs,updatedAt:serverTimestamp()});
    });
    // Repaint selected detail from the latest local state when Firestore emits an update.
  }catch(e){toast(errorMessage(e),true);}
}
async function deleteTrip(id){
  if(!window.confirm('Permanently delete this trip and every leg? This cannot be undone.'))return;
  try {
    const ref=tripRef(id);
    await runTransaction(db,async txn=>{
      const snap=await txn.get(ref);if(!snap.exists())return;
      const t=snap.data();const slot=t.status==='active'?slotRef(t.region):null;
      const current=slot?await txn.get(slot):null;
      txn.delete(ref);
      if(slot&&current?.exists()&&current.data().tripId===id)txn.delete(slot);
    });
    closeModal();toast('Trip deleted.');
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
  const p=progress(t),pct=Math.round(100*p.done/p.total);
  const body=`<div class="detail-head"><span class="pill">${esc(t.aircraft)}</span><span class="pill">${esc(regionName(t.region))}</span><span class="pill ${t.status==='active'?'green':'gray'}">${esc(t.status.toUpperCase())}</span></div><div class="trip-route" style="font-size:14px">${esc(describeRoute(t.legs))}</div>${t.notes?`<div class="detail-note">${esc(t.notes)}</div>`:''}<div class="detail-progress"><span>FLIGHT PROGRESS</span><span>${p.done} of ${p.total} legs · ${pct}%</span></div><div class="progress-track" style="height:7px;margin:2px 0 20px"><div class="progress-fill" style="width:${pct}%"></div></div><div style="overflow:auto"><table class="legs-table"><thead><tr><th>Done</th><th>Leg / Route</th><th>Flight number</th><th>Callsign</th><th>Notes</th></tr></thead><tbody>${t.legs.map((leg,i)=>`<tr class="${leg.completed?'completed-leg':''}"><td><button class="checkbox-button ${leg.completed?'checked':''}" data-check="${i}" aria-label="${leg.completed?'Unmark':'Mark'} leg ${i+1} complete">${leg.completed?'✓':''}</button></td><td>${i+1}. ${esc(leg.departure)} <span class="route-arrow">→</span> ${esc(leg.arrival)}</td><td>${esc(leg.flightNumber)||'—'}</td><td>${esc(leg.callsign)||'—'}</td><td class="leg-notes">${esc(leg.notes)||'—'}</td></tr>`).join('')}</tbody></table></div>`;
  const actions=[];
  if(t.status==='planned')actions.push(`<button id="promoteButton" class="btn primary">Activate trip →</button>`);
  if(t.status==='active')actions.push(`<button id="archiveButton" class="btn primary">${p.done===p.total?'Archive completed trip':'Complete & archive trip'} →</button>`);
  if(t.status==='active'||t.status==='archived')actions.push('<button id="returnPlanningButton" class="btn neutral">Move to planning</button>');
  if(t.status==='archived')actions.push('<button id="reactivateButton" class="btn neutral">Reactivate</button>');
  const footer=`<button id="deleteButton" class="btn danger small">Delete</button><div class="footer-actions"><button id="editButton" class="btn neutral">Edit itinerary</button>${actions.join('')}</div>`;
  modalHTML(t.title,'TRIP DETAILS',body,footer);
  $('modalRoot').querySelectorAll('[data-check]').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;await toggleLeg(id,Number(b.dataset.check));}));
  $('editButton').addEventListener('click',()=>openEditor(id));$('deleteButton').addEventListener('click',()=>deleteTrip(id));
  $('promoteButton')?.addEventListener('click',()=>changeStatus(id,'active'));
  $('returnPlanningButton')?.addEventListener('click',()=>changeStatus(id,'planned'));
  $('reactivateButton')?.addEventListener('click',()=>changeStatus(id,'active'));
  $('archiveButton')?.addEventListener('click',async()=>{
    const latest=getTrip(id); if(!latest)return;
    if(latest.legs.some(l=>!l.completed)){
      if(!window.confirm('Some legs are not checked. Mark all remaining legs complete and archive the trip?'))return;
      try{await saveTrip({...latest,legs:latest.legs.map(l=>({...l,completed:true})),status:'archived'},id);toast('All legs marked complete; trip archived.');closeModal();}catch(e){toast(errorMessage(e),true);}
    }else await changeStatus(id,'archived');
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
  return `<div class="leg-edit-row" data-leg-row><span class="rownum">${i+1}</span><input aria-label="Flight number for leg ${i+1}" data-field="flightNumber" placeholder="Flight #" value="${esc(leg.flightNumber)}"><input aria-label="Departure for leg ${i+1}" data-field="departure" placeholder="DEP" maxlength="5" value="${esc(leg.departure)}" required><input aria-label="Arrival for leg ${i+1}" data-field="arrival" placeholder="ARR" maxlength="5" value="${esc(leg.arrival)}" required><input aria-label="Callsign for leg ${i+1}" data-field="callsign" placeholder="Callsign" value="${esc(leg.callsign)}"><input aria-label="Notes for leg ${i+1}" data-field="notes" placeholder="Leg notes" value="${esc(leg.notes)}"><label title="Completed"><input type="checkbox" data-field="completed" ${leg.completed?'checked':''}></label><div class="row-actions"><button type="button" data-leg-action="up" data-index="${i}" title="Move leg up">↑</button><button type="button" data-leg-action="down" data-index="${i}" title="Move leg down">↓</button><button type="button" data-leg-action="delete" data-index="${i}" title="Delete leg">×</button></div></div>`;
}
function editorRows(legs) { $('editorLegRows').innerHTML=legs.map(editorRow).join(''); }
function readEditorLegs() {
  return [...$('editorLegRows').querySelectorAll('[data-leg-row]')].map(row=>{
    const val=key=>row.querySelector(`[data-field="${key}"]`).value;
    return {flightNumber:val('flightNumber'),callsign:val('callsign'),departure:val('departure'),arrival:val('arrival'),notes:val('notes'),completed:row.querySelector('[data-field="completed"]').checked};
  });
}
function openEditor(id=null,defaults={}) {
  const t=id?getTrip(id):null;if(id&&!t)return;
  state.modalTripId=null;
  const trip=t || {title:'',aircraft:state.aircraft==='all'?'':state.aircraft,region:defaults.region||'north-america',notes:'',legs:[blankLeg()],status:'planned'};
  const known=[...new Set(state.trips.map(x=>x.aircraft).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const aircraftChoices=known.map(a=>`<option value="${esc(a)}" ${trip.aircraft===a?'selected':''}>${esc(a)}</option>`).join('');
  const body=`<form id="tripForm"><div class="edit-grid"><div class="field"><label for="tripTitle">Trip name</label><input id="tripTitle" placeholder="e.g. B707 world tour" maxlength="180" value="${esc(trip.title)}" required></div><div class="field"><label for="tripAircraft">Aircraft type</label><input id="tripAircraft" maxlength="100" list="aircraftOptions" placeholder="e.g. B707" value="${esc(trip.aircraft)}" required><datalist id="aircraftOptions">${aircraftChoices}</datalist></div><div class="field"><label for="tripRegion">Region</label><select id="tripRegion">${REGIONS.map(r=>`<option value="${r.id}" ${trip.region===r.id?'selected':''}>${r.label}</option>`).join('')}</select></div></div><div class="field"><label for="tripNotes">Trip notes</label><textarea id="tripNotes" rows="2" maxlength="10000" placeholder="Optional general itinerary notes">${esc(trip.notes)}</textarea></div><div class="editor-section"><h3>Flight legs</h3><button type="button" id="addLegButton" class="btn neutral small">+ Add leg</button></div><div class="editor-leg-header"><span>#</span><span>Flight #</span><span>DEP</span><span>ARR</span><span>Callsign</span><span>Notes</span><span>Done</span><span>Order</span></div><div id="editorLegRows"></div><p class="edit-footnote">Use the arrows to reorder legs. The completion checkboxes are saved with each leg. Airport codes are uppercase.</p></form>`;
  modalHTML(t?'Edit itinerary':'Create a new trip',t?'UPDATE FLIGHT PLAN':'FLIGHT PLANNING',body,`<button type="button" class="btn neutral" id="cancelEditor">Cancel</button><button type="submit" form="tripForm" class="btn primary" id="saveTripButton">Save trip</button>`);
  editorRows(trip.legs);
  $('cancelEditor').addEventListener('click',closeModal);
  $('addLegButton').addEventListener('click',()=>{const rows=readEditorLegs();rows.push(blankLeg());editorRows(rows);$('editorLegRows').lastElementChild.querySelector('[data-field="flightNumber"]').focus();});
  $('editorLegRows').addEventListener('click',e=>{
    const btn=e.target.closest('[data-leg-action]');if(!btn)return;
    let rows=readEditorLegs();const i=Number(btn.dataset.index),what=btn.dataset.legAction;
    if(what==='delete') { if(rows.length===1){toast('A trip must have at least one leg.',true);return;} rows.splice(i,1); }
    else if(what==='up'&&i>0) [rows[i-1],rows[i]]=[rows[i],rows[i-1]];
    else if(what==='down'&&i<rows.length-1) [rows[i+1],rows[i]]=[rows[i],rows[i+1]];
    editorRows(rows);
  });
  $('tripForm').addEventListener('submit',async e=>{
    e.preventDefault();const btn=$('saveTripButton');btn.disabled=true;
    try {
      const candidate={...(t||{}),title:$('tripTitle').value,aircraft:$('tripAircraft').value,region:$('tripRegion').value,notes:$('tripNotes').value,legs:readEditorLegs()};
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
  saveJSON(`flight-schedule-backup-${today}.json`,{format:'flight-planner-backup-v1',exportedAt:new Date().toISOString(),trips:contents});
  toast(`Backup downloaded (${contents.length} trips). Keep it in a private location.`);
}
async function importFile(file) {
  if (!state.user) throw new Error('You must sign in first.');
  if(file.size>15_000_000)throw new Error('Import file exceeds 15 MB.');
  const raw=JSON.parse(await file.text());
  if(!['flight-planner-v1','flight-planner-backup-v1'].includes(raw.format)||!Array.isArray(raw.trips))throw new Error('This is not a supported Flight Planner import/backup file.');
  if(raw.trips.length>4000)throw new Error('Import exceeds 4,000 trips.');
  // Complete validation before writing anything to Firestore.
  const inputs=raw.trips.map(t=>({id: String(t.id||''),...normaliseTrip(t)}));
  if(new Set(inputs.map(t=>t.id)).size!==inputs.length || inputs.some(x=>!/^[-a-zA-Z0-9_]{8,160}$/.test(x.id))) throw new Error('One or more import IDs are invalid or repeated.');
  const existing=await getDocs(tripsRef());
  const ids=new Set(existing.docs.map(d=>d.id));
  const pending=inputs.filter(t=>!ids.has(t.id));
  if(!pending.length){toast('Nothing to import. Every trip already exists.');return;}
  if(!window.confirm(`Import ${pending.length} new trips from ${file.name}? ${inputs.length-pending.length} existing trips will be skipped, not overwritten. You can undo by deleting imported trips manually or restore from a backup.`))return;
  let inserted=0,activeImported=0,activeSkipped=0;
  const other=pending.filter(t=>t.status!=='active');
  for(let i=0;i<other.length;i+=250){
    const batch=writeBatch(db);
    for(const t of other.slice(i,i+250)){
      const {id,...values}=t;
      batch.set(tripRef(id),{...values,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),activatedAt:null,archivedAt:values.status==='archived'?serverTimestamp():null});
    }
    await batch.commit();inserted+=Math.min(250,other.length-i);
  }
  for(const t of pending.filter(t=>t.status==='active')){
    try{const {id,...values}=t;await saveTrip(values,id,true);activeImported++;}
    catch(e){activeSkipped++;console.warn('Active trip could not import',t.id,e);}
  }
  toast(`Import finished: ${inserted+activeImported} trips added.${activeSkipped?' '+activeSkipped+' active trip(s) skipped because a region is already occupied.':''}`);
}

