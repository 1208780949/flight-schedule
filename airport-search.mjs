/** Read-only airport occurrence search over the trips already synced from Firestore.
 * Each matching endpoint is one occurrence: a same-airport DEP/ARR leg counts twice.
 * Keep this module independent of Firebase and the DOM so it can be unit tested.
 */
export function normaliseAirportCode(code) {
  return String(code ?? '').trim().toUpperCase();
}

export function searchAirportOccurrences(trips, {airport = '', region = 'all', status = 'planned', matchesAircraft = () => true} = {}) {
  const code = normaliseAirportCode(airport);
  if (!/^[A-Z0-9]{3,5}$/.test(code)) {
    return {code, valid: false, total: 0, departures: 0, arrivals: 0, legs: 0, trips: 0, matches: []};
  }
  const matches = [];
  let departures = 0;
  let arrivals = 0;
  let matchedLegs = 0;
  const tripIds = new Set();
  for (const trip of trips ?? []) {
    if (status !== 'all' && trip.status !== status) continue;
    if (region !== 'all' && trip.region !== region) continue;
    if (!matchesAircraft(trip.aircraft)) continue;
    for (const [index, leg] of (trip.legs ?? []).entries()) {
      const dep = normaliseAirportCode(leg.departure) === code;
      const arr = normaliseAirportCode(leg.arrival) === code;
      if (!dep && !arr) continue;
      departures += Number(dep);
      arrivals += Number(arr);
      matchedLegs++;
      tripIds.add(trip.id);
      matches.push({tripId: trip.id, title: trip.title ?? '', aircraft: trip.aircraft ?? '', region: trip.region, status: trip.status, index, flightNumber: leg.flightNumber ?? '', departure: leg.departure ?? '', arrival: leg.arrival ?? '', departureMatch: dep, arrivalMatch: arr, occurrences: Number(dep) + Number(arr)});
    }
  }
  matches.sort((a,b) => String(a.title).localeCompare(String(b.title), undefined, {numeric:true, sensitivity:'base'}) || a.index-b.index || String(a.tripId).localeCompare(String(b.tripId)));
  return {code, valid: true, total: departures+arrivals, departures, arrivals, legs:matchedLegs, trips:tripIds.size, matches};
}
