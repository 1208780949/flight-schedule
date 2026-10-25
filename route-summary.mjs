/**
 * Pick the longest airport sequence that fits the text line. Always preserve
 * departure and final destination when truncating a multi-leg itinerary.
 * Accept a measurement callback so this algorithm is independent of the DOM.
 */
export function routeAirports(legs) {
  if (!Array.isArray(legs) || !legs.length) return [];
  return [String(legs[0].departure||''), ...legs.map(l=>String(l.arrival||''))];
}
export function fitRouteSummary(legs, availableWidth, measure) {
  const airports=routeAirports(legs);
  if (!airports.length) return 'No route';
  const joined=airports.join(' → ');
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return airports.length<=2?joined:`${airports[0]} → … → ${airports.at(-1)}`;
  if (measure(joined)<=availableWidth) return joined;
  // A single long route may be wider than its container; CSS handles clipping.
  if (airports.length<=2) return joined;
  for (let head=airports.length-2; head>=1; head--) {
    const text=`${airports.slice(0,head).join(' → ')} → … → ${airports.at(-1)}`;
    if (measure(text)<=availableWidth) return text;
  }
  return `${airports[0]} → … → ${airports.at(-1)}`;
}
