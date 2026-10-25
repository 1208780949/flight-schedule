# Flight Schedule v1.7 — Trip editor validation and active-flight workflow

Built from the **working v1.6 release**, without the experimental v1.4.1 sign-in hotfix. Firestore authentication and rules are unchanged.

## Changes

1. **Sidebar order:** Active trips now appears above Flight planning; Flight archive remains third.
2. **Width-aware route previews:** The cards display as many airports as their actual width permits, preserving the first and last airport when abbreviating. A `ResizeObserver` updates the text when card width changes (including narrowing the browser window or selecting a single region).
3. **Route continuity validation:** The editor prevents Save trip when the arrival ICAO of leg `i` differs from the departure ICAO of leg `i+1`. A message identifies the affected legs and airports, and focuses the offending departure field. Airport case is normalised.
4. **New leg default departure:** Shift+Enter, the row-end `+` button, and Add leg pre-fill the new leg's departure using the preceding leg's current arrival. Insert first remains blank because no preceding flight exists.
5. **Upcoming flight on Active card:** A dedicated section shows the next unfinished flight's route and flight number with a **Complete** button. It changes Firestore immediately and reflects across devices. If all flights are done, the card indicates the trip is ready to archive.
6. **Details completion permissions:** Checkboxes in View details are enabled **only for Active trips**. Planned and Archived flights are read-only in View details. Editing an itinerary is a separate operation.
7. **Completion integrity on editor Save:** Completion must form a contiguous prefix from leg 1, or all legs may be incomplete. Later completed legs after a gap prevent Save. A transaction also enforces this when marking completed legs on active trip cards or in trip details.
8. **Card layout:** Removed the redundant aircraft-type label above the trip name. The name already contains the aircraft type.
9. **Card sorting:** Cards are sorted alphabetically by trip name, using natural numeric order, within each region.

## Upgrade from v1.6

1. Back up existing trips using **Backup** on the live website.
2. Replace `app.js`, `index.html`, `styles.css`, `leg-keyboard.mjs`, and `leg-reorder.mjs`.
3. Add the two new modules `trip-validation.mjs` and `route-summary.mjs` in the **repository root**, alongside `app.js`.
4. Commit to `main`, check GitHub Actions for successful Pages deployment, then hard-refresh the website (`Ctrl+Shift+R`).

There is **no change to Firebase configuration, Firestore rules, schema, login, or imported data**. Do not reimport your backup and do not publish private schedules in GitHub.

## Important behaviour

- For legacy trips with discontinuous flight routes or gaps in completed legs, v1.7 will not silently edit their contents. Open the trip editor and correct the route and/or completion flags before saving.
- The upcoming-leg Complete action checks the latest server-side trip status, leg identity and completion order inside a Firestore transaction, so a stale card cannot complete a different leg after another device reorders the trip.
- A fully completed active trip still requires explicit archive action via View details.
- Validation happens in the **trip editor** before writing; historical data and imports are not modified automatically.
