/** Pure domain functions used in the app and in automated tests. */
export const REGIONS = [
  { id: 'north-america', label: 'North America', short: 'N. AMERICA', emblem: 'NA' },
  { id: 'europe', label: 'Europe', short: 'EUROPE', emblem: 'EU' },
  { id: 'rest-of-world', label: 'Rest of World', short: 'REST OF WORLD', emblem: 'RW' },
];
export const STATUS = ['planned', 'active', 'archived'];
export const regionName = (id) => REGIONS.find((r) => r.id === id)?.label || id;
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (s) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
export const progress = (trip) => ({ done: trip.legs.filter(l => l.completed).length, total: trip.legs.length });
export function cleanLeg(input) {
  return {
    flightNumber: String(input.flightNumber ?? '').trim(),
    callsign: String(input.callsign ?? '').trim(),
    departure: String(input.departure ?? '').trim().toUpperCase(),
    arrival: String(input.arrival ?? '').trim().toUpperCase(),
    notes: String(input.notes ?? '').trim(),
    completed: Boolean(input.completed),
  };
}
export function normaliseTrip(input) {
  const out = {
    title: String(input.title ?? '').trim(), aircraft: String(input.aircraft ?? '').trim(),
    region: String(input.region ?? ''), status: String(input.status ?? 'planned'),
    notes: String(input.notes ?? '').trim(),
    legs: Array.isArray(input.legs) ? input.legs.map(cleanLeg) : [],
  };
  for (const field of ['sourceSheet', 'sourceRow', 'sourceColumn', 'importKey']) {
    if (input[field] !== undefined && input[field] !== null) out[field] = input[field];
  }
  if (!out.title) throw new Error('A trip title is required.');
  if (!out.aircraft) throw new Error('Choose an aircraft type (or Unspecified).');
  if (!REGIONS.some(r => r.id === out.region)) throw new Error('Choose a valid region.');
  if (!STATUS.includes(out.status)) throw new Error('Invalid trip status.');
  if (!out.legs.length) throw new Error('Add at least one flight leg.');
  if (out.legs.length > 300) throw new Error('Trips are limited to 300 legs.');
  for (const [i, l] of out.legs.entries()) {
    if (!/^[A-Z0-9]{3,5}$/.test(l.departure) || !/^[A-Z0-9]{3,5}$/.test(l.arrival))
      throw new Error(`Leg ${i + 1}: departure and arrival must be 3–5 alphanumeric characters.`);
    if (l.notes.length > 2000 || l.callsign.length > 100 || l.flightNumber.length > 100)
      throw new Error(`Leg ${i + 1}: one of the text fields is too long.`);
  }
  if (out.notes.length > 10000 || out.title.length > 180 || out.aircraft.length > 100)
    throw new Error('Trip title, aircraft, or notes are too long.');
  return out;
}
export function canActivate(trips, id, region) {
  const occupant = trips.find(t => t.status === 'active' && t.region === region && t.id !== id);
  return !occupant;
}
export function describeRoute(legs) {
  if (!legs?.length) return 'No route';
  if (legs.length === 1) return `${legs[0].departure} → ${legs[0].arrival}`;
  return `${legs[0].departure} → ${legs[0].arrival} → … → ${legs[legs.length - 1].arrival}`;
}
export function grouped(trips, view, aircraft, region) {
  return trips.filter(t => t.status === view && (aircraft === 'all' || aircraft === t.aircraft) && (region === 'all' || region === t.region));
}
