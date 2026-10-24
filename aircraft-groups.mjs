/** Pure functions for cloud-stored aircraft-type folders and sidebar filtering. */
export const UNGROUPED = '__ungrouped__';
export const ALL_AIRCRAFT = 'all';
export function cleanGroups(input) {
  if (!Array.isArray(input)) return [];
  // Fail loudly for malformed user data rather than silently discarding group assignments.
  if (input.length > 60) throw new Error('Limit of 60 aircraft groups exceeded.');
  const groupIds = new Set(), groupNames = new Set(), usedTypes = new Set();
  return input.map(group => {
    if (!group || typeof group !== 'object') throw new Error('Invalid aircraft group.');
    const id = String(group.id ?? '').trim();
    const name = String(group.name ?? '').trim();
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new Error('Invalid aircraft group ID.');
    if (!name || name.length > 70) throw new Error('Aircraft group name must be 1–70 characters.');
    if (['ungrouped', 'all aircraft'].includes(name.toLocaleLowerCase('en'))) throw new Error('Choose a different group name: Ungrouped and All aircraft are reserved.');
    if (!Array.isArray(group.types) || group.types.length > 400) throw new Error('Invalid aircraft group types.');
    const idKey = id.toLowerCase(), nameKey = name.toLocaleLowerCase('en');
    if (groupIds.has(idKey) || groupNames.has(nameKey)) throw new Error('Duplicate aircraft group name or ID.');
    groupIds.add(idKey);groupNames.add(nameKey);
    const types = group.types.map(type => {
      if (typeof type !== 'string') throw new Error('Invalid aircraft type.');
      const value = type.trim(), key = value.toLocaleLowerCase('en');
      if (!value || value.length > 100 || usedTypes.has(key)) throw new Error('Duplicate or invalid aircraft type assignment.');
      usedTypes.add(key);
      return value;
    });
    return {id,name,types};
  });
}
export function createGroup(groups, id, name) {
  return cleanGroups([...cleanGroups(groups),{id,name,types:[]}]);
}
export function renameGroup(groups,id,name) {
  const original = cleanGroups(groups);
  if (!original.some(g=>g.id===id)) throw new Error('This aircraft group no longer exists.');
  return cleanGroups(original.map(g=>g.id===id?{...g,name}:g));
}
export function deleteGroup(groups,id) {
  const original = cleanGroups(groups);
  if (!original.some(g=>g.id===id)) throw new Error('This aircraft group no longer exists.');
  // Types from a deleted group automatically become ungrouped; trips are never modified.
  return cleanGroups(original.filter(g=>g.id!==id));
}
export function moveType(groups,type,targetId) {
  const original=cleanGroups(groups);
  const aircraft=String(type??'').trim();
  if (!aircraft || aircraft.length>100) throw new Error('Invalid aircraft type.');
  if (targetId !== UNGROUPED && !original.some(g=>g.id===targetId)) throw new Error('This aircraft group no longer exists.');
  return cleanGroups(original.map(g=>({
    ...g,
    types:[...g.types.filter(a=>a.toLocaleLowerCase('en')!==aircraft.toLocaleLowerCase('en')),
      ...(g.id===targetId?[aircraft]:[])],
  })));
}
export function assignedGroup(groups,aircraft) {
  const key=String(aircraft??'').trim().toLocaleLowerCase('en');
  return cleanGroups(groups).find(g=>g.types.some(t=>t.toLocaleLowerCase('en')===key))?.id??UNGROUPED;
}
export function matchesAircraft(aircraft, selectedType, selectedGroup, groups) {
  if (selectedType!==ALL_AIRCRAFT) return aircraft===selectedType;
  if (selectedGroup == null) return true;
  return assignedGroup(groups,aircraft)===selectedGroup;
}
