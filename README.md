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

### Tests

```bat
mvnw test              :: Java
npm test               :: front-end
cd mobile && npm test  :: the phone's local API
```
