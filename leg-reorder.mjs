/**
 * Editor-only, unsaved leg ordering. A drop position is a boundary from 0..N:
 * 0 = before the first leg, N = after the last leg. Preserve entire leg objects.
 */
export function insertLegAt(legs, boundary, leg) {
  if (!Array.isArray(legs) || !Number.isInteger(boundary) || boundary < 0 || boundary > legs.length)
    throw new RangeError('Invalid leg insertion position.');
  const result = [...legs];
  result.splice(boundary, 0, leg);
  return result;
}

export function moveLegToBoundary(legs, from, boundary) {
  if (!Array.isArray(legs) || !Number.isInteger(from) || from < 0 || from >= legs.length ||
      !Number.isInteger(boundary) || boundary < 0 || boundary > legs.length)
    throw new RangeError('Invalid flight leg move.');
  const result = [...legs];
  const [moved] = result.splice(from, 1);
  result.splice(boundary > from ? boundary - 1 : boundary, 0, moved);
  return result;
}

/**
 * Drag by the dedicated grab handle, not by text fields: normal typing,
 * text selection, keyboard arrows and checkbox editing are unaffected.
 * Row-end + buttons insert a blank leg after that row; drag targets are row halves.
 * All operations read the live form before rerendering to preserve unsaved data.
 */
export function installLegReordering(container, {readLegs, renderLegs, blankLeg, createInsertedLeg = (_legs,_index) => blankLeg(), onChange}) {
  let draggingFrom = null;
  let dropTarget = null;
  const rows = () => [...container.querySelectorAll('[data-leg-row]')];

  function clearDrop() {
    container.querySelectorAll('.leg-drop-before, .leg-drop-after, .leg-dragging')
      .forEach(el => el.classList.remove('leg-drop-before', 'leg-drop-after', 'leg-dragging'));
    dropTarget = null;
  }

  function targetFor(event) {
    const element = event.target instanceof Element ? event.target : null;
    if (!element || !container.contains(element)) return null;
    const row = element.closest('[data-leg-row]');
    if (!row || !container.contains(row)) return null;
    const index = rows().indexOf(row);
    if (index < 0) return null;
    const rect = row.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    return {boundary:index + (before ? 0 : 1),element:row,css:before?'leg-drop-before':'leg-drop-after'};
  }

  container.addEventListener('click', event => {
    const button = event.target.closest('[data-insert-at]');
    if (!button || !container.contains(button)) return;
    const index = Number(button.dataset.insertAt);
    const before = readLegs();
    const legs = insertLegAt(before, index, createInsertedLeg(before, index));
    renderLegs(legs);
    rows()[index]?.querySelector('[data-field="flightNumber"]')?.focus();
    onChange?.(`Inserted a flight leg at position ${index + 1}.`);
  });

  container.addEventListener('dragstart', event => {
    const grip = event.target.closest('[data-leg-drag-handle]');
    if (!grip || !container.contains(grip)) return;
    const index = rows().indexOf(grip.closest('[data-leg-row]'));
    if (index < 0) { event.preventDefault(); return; }
    draggingFrom = index;
    event.dataTransfer.effectAllowed = 'move';
    // Required for native drag-and-drop in Firefox.
    event.dataTransfer.setData('text/plain', 'reorder-flight-leg');
    grip.closest('[data-leg-row]').classList.add('leg-dragging');
  });

  container.addEventListener('dragover', event => {
    if (draggingFrom === null) return; // Ignore files/text dragged from outside.
    const target = targetFor(event);
    if (!target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dropTarget?.element === target.element && dropTarget?.css === target.css) return;
    container.querySelectorAll('.leg-drop-before, .leg-drop-after').forEach(el =>
      el.classList.remove('leg-drop-before', 'leg-drop-after'));
    target.element.classList.add(target.css);
    dropTarget = target;
  });

  container.addEventListener('drop', event => {
    if (draggingFrom === null) return;
    const target = targetFor(event) || dropTarget;
    if (!target) { clearDrop(); draggingFrom = null; return; }
    event.preventDefault();
    const from = draggingFrom;
    const boundary = target.boundary;
    clearDrop(); draggingFrom = null;
    if (boundary === from || boundary === from + 1) return; // No-op.
    const next = moveLegToBoundary(readLegs(), from, boundary);
    renderLegs(next);
    const destination = boundary > from ? boundary - 1 : boundary;
    rows()[destination]?.querySelector('[data-field="flightNumber"]')?.focus();
    onChange?.(`Moved leg ${from + 1} to position ${destination + 1}.`);
  });

  container.addEventListener('dragend', () => { draggingFrom = null; clearDrop(); });
}
