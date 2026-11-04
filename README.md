# Expense Tracker

> 🚧 **Work in progress**  
> This project is still under active development. New features, performance improvements and visual tweaks are constantly being implemented.

Tracking of expenses, income and budgets. Runs on **PC (Windows)** and on **mobile (Android)**.

## Technologies

- Java 21
- Spring Boot, Spring Data JPA, Flyway
- H2 (embedded database; the only one supported)
- JavaFX WebView
- HTML, CSS and JavaScript
- Capacitor 8 (Android)
- sql.js (SQLite)
- pdf-lib, fflate
- Supabase (Postgres, optional) and Web Crypto / AES-GCM for the PC ⇄ phone sync
- JUnit, `node --test`

## How to run and build

### PC

**Requirements:** JDK 21 (Maven comes with the project, through `mvnw`).

```bat
run.bat                :: runs on this computer only (http://localhost:8080)
run.bat celular        :: opens access on the local network (use the address from the log on your phone)
run-jar.bat            :: runs the already built .jar
build-exe.bat          :: builds dist\ExpenseTracker\ExpenseTracker.exe (Java included)
build-installer.bat    :: builds the .msi installer (needs WiX Toolset 3.x)
```

### Mobile (Android)

**Requirements:** Node 20+ and Android Studio (it brings the SDK and the JDK).

```bat
cd mobile
npm install
npm run serve          :: tests in the browser (http://localhost:5173), no Android needed
npm run android:open   :: bundles the app and opens the project in Android Studio (▶ Run)
npm run android:apk:offline :: builds the offline APK (android\app\build\outputs\apk\offline\debug\)
npm run android:apk:sync    :: builds the APK with sync (android\app\build\outputs\apk\sync\debug\)
```

There are two builds (Android *flavors*): **offline** (no internet permission at all, nothing leaves the phone) and **sync** (same app plus the PC ⇄ phone sync below; installs next to the offline one, with its own data). `npm run android:apk` is the offline one.

After changing the front-end or `mobile/src`, run `npm run sync` before running again.

## Sync between PC and phone (optional)

Keeps the computer and the phone on the same data, automatically: entries, accounts, categories, budgets, goals, recurring payments,
templates and attachments. **Off until you connect**; without it, both apps work as always.

- **How it works:** each device sends what changed and reads what changed on the other, through a small hub on
  [Supabase](https://supabase.com). The latest edit of a record wins; deletions travel too. Everything is **encrypted on the device**
  (PBKDF2 → AES-256-GCM) with a *sync password* that never leaves your devices: the server only stores unreadable text.
  It syncs when the app opens, a few seconds after you save something and every 5 minutes; with no internet, changes wait.
- **Two ways to connect** (both explained step by step inside the app, in **More → Sync → How to set up**):
  1. **Default server** — a Supabase project baked into the build: just e-mail, password and sync password. To offer it, fill
     `sync.hub.url` and `sync.hub.anon-key` in `src/main/resources/application.properties` (PC) and `url` / `anonKey` in
     `mobile/sync-hub.json` (phone). Empty = this option is not shown.
  2. **Your own Supabase project** — free; create it, run [`sync/supabase-hub.sql`](src/main/resources/static/sync/supabase-hub.sql)
     in its SQL Editor (the app has a *Copy the script* button), turn off *Confirm email* and paste the project URL and the `anon` key.
- **Several profiles:** each profile syncs its own data, and the list of profiles is kept equal on every device: a new profile
  appears by itself on the others, renames go along, and **removing a profile moves it to the profile trash** on all devices
  (**More → Profiles → Profile trash**: restore it, or *Delete for good*, which also deletes it everywhere).
- **Restoring a backup** asks where: over any existing profile (a warning says it cannot be undone and offers a backup of that
  profile first) or into a **new profile**. Overwriting with sync on also overwrites the cloud and the other devices, by force:
  what the backup does not have is deleted there.
- **Limits and cautions:** attachments larger than **3 MB** stay on the device they were added on (the app accepts up to 5 MB);
  if you forget the sync password the data in the cloud cannot be recovered (the data on your devices stays); the connection data
  (including the sync password) is stored in plain text on the device, outside the backups; free Supabase projects are paused
  after about 7 days without activity (restore them from the dashboard). Use the same sync password on every device.

### Tests

```bat
mvnw test              :: Java
npm test               :: front-end
cd mobile && npm test  :: the phone's local API
```
