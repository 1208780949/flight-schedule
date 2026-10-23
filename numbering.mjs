/** Trip numbering is global across regions and statuses for each airline/aircraft pair. */
import { airlineName } from './domain.mjs';

export const comboKey = (t) => JSON.stringify([airlineName(t.airline).toLocaleLowerCase('en'), String(t.aircraft || '').trim().toLocaleLowerCase('en')]);
export const tripTitle = (t) => `${airlineName(t.airline)} ${String(t.aircraft || '').trim()} Trip ${t.tripNumber || '?'}`;
export function validNumber(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 && n <= 100000;
}
const creationKey = t => {
  const time = t.createdAt?.seconds ?? (typeof t.createdAt === 'number' ? t.createdAt : 0);
  return `${String(Math.floor(time)).padStart(16, '0')}|${String(t.importKey ?? '')}|${t.id}`;
};
/**
 * Returns cloned trips with deterministic, contiguous 1..N numbers per combo.
 * Only explicitly manual or archive-preserved numbers are immovable.
 * A priorityId preserves n+1 when splitting a trip and moves any unpinned occupant.
 */
export function assignNumbers(trips, { priorityId = null } = {}) {
  const output = trips.map(t => ({...t}));
  const groups = new Map();
  for (const t of output) {
    const key = comboKey(t);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  for (const group of groups.values()) {
    group.sort((a,b) => creationKey(a).localeCompare(creationKey(b)));
    const N = group.length;
    const held = new Map();
    for (const t of group.filter(t=>t.numberManual === true || t.numberLocked === true)) {
      if (!validNumber(t.tripNumber) || t.tripNumber > N)
        throw new Error(`Trip number ${t.tripNumber ?? '?'} for ${airlineName(t.airline)} / ${t.aircraft} is invalid: choose a number from 1 to ${N}. Release an existing manual number before deleting trips if necessary.`);
      if (held.has(t.tripNumber)) throw new Error(`Trip ${t.tripNumber} for ${airlineName(t.airline)} / ${t.aircraft} is already reserved by another manually numbered or archived trip.`);
      held.set(t.tripNumber, t.id);
    }
    const free = new Set(Array.from({length:N},(_,i)=>i+1).filter(n=>!held.has(n)));
    const autos = group.filter(t=>!(t.numberManual === true || t.numberLocked === true));
    // The next part of a split must receive exactly n+1, bumping an unpinned occupant.
    const prioritized = autos.find(t=>t.id===priorityId);
    if (prioritized && validNumber(prioritized.tripNumber)) {
      if (!free.has(prioritized.tripNumber)) throw new Error(`Cannot split: trip ${prioritized.tripNumber} is already reserved for this airline and aircraft. Change the reserved number first.`);
      free.delete(prioritized.tripNumber);
    }
    for (const t of autos) {
      if(t===prioritized && validNumber(t.tripNumber)) continue;
      if(validNumber(t.tripNumber) && free.has(t.tripNumber)) {free.delete(t.tripNumber);continue;}
      t.tripNumber=null;
    }
    for(const t of autos) if(!validNumber(t.tripNumber)) {
      const n=Math.min(...free); if(!Number.isFinite(n))throw new Error('Cannot allocate trip number.');
      t.tripNumber=n;free.delete(n);
    }
    for (const t of group) {
      t.tripNumber=Number(t.tripNumber);
      t.numberManual=t.numberManual===true;
      t.numberLocked=t.numberLocked===true;
      t.title=tripTitle(t);
      if(t.title.length>180)throw new Error('Generated trip name exceeds 180 characters. Shorten the airline or aircraft name.');
    }
  }
  return output;
}
export function splitLegs(trip) {
  const done = trip.legs.filter(l=>l.completed);
  const remaining = trip.legs.filter(l=>!l.completed);
  if(!done.length) throw new Error('Mark at least one flight leg complete before archiving.');
  return {done,remaining};
}
