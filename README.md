# Flight Schedule v1.9 — Dark mode, Active landing, and aircraft filter scoping

Built directly from **v1.8**, retaining the existing Firebase configuration, trip data model, aircraft groups, number allocation, validation, active slots, and airport search.

## Changes

1. **Dark mode is the default** on first visit, including the sign-in screen, Active board, planning board, trip dialogs, and airport search. Select **Light mode** in the header to switch to the previous light styling; the preference is saved locally in the browser (no Firestore write). Select **Dark mode** to switch back. If local storage is blocked, theme works for the current page session but may reset on reload.
2. **Active trips is the opening view** after sign-in and after reloading the page. The Active sidebar tab is first and is selected on load. North America, Europe, and Rest of World remain three independent active slots.
3. **Aircraft group and aircraft-type sidebar filters apply only to Flight planning and Flight archive.** The aircraft-group sidebar is hidden in Active trips and Airport search. Active shows all active trips permitted by the region and airline dropdown filters, regardless of a group/type previously selected in Planning or Archive. Group/type selections are retained when moving between Planning and Archive. The separate aircraft filter on the Airport search page remains independent and unchanged.

## Upgrade from v1.8

1. Download a JSON backup of your trip data from the existing website if desired.
2. Replace **`app.js`**, **`index.html`**, and **`styles.css`** in the **root** of your GitHub Pages repository with the files from this v1.9 patch. Keep all other files, including `airport-search.mjs`, in place.
3. Commit the changes to `main`; wait for GitHub → Actions → Pages build and deployment to succeed.
4. Refresh the live website with **Ctrl+Shift+R**. The footer should now read **Flight Schedule v1.9**.

**No Firestore rule changes, Firebase authentication changes, data migration, or trip re-import are required.** The application remains the same GitHub Pages static site backed by your existing Firebase project. Do not upload private schedule JSON exports to a public repository.

If upgrading from v1.7 or earlier, use the **full v1.9 release ZIP** and upload the contents of the folder directly into the repository root, rather than adding an extra folder level.

## Validation

JavaScript syntax checks passed for all JavaScript modules; CSS parsing and relevant static checks passed. An end-to-end Chromium browser test was attempted but the execution environment blocked all browser navigation. Browser display and live Firebase interaction have **not** been verified here.
