/**
 * Check completion integrity in leg order, before and within the Firestore archive transaction.
 * Allowed: T T T F F (partial archive), T T T (full archive).
 * Rejected: F F F (nothing completed), T F T (gap), F T (not a completed prefix).
 */
export function inspectArchive(trip) {
  const legs = trip?.legs;
  if (!Array.isArray(legs) || legs.length===0)
    return {valid:false,reason:'Trip has no flight legs.',done:0,remaining:0,kind:'invalid'};
  if (trip.status==='archived')
    return {valid:false,reason:'Trip is already archived.',done:0,remaining:0,kind:'invalid'};
  const firstIncomplete = legs.findIndex(leg=>leg.completed!==true);
  const completedPrefix = firstIncomplete === -1 ? legs.length : firstIncomplete;
  if (completedPrefix===0) {
    const subsequent = legs.findIndex(leg=>leg.completed===true);
    if (subsequent>=0) return {valid:false,reason:`Leg ${subsequent+1} is complete, but leg 1 is not. Complete legs must start at leg 1 with no gaps.`,done:legs.filter(l=>l.completed===true).length,remaining:legs.filter(l=>l.completed!==true).length,kind:'invalid'};
    return {valid:false,reason:'Mark the first leg complete before archiving.',done:0,remaining:legs.length,kind:'invalid'};
  }
  const invalidAfter=legs.findIndex((leg,index)=>index>=completedPrefix&&leg.completed===true);
  if(invalidAfter>=0) return {
    valid:false,
    reason:`Leg ${invalidAfter+1} is marked complete after incomplete leg ${completedPrefix+1}. Only a continuous completed prefix (legs 1–x) may be archived; every later leg must be incomplete.`,
    done:legs.filter(l=>l.completed===true).length,
    remaining:legs.filter(l=>l.completed!==true).length,kind:'invalid',
  };
  return {valid:true,reason:'',done:completedPrefix,remaining:legs.length-completedPrefix,kind:completedPrefix===legs.length?'full':'partial'};
}
export function validateArchive(trip) {
  const check = inspectArchive(trip);
  if (!check.valid) throw new Error(`Archive integrity check failed: ${check.reason}`);
  return {done:trip.legs.slice(0,check.done),remaining:trip.legs.slice(check.done)};
}
export function validateArchivedTrip(trip) {
  if (trip.status==='archived' && (!Array.isArray(trip.legs)||!trip.legs.length||trip.legs.some(l=>l.completed!==true)))
    throw new Error('Archive integrity check failed: all flights in an archived trip must be marked complete.');
}
