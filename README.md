# Flight Schedule v1.2 — airline/aircraft trip numbering and partial archiving

Static website for GitHub Pages, using Firebase Authentication + Firestore for private multi-device data. Firebase project is already configured in `firebase.js` for `flight-schedule-5704d`.

## What changed in v1.2

- **Generated trip names:** `Airline Aircraft Trip n`, for example `Aer Lingus B737 Trip 2`. Users edit the **Trip number (n)**, not the title text. Sequence is shared across all statuses (Planned, Active, Archived) and geographic regions for the same airline + aircraft combination, beginning at 1.
- **Manually reserved trip numbers:** Entering a different trip number in the editor automatically ticks **Reserve this number manually**. The checkbox is saved in Firestore as `numberManual`. Manual numbers must be unique and in the interval **1 to the number of trips in that airline/aircraft group** (including the trip being created). A conflict with another manually reserved/archived number is reported as an error; other automatically numbered trips fill available numbers 1..N. Untick the checkbox to return a nonarchived trip to automatic allocation.
- **Existing trips:** Legacy v1.0/v1.1 titles are automatically converted on sign-in and all trip IDs, notes, statuses, flight legs and progress remain intact. Auto-assigned initial numbers are deterministic, using creation time and ID where available. Airline `Unassigned` / aircraft `Unspecified` continue to work until edited.
- **No redundant airline label:** Cards and trip details show the airline in the generated trip title; the separate `Airline: ...` label has been removed. Airline filtering remains available.
- **Archive completed legs:** On a *Planned* or *Active* trip, mark at least one leg complete, then choose **Archive completed legs**. When some legs are unfinished, an atomic Firestore transaction (1) archives only the completed legs under the **original trip number**, (2) creates a **new trip with number n+1** containing only the uncompleted legs, and (3) transfers the active-region slot to the successor if the original was active. Legs retain their original relative order and metadata, and the new trip keeps the airline, aircraft, region and notes. Archive the entire trip when all legs are complete. The archived original's number is protected as `numberLocked`.
- **Online concurrency:** A per-user Firestore numbering revision document serializes renumbering, edits, deletion, bulk import and trip splitting. Regional active slots are still protected transactionally.
- **Backups:** v1.2 exports `flight-planner-backup-v3` with airline, trip number and manual/archive locking fields. Earlier v1/v2 import formats remain supported. Do not re-import the old workbook just to get generated names.

## Important: upgrading existing GitHub Pages installation

**Make a backup from the current site first:** sign in → **↓ Backup**. Your existing Firestore data is **not** deleted by the upgrade. There is no need to create a new Firebase project or to re-import the Excel workbook.

### 1. Update Firestore security rules FIRST

This is **required** for v1.2. The app creates a new owner-only metadata document at `users/{uid}/metadata/numbering` to coordinate trip numbers across open browsers. The old v1.1 Firestore rules denied access to that path.

1. Open [Firebase Console](https://console.firebase.google.com/) → project **flight-schedule-5704d**.
2. Open **Firestore Database → Rules**.
3. Replace the rules there with the entire new **`firestore.rules`** in this ZIP and click **Publish**.
4. Leave Firebase Authentication and its users unchanged.

### 2. Update the GitHub repository

Go to the repository root on the `main` branch. Use **Add file → Upload files**, and upload these files from the *inside* of the extracted folder:

- `app.js` — replace existing file
- `domain.mjs` — replace existing file
- **`numbering.mjs` — NEW file, must be uploaded**
- `index.html` — replace existing file
- `styles.css` — replace existing file
- `README.md` — optional replacement

Keep your existing `firebase.js`, `favicon.svg`, and `.nojekyll` unchanged. Commit to `main`. GitHub Pages settings stay **Deploy from branch / main / (root)**. Once the deployment finishes, refresh the website using **Ctrl+Shift+R** and check the footer says **Flight Schedule v1.2**.

### 3. Verify and back up

Sign in. Initial trip-number migration runs automatically. In a group containing several trips for the same airline and aircraft, all should display generated names `Trip 1`, `Trip 2`, ... regardless of region or status. Once migrated, download another backup. If migration reports **Permission denied**, revisit the Firestore rules from Step 1.

## Numbering/archiving edge cases

- If a requested manual number is outside `1..N`, saving fails; it never silently uses an invalid number.
- If a trip number has already been *manually reserved or protected by an archive*, saving/splitting into that number fails; the user must first release or modify that reservation. Automatically numbered trips can be reassigned.
- Splitting an active trip keeps its successor **active in the same region**. This does not open a slot for a second active trip there; the normal one-active-per-region rule continues to apply.
- Completed legs can be non-contiguous. The archive receives *all checked legs in their original order*, while the successor receives *all unchecked legs in their original order*.
- If no leg is checked, the Archive button is disabled. If all legs are checked, archiving does not create an empty successor.
- Protected archived trip numbers can prevent deleting/reclassifying a trip if it would make a protected number greater than the resulting group size. The app reports this rather than breaking the sequence. To reorganise that group, change relevant trip numbers/reservations first.
- No modification is made to the original `Flight Schedule.xlsx` file, and no private Excel-derived JSON is included in the GitHub ZIP.
- This implementation is designed for a personal database; renumbering transactions support up to 450 document writes per operation. A very large archive would need chunked migration/server-side allocation.

## Data model

`users/{uid}/trips/{tripId}` holds `airline`, `aircraft`, `region`, `status`, `legs`, `tripNumber`, `numberManual`, `numberLocked`, and generated `title`, plus previous timestamp/source metadata. `users/{uid}/activeSlots/{region}` holds the active trip ID. `users/{uid}/metadata/numbering` holds a monotonically increasing `revision` as a concurrency guard.

## Development tests

`node test-numbering.mjs` checks pure numbering, manual pinning and archived split numbering. `python test-ui.py` uses an offline Firebase mock and Chromium Playwright to exercise the UI. No live connection to the user's Firebase project is made by these tests.
