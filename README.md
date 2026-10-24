# Flight Schedule v1.6 — Compact trip editor and aircraft groups

This release is based directly on **v1.5**. It retains Firestore authentication, automatic trip naming, aircraft grouping, partial archive validation, drag-and-drop leg ordering and keyboard shortcuts.

## Changes

- The **＋** insert-leg button is now the rightmost control on each leg's row, beside the drag grip, up/down arrows and delete button. It inserts **after** that leg, eliminating the separate between-row insertion bands.
- **Insert first** in the editor header inserts before leg 1. **Add leg** still appends at the end. **Shift+Enter** still inserts directly below the focused row.
- You can still reorder rows by dragging the grip to the **upper or lower half of another row**; its blue border indicates the insertion position. Values and completion markers move with the leg.
- Aircraft groups in the sidebar have tighter spacing and their own **▾/▸ collapse button**, independent of the group-name filter button. Clicking a group name still filters all of its aircraft types, even when collapsed.
- Collapsed/expanded state is saved for the current browser and Firebase user via localStorage. Aircraft group membership remains saved in Firestore and synced between devices. You can drag an aircraft onto a collapsed group to move it there.

## Upgrade from v1.5

1. Back up your trips with **Backup** on the current website.
2. Replace **`app.js`**, **`styles.css`**, **`leg-reorder.mjs`**, and **`index.html`** in your GitHub repository root with the copies in this release. If your prior installation lacks any previous required `.mjs` files, use the full package.
3. Commit to the `main` branch. Check **Actions** for the GitHub Pages deployment, then press **Ctrl+Shift+R** on the website.

**No Firebase rules changes, Firestore migration or trip re-import is needed.** Do not upload any private JSON backup to a public GitHub repository.

## Notes

- Sidebar collapsed/expanded preferences are device-local; aircraft group assignment is cloud-synced.
- New legs and row ordering are not saved to Firestore until **Save trip** is pressed.
- This release does not incorporate the temporary v1.4.1 sign-in hotfix; the base is the working v1.4 → v1.5 code.
