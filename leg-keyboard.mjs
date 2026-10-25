/**
 * Spreadsheet-like keyboard handling for the flight-leg editor.
 * Only input fields within the editor grid are affected. Text caret movement,
 * text selection and Ctrl/Alt/Meta shortcuts remain native where applicable.
 */
export const LEG_KEYBOARD_FIELDS = Object.freeze([
  'flightNumber', 'departure', 'arrival', 'callsign', 'notes', 'completed',
]);

function moveFocus(container, rowIndex, columnIndex, caretPosition) {
  const rows = [...container.querySelectorAll('[data-leg-row]')];
  const destination = rows[rowIndex]?.querySelector(`[data-field="${LEG_KEYBOARD_FIELDS[columnIndex]}"]`);
  if (!destination) return false;
  destination.focus();
  if (destination.matches('input[type="text"], input:not([type])')) {
    const offset = caretPosition === 'end' ? destination.value.length :
      caretPosition === 'start' ? 0 : Math.min(caretPosition, destination.value.length);
    destination.setSelectionRange(offset, offset);
  }
  return true;
}

export function installLegKeyboardNavigation(container, { readLegs, renderLegs, blankLeg, createInsertedLeg = (_legs,_index) => blankLeg() }) {
  container.addEventListener('keydown', event => {
    const field = event.target.closest('[data-field]');
    const row = field?.closest('[data-leg-row]');
    if (!row || !container.contains(row) || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;

    const rows = [...container.querySelectorAll('[data-leg-row]')];
    const rowIndex = rows.indexOf(row);
    const columnIndex = LEG_KEYBOARD_FIELDS.indexOf(field.dataset.field);
    if (rowIndex < 0 || columnIndex < 0) return;

    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault(); // Must not submit the trip form.
      const legs = readLegs(); // Preserve every unsaved edit and checkbox state.
      legs.splice(rowIndex + 1, 0, createInsertedLeg(legs, rowIndex + 1));
      renderLegs(legs);
      moveFocus(container, rowIndex + 1, 0, 'start');
      return;
    }

    if (event.shiftKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;

    // Horizontal arrows edit text normally until the insertion point reaches
    // the first/last character. Never steal an arrow that collapses a selection.
    const isText = field.matches('input:not([type]), input[type="text"], textarea');
    if (isText && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      if (field.selectionStart !== field.selectionEnd) return;
      if (event.key === 'ArrowLeft' && field.selectionStart !== 0) return;
      if (event.key === 'ArrowRight' && field.selectionEnd !== field.value.length) return;
    }

    let nextRow = rowIndex;
    let nextColumn = columnIndex;
    let caretPosition = 'start';
    if (event.key === 'ArrowDown') nextRow++;
    else if (event.key === 'ArrowUp') nextRow--;
    else if (event.key === 'ArrowRight') {
      nextColumn++;
      if (nextColumn === LEG_KEYBOARD_FIELDS.length) { nextColumn = 0; nextRow++; }
    } else {
      nextColumn--;
      if (nextColumn < 0) { nextColumn = LEG_KEYBOARD_FIELDS.length - 1; nextRow--; }
      caretPosition = 'end';
    }
    if (nextRow < 0 || nextRow >= rows.length) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      // Keep the character position when moving vertically between cells.
      caretPosition = isText ? field.selectionStart : 'start';
    }
    if (moveFocus(container, nextRow, nextColumn, caretPosition)) event.preventDefault();
  });
}
