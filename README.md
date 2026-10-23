# Flight Schedule v1.0 — GitHub Pages + Firebase Firestore

A private, mobile-friendly flight itinerary planner. Flight plans are organised by **status**, **region**, and **aircraft type**. Online saving and multi-device synchronization use Firebase Firestore.

## Main rules

- Three distinct regions: **North America**, **Europe**, **Rest of World**.
- Every trip belongs to one region and one aircraft type.
- At most **one active trip in each region** (three possible simultaneously). A Firestore transaction reserves each active region's `activeSlots` document to prevent activation collisions between browsers.
- Planned and archived trips can contain unlimited itineraries in any region and aircraft type.
- Each itinerary contains ordered flight legs: flight number, callsign, departure, arrival, notes, and a completion checkbox.
- Planned → Active → Archived; archived trips can be moved back to planning or reactivated.

## 1. Firebase setup

This app is configured for Firebase project `flight-schedule-5704d` in `firebase.js`.

1. At <https://console.firebase.google.com/> open **flight-schedule-5704d**.
2. **Build → Firestore Database**: create the default database if you have not already done so. Start in **production mode**, not test mode.
3. **Build → Authentication → Sign-in method**: enable **Email/Password**.
4. **Authentication → Users → Add user**: create your own email-and-password account. The website has *sign-in only*; it does not expose public account registration.
5. **Firestore Database → Rules**: replace the default text with the complete contents of [`firestore.rules`](./firestore.rules), then **Publish**. These rules restrict each account to its own `users/{uid}/...` records and cross-check the active-region slots and trip statuses atomically.
6. If Firebase Authentication reports that your GitHub Pages site is not an authorized domain, add `<github-username>.github.io` under **Authentication → Settings → Authorized domains**.

**Important:** Never publish a service-account JSON file or a Firebase private key. `firebase.js` contains only the standard public web-app config. Protect the data with Firestore security rules.

## 2. Publish on GitHub Pages

1. Create a new GitHub repository, e.g. `flight-schedule`. For free Pages deployment on some plans, a **public** repo is needed, so **do not put your private import JSON file in the repository**.
2. Copy the files in **this application folder only** to the repository root (`index.html`, `app.js`, `domain.mjs`, `firebase.js`, `styles.css`, `favicon.svg`, `firestore.rules`, `.nojekyll`, and `README.md`). You can use **Add file → Upload files** on GitHub after extracting the ZIP, or Git locally.
3. Open the repository's **Settings → Pages → Build and deployment → Deploy from a branch**. Choose your default branch (`main`) and **/(root)**, then Save.
4. The website will be available at `https://<github-username>.github.io/flight-schedule/` after GitHub publishes it.
5. Open the site, sign in using the email/password you added in Firebase Authentication.

No Node/npm build and no server required; the application imports pinned Firebase JavaScript SDK modules from Google's CDN.

## 3. Import the original Excel schedule

**Do not add `flight_schedule_import_PRIVATE.json` to your public GitHub repository.** It contains route history extracted from your workbook.

1. Download the **separate** `flight_schedule_import_PRIVATE.json` file alongside this ZIP.
2. Open the published website and sign in.
3. Click **↑ Import** and choose that private JSON file.
4. Confirm. New trips will be uploaded directly from your browser to **your account's Firestore collection**. Data does not pass through GitHub.
5. The importer is idempotent: existing trip IDs are skipped rather than overwritten, so you can safely choose the same file again.
6. Optionally delete the local import JSON file after verifying the migration, or keep it as a private backup.

The migration converts the three parallel itinerary columns to three region categories. It also imports DC-3 / DC-6 / Aero Lloyd / A350 / Long Haul / Extinction File Tour sheets where possible. The **Active** and **Completed** worksheets don't contain aircraft type information, so their trips import with aircraft `Unspecified`, which you can edit later. The exceptional tour-format sheets did not all have geographic group columns; their regions are inferred conservatively from departure and flagged for review. Consult the separate migration report.

## 4. Day-to-day use

- Choose **Flight planning**, **Active trips**, or **Flight archive** in the left-hand sidebar.
- Use **All regions / North America / Europe / Rest of World** across all three views.
- Select an aircraft type in the sidebar, including `Unspecified` for unclassified legacy trips.
- Create a trip and multiple legs, change their order in **Edit itinerary**, and save.
- Activate a planned trip. If that region is occupied, move the active trip to planning or archive it first.
- In the active trip, click the checkboxes after flying each leg. Then click **Archive completed trip**. If some legs are unchecked, **Complete & archive trip** asks for explicit confirmation before marking them all complete.
- Click **↓ Backup** regularly. The JSON backup is also supported by the import feature.

## 5. Cloud data structure

```
users/{firebase-auth-uid}/trips/{trip-id}
  title, aircraft, region, status, notes
  legs: [ {flightNumber, callsign, departure, arrival, notes, completed}, ... ]
  createdAt, updatedAt, activatedAt, archivedAt
  sourceSheet, sourceRow, sourceColumn, importKey (only for migrated data)

users/{firebase-auth-uid}/activeSlots/north-america
users/{firebase-auth-uid}/activeSlots/europe
users/{firebase-auth-uid}/activeSlots/rest-of-world
  tripId: the single active itinerary ID
```

The Firestore document limit is 1 MiB. A maximum of 300 legs per trip is enforced by this first version. Larger itineraries should be split into multiple trips in the same region.

## 6. Backup and privacy

- Your trip documents are scoped to the Firebase Authentication user ID by security rules. Signing in with a **different** Firebase account gives that account a separate schedule.
- GitHub hosts **only the code**. Private flight data must be imported through the website, not committed to the repository.
- Firebase Spark usage quotas apply. The app doesn't require billed Firebase services.
- Download JSON backups regularly. The free tier does not supply automated managed backups.
- **Do not open `index.html` as a `file://` URL**; use GitHub Pages or a local HTTP server. For a local test run `python -m http.server 8000` in the application folder and open `http://localhost:8000`. `localhost` may need to be added as an authorized domain in Authentication settings in some configurations.

## Limitations / next steps

- There is no automatic live import of `Flight Schedule.xlsx`; the provided private migration JSON already contains the extracted trips.
- The web app is optimized for a personal user. No team collaboration or cross-account schedule merging is provided.
- Imported historical data is not guaranteed perfectly clean; review the `migration_report.txt` supplied separately, especially cross-region tours, uncertain ICAO labels and disjoint route sections.
- The interface saves changes online, but actual sign-in and database access require your Firebase project to be configured as described above.
