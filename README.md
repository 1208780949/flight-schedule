# Flight Schedule v1.8 — Airport occurrence search

Based directly on **v1.7**. No changes to Firebase authentication, Firestore rules, existing trip documents, or aircraft grouping data.

## New feature

Use **Airport search** in the left sidebar to find how often an airport appears in the saved flight legs.

- Search by exact 3–5 character airport code (e.g., `KATL`; case-insensitive).
- Default filters: **All aircraft**, **All regions**, **Planned**.
- Aircraft filter: all types, one aircraft type, or an existing aircraft group.
- Region filter: all, North America, Europe, Rest of World.
- Status filter: Planned, Active, Archive, or All statuses.
- Results show total occurrences, departures, arrivals, number of matching trips, and a table linking to matching trip details.
- Every matching departure or arrival endpoint counts once. A leg with the same departure and arrival airport counts twice.
- The results table shows up to the first 100 matching flight legs, sorted by trip name and leg order, but the counters always include all matches.
- Search filters are independent of the trip board filters, and results update automatically as Firestore syncs.
- Entire search is read-only and performed over the current signed-in user's Firestore trips. It does not query public airport databases or make any new writes.

## Update from v1.7

1. If desired, make a backup from the running site with **Backup** before updating.
2. Replace `app.js`, `index.html`, and `styles.css` in your GitHub repository root with the files from this release.
3. Upload the **new** `airport-search.mjs` in the repository root (next to `app.js`).
4. Commit directly to the `main` branch; check the GitHub Pages deployment under **Actions**.
5. Reload the published site using **Ctrl + Shift + R**. The footer should read *Flight Schedule v1.8*.

**No Firebase setup, security-rule update, re-import, or migration is needed.** Your actual flight schedules stay in Firestore; do not upload private JSON backups to a public GitHub repository.

If you are upgrading from earlier than v1.7, use the full release to ensure the required modules are all present. Files must be uploaded directly into the repository root, not inside the ZIP's containing folder.

## Validation

The pure airport counting module passed Node.js unit tests covering departure/arrival counting, same-airport round trips, aircraft and regional filters, status filters, case-insensitive input, and non-mutation of trip data. JavaScript syntax checks passed. An automated full browser test and a live Firebase deployment could not be completed in this execution environment. The code requires deployment to GitHub Pages for live verification.
