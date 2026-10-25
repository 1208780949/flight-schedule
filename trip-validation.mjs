/**
 * Editor pre-save validation. Completion markers must be an uninterrupted prefix,
 * and each leg's destination must be the next leg's departure. A trip with no
 * completed legs is valid. Other domain constraints are checked by normaliseTrip.
 */
export function validateTripSequence(legs) {
  if (!Array.isArray(legs) || !legs.length) return {valid:false,kind:'empty',index:0,message:'Add at least one flight leg.'};
  let firstIncomplete = -1;
  for (let i = 0; i < legs.length; i++) {
    if (!legs[i].completed && firstIncomplete === -1) firstIncomplete = i;
    if (legs[i].completed && firstIncomplete !== -1) return {
      valid:false, kind:'completion', index:i,
      message:`Leg ${i+1} is marked complete after incomplete leg ${firstIncomplete+1}. Completed flights must be consecutive from leg 1.`,
    };
  }
  for (let i=1; i<legs.length; i++) {
    const previous = String(legs[i-1].arrival ?? '').trim().toUpperCase();
    const departure = String(legs[i].departure ?? '').trim().toUpperCase();
    if (previous !== departure) return {
      valid:false, kind:'route', index:i,
      message:`Route discontinuity between legs ${i} and ${i+1}: leg ${i} arrives at ${previous||'(blank)'}, but leg ${i+1} departs from ${departure||'(blank)'}.`,
    };
  }
  return {valid:true,kind:'valid',index:-1,message:''};
}
export function firstUpcomingLeg(legs) {
  if (!Array.isArray(legs)) return -1;
  return legs.findIndex(leg => leg.completed !== true);
}
/** An active-trip checkbox can only change completion when the resulting prefix stays valid. */
export function validateCompletionUpdate(legs, index) {
  if (!Array.isArray(legs) || !Number.isInteger(index) || index < 0 || index >= legs.length)
    throw new Error('That flight leg no longer exists. Refresh the trip.');
  const next=legs.map((leg,i)=>i===index?{...leg,completed:!leg.completed}:leg);
  const check=validateCompletionPrefix(next);
  if (!check.valid) throw new Error(check.message);
  return next;
}
export function validateCompletionPrefix(legs) {
  if (!Array.isArray(legs)) return {valid:false,message:'Invalid flight legs.'};
  const firstIncomplete=legs.findIndex(l=>l.completed!==true);
  if (firstIncomplete===-1) return {valid:true,message:''};
  const later=legs.findIndex((l,i)=>i>firstIncomplete&&l.completed===true);
  return later===-1 ? {valid:true,message:''} : {
    valid:false,message:`Leg ${later+1} cannot be complete while leg ${firstIncomplete+1} is incomplete. Complete the flights in order.`,
  };
}
/** Insertion defaults to the arrival of the leg directly above it. */
export function blankLegAfter(legs, insertionIndex, blankLegFactory) {
  const newLeg=blankLegFactory();
  if (insertionIndex>0 && legs[insertionIndex-1]?.arrival)
    newLeg.departure=String(legs[insertionIndex-1].arrival).trim().toUpperCase();
  return newLeg;
}
