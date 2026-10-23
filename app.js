import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, serverTimestamp, runTransaction,
  getDocsFromServer,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from './firebase.js';
import { REGIONS, regionName, esc, progress, normaliseTrip, canActivate, describeRoute, grouped, airlineName } from './domain.mjs';
import { assignNumbers, comboKey, tripTitle, splitLegs, validNumber } from './numbering.mjs';

const firebase = initializeApp(firebaseConfig);
const auth = getAuth(firebase);
const db = getFirestore(firebase);
const $ = id => document.getElementById(id);
const state = { numberingBusy:false, user: null, unsubscribe: null, trips: [], loading: true, view: 'planned', region: 'all', aircraft: 'all', airline: 'all', modalTripId: null, editorLegs: [] };
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

onAuthStateChanged(auth, (user) => {
  if (state.unsubscribe) { state.unsubscribe(); state.unsubscribe = null; }
  state.user = user; state.trips = []; state.loading = true; state.aircraft = 'all'; state.airline = 'all'; closeModal();
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
  const airlines = [...new Set(state.trips.map(t => airlineName(t.airline)))].sort((a,b) => a.localeCompare(b));
  if (state.airline !== 'all' && !airlines.includes(state.airline)) state.airline = 'all';
  $('airlineFilter').innerHTML = '<option value="all">All airlines</option>' +
    airlines.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
  $('airlineFilter').value = state.airline;
  const visible = grouped(state.trips, state.view, state.aircraft, state.region, state.airline);
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
      const {done,remaining}=splitLegs(current);
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
  const p=progress(t),pct=Math.round(100*p.done/p.total);
  const body=`<div class="detail-head"><span class="pill">${esc(t.aircraft)}</span><span class="pill">${esc(regionName(t.region))}</span><span class="pill ${t.status==='active'?'green':'gray'}">${esc(t.status.toUpperCase())}</span></div><div class="trip-route" style="font-size:14px">${esc(describeRoute(t.legs))}</div>${t.notes?`<div class="detail-note">${esc(t.notes)}</div>`:''}<div class="detail-progress"><span>FLIGHT PROGRESS</span><span>${p.done} of ${p.total} legs · ${pct}%</span></div><div class="progress-track" style="height:7px;margin:2px 0 20px"><div class="progress-fill" style="width:${pct}%"></div></div><div style="overflow:auto"><table class="legs-table"><thead><tr><th>Done</th><th>Leg / Route</th><th>Flight number</th><th>Callsign</th><th>Notes</th></tr></thead><tbody>${t.legs.map((leg,i)=>`<tr class="${leg.completed?'completed-leg':''}"><td><button class="checkbox-button ${leg.completed?'checked':''}" data-check="${i}" aria-label="${leg.completed?'Unmark':'Mark'} leg ${i+1} complete">${leg.completed?'✓':''}</button></td><td>${i+1}. ${esc(leg.departure)} <span class="route-arrow">→</span> ${esc(leg.arrival)}</td><td>${esc(leg.flightNumber)||'—'}</td><td>${esc(leg.callsign)||'—'}</td><td class="leg-notes">${esc(leg.notes)||'—'}</td></tr>`).join('')}</tbody></table></div>`;
  const actions=[];
  if(t.status==='planned')actions.push(`<button id="promoteButton" class="btn primary">Activate trip →</button>`);
  if(t.status!=='archived')actions.push(`<button id="archiveButton" class="btn primary" ${p.done===0?'disabled':''}>${p.done===p.total?'Archive completed trip':'Archive completed legs'} →</button>`);
  if(t.status==='active'||t.status==='archived')actions.push('<button id="returnPlanningButton" class="btn neutral">Move to planning</button>');
  if(t.status==='archived')actions.push('<button id="reactivateButton" class="btn neutral">Reactivate</button>');
  const footer=`<button id="deleteButton" class="btn danger small">Delete</button><div class="footer-actions"><button id="editButton" class="btn neutral">Edit itinerary</button>${actions.join('')}</div>`;
  modalHTML(t.title,'TRIP DETAILS',body,footer);
  $('modalRoot').querySelectorAll('[data-check]').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;await toggleLeg(id,Number(b.dataset.check));}));
  $('editButton').addEventListener('click',()=>openEditor(id));$('deleteButton').addEventListener('click',()=>deleteTrip(id));
  $('promoteButton')?.addEventListener('click',()=>changeStatus(id,'active'));
  $('returnPlanningButton')?.addEventListener('click',()=>changeStatus(id,'planned'));
  $('reactivateButton')?.addEventListener('click',()=>changeStatus(id,'active'));
  $('archiveButton')?.addEventListener('click',()=>{
    const current=getTrip(id);if(!current)return;
    const {done,remaining}=splitLegs(current);
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
  const trip=t || {title:'',tripNumber:null,numberManual:false,numberLocked:false,aircraft:state.aircraft==='all'?'':state.aircraft,airline:state.airline==='all'||state.airline==='Unassigned'?'':state.airline,region:defaults.region||'north-america',notes:'',legs:[blankLeg()],status:'planned'};
  const known=[...new Set(state.trips.map(x=>x.aircraft).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const aircraftChoices=known.map(a=>`<option value="${esc(a)}" ${trip.aircraft===a?'selected':''}>${esc(a)}</option>`).join('');
  const knownAirlines=[...new Set(state.trips.map(x=>airlineName(x.airline)).filter(x=>x!=='Unassigned'))].sort((a,b)=>a.localeCompare(b));
  const airlineChoices=knownAirlines.map(a=>`<option value="${esc(a)}"></option>`).join('');
  const members=state.trips.filter(x=>comboKey(x)===comboKey(trip) && (!t || x.id!==t.id));
  const suggested = validNumber(trip.tripNumber) ? trip.tripNumber : members.length+1;
  const body=`<form id="tripForm"><div class="numbering-panel"><div class="field"><label for="tripPreview">Automatically generated trip name</label><div class="generated-trip-title" id="tripPreview">${esc(tripTitle({...trip,tripNumber:suggested}))}</div><p id="numberHelp" class="edit-footnote">Trip numbers are unique for each airline and aircraft, across all regions and statuses.</p></div><div class="field"><label for="tripNumber">Trip number (n)</label><input id="tripNumber" type="number" min="1" max="100000" step="1" value="${suggested}" required><label class="manual-number-label"><input id="tripNumberManual" type="checkbox" ${trip.numberManual?'checked':''}> Reserve this number manually</label></div></div><div class="edit-grid"><div class="field"><label for="tripAircraft">Aircraft type</label><input id="tripAircraft" maxlength="100" list="aircraftOptions" placeholder="e.g. B707" value="${esc(trip.aircraft)}" required><datalist id="aircraftOptions">${aircraftChoices}</datalist></div><div class="field"><label for="tripAirline">Airline</label><input id="tripAirline" maxlength="120" list="airlineOptions" placeholder="e.g. British Airways" value="${esc(airlineName(trip.airline)==='Unassigned'&&!t?'':airlineName(trip.airline))}" required><datalist id="airlineOptions">${airlineChoices}</datalist></div><div class="field"><label for="tripRegion">Region</label><select id="tripRegion">${REGIONS.map(r=>`<option value="${r.id}" ${trip.region===r.id?'selected':''}>${r.label}</option>`).join('')}</select></div></div><div class="field"><label for="tripNotes">Trip notes</label><textarea id="tripNotes" rows="2" maxlength="10000" placeholder="Optional general itinerary notes">${esc(trip.notes)}</textarea></div><div class="editor-section"><h3>Flight legs</h3><button type="button" id="addLegButton" class="btn neutral small">+ Add leg</button></div><div class="editor-leg-header"><span>#</span><span>Flight #</span><span>DEP</span><span>ARR</span><span>Callsign</span><span>Notes</span><span>Done</span><span>Order</span></div><div id="editorLegRows"></div><p class="edit-footnote">Use the arrows to reorder legs. The completion checkboxes are saved with each leg. Airport codes are uppercase.</p></form>`;
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
      const candidate={...(t||{}),aircraft:$('tripAircraft').value,airline:$('tripAirline').value,region:$('tripRegion').value,notes:$('tripNotes').value,legs:readEditorLegs(),tripNumber:$('tripNumberManual').checked?Number($('tripNumber').value):(!t || comboKey(t)!==comboKey({airline:$('tripAirline').value,aircraft:$('tripAircraft').value})?null:t.tripNumber),numberManual:$('tripNumberManual').checked,numberLocked:t?.numberLocked===true && !$('tripNumberManual').checked};
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
  saveJSON(`flight-schedule-backup-${today}.json`,{format:'flight-planner-backup-v3',exportedAt:new Date().toISOString(),trips:contents});
  toast(`Backup downloaded (${contents.length} trips). Keep it in a private location.`);
}
async function importFile(file) {
  if(!state.user)throw new Error('You must sign in first.');
  if(file.size>15_000_000)throw new Error('Import file exceeds 15 MB.');
  const raw=JSON.parse(await file.text());
  if(!['flight-planner-v1','flight-planner-v2','flight-planner-backup-v1','flight-planner-backup-v2','flight-planner-backup-v3'].includes(raw.format)||!Array.isArray(raw.trips))throw new Error('Unsupported Flight Schedule import/backup file.');
  if(raw.trips.length>4000)throw new Error('Import exceeds 4,000 trips.');
  const inputs=raw.trips.map(t=>({id:String(t.id||''),...normaliseTrip(t)}));
  if(new Set(inputs.map(x=>x.id)).size!==inputs.length||inputs.some(x=>!/^[-a-zA-Z0-9_]{8,160}$/.test(x.id)))throw new Error('One or more import IDs are invalid or repeated.');
  const current=await getDocsFromServer(tripsRef());
  const existingIds=new Set(current.docs.map(x=>x.id));
  const pending=inputs.filter(x=>!existingIds.has(x.id));
  if(!pending.length){toast('Nothing to import: all trip IDs already exist.');return;}
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
        api.put(id,data);added++;
      }
      return {added,notAdded};
    });
    imported+=result.added;skipped+=result.notAdded;
  }
  toast(`Imported ${imported} trips and generated sequential names.${skipped?' '+skipped+' already existing or conflicting active trips skipped.':''}`);
}
