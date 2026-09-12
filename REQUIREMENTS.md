# Sabrina Work Hub: Requirements & Deployment Guide
**Client:** Optima Windows and Doors  
**Target Installation Path:** `C:\Apps\Daily_Schedule`

---

## 1. System Requirements for Sabrina's PC

Sabrina's laptop needs **zero third-party development tools**. Everything required to run the floating tracker and invoice dashboard is **already built into Windows**.

| Component | Required Version | Status on Standard Windows PC |
|---|---|---|
| **Operating System** | Windows 10 (Home/Pro) or Windows 11 | ? Standard on virtually all modern PCs |
| **PowerShell** | Windows PowerShell **5.1** | ? **Pre-installed out of the box** (`powershell.exe`) |
| **GUI Framework** | Windows Presentation Foundation (WPF) / .NET 4.5+ | ? **Pre-installed out of the box** by Microsoft |
| **Web Browser** | Microsoft Edge, Google Chrome, Brave, or Firefox | ? For viewing itemized invoices and reports |
| **Google Antigravity** | **NOT NEEDED** | ? Antigravity is just the AI coding assistant used to build this codebase. It is not required on the client PC. |
| **Node.js / Python / Git** | **NOT NEEDED** | ? Zero runtime dependencies. No npm, no pip, no compiling. |
| **Admin Privileges** | Optional / Standard user | ? Installs directly to `C:\Apps\Daily_Schedule` or `%USERPROFILE%\Apps\Daily_Schedule` |

---

## 2. Fast USB Deployment (3 Easy Steps)

### Step 1: Copy to USB
Copy the entire `Daily_Schedule` folder onto your USB flash drive.

### Step 2: Plug into Sabrina's Laptop
Insert the USB drive into Sabrina's PC and open the folder.

### Step 3: Run the 1-Click Installer
Double-click:
```bat
Deploy_To_This_PC.bat
```

#### What `Deploy_To_This_PC.bat` Does Automatically:
1. **Tests compatibility**: Confirms Windows PowerShell 5.1 and WPF are present.
2. **Creates folders**: Creates `C:\Apps\Daily_Schedule` and `data\backups`.
3. **Preserves existing data**: If an existing `shifts.json` is found, it automatically creates a safety snapshot in `backups\` before updating.
4. **Copies files**: Copies all scripts, styles, and templates.
5. **Creates Desktop Shortcuts**:
   - ?? **"Sabrina Work Tracker"** (Launches the floating transport bar).
   - ?? **"Sabrina Invoices & Reports"** (Opens the full web dashboard).
6. Prompts to launch the tracker immediately.

---

## 3. Data Storage & JSON Backups

All of Sabrina's shifts, hours, and appointments are stored safely in human-readable JSON files:

### Primary Data Location:
* `C:\Apps\Daily_Schedule\data\shifts.json`: All completed shift records, split shifts, on-phone vs. off-phone totals, and appointment tallies.
* `C:\Apps\Daily_Schedule\data\active_session.json`: Live session state if paused or recovering from a reboot.
* `C:\Apps\Daily_Schedule\data\shifts_data.js`: Automatically synced data bundle loaded by the web invoice dashboard with zero CORS restrictions.

### Three Layers of Backup Protection:
1. **Automatic Shift Backups**: Every time Sabrina taps `STOP` to end a shift block, a timestamped snapshot is saved to `C:\Apps\Daily_Schedule\data\backups\shifts_backup_YYYYMMDD_HHMMSS.json`.
2. **Startup Daily Backup**: The first time the toolbar opens each day, it saves `shifts_backup_startup_YYYYMMDD.json`.
3. **Manual 1-Click Export & Restore (Advanced View)**:
   - Inside the web app ([`index.html`](file:///C:/Apps/Daily_Schedule/index.html)), go to the **Settings / Data** tab.
   - Click **`[Download Backup JSON]`** to save a complete copy to her Downloads folder or USB.
   - Click **`[Restore from Backup JSON]`** to instantly reload records if she ever migrates to a new laptop.

---

## 4. Web / Firebase Hosting vs. Local PowerShell Toolbar

### Can I publish this to Firebase Hosting?
**Yes!** The invoice dashboard ([`index.html`](file:///C:/Apps/Daily_Schedule/index.html)) is 100% static HTML, CSS, and Vanilla JavaScript. You can run `firebase init hosting` and `firebase deploy` to host it at `https://your-app.web.app` in under 3 minutes.

### Why the Local PowerShell Toolbar is Superior for Daily Tracking:

| Feature | Local Windows Toolbar (`floating_toolbar.ps1`) | Web-Only / Firebase App |
|---|---|---|
| **True Always-On-Top** | ? Stays pinned over Telus phone app, Excel, and Chrome tabs without interfering. | ? Browsers cannot float over external desktop apps unless Picture-in-Picture is active. |
| **Borderless Floating Widget** | ? Clean, borderless, draggable floating bar with zero window borders. | ? Standard browser tabs have address bars, bookmarks, and window chrome. |
| **100% Offline Reliability** | ? Writes directly to local disk. Never loses time if internet or Wi-Fi drops. | ?? Cloud requires stable internet; local browser storage stays trapped in browser cache. |
| **Zero Login Friction** | ? Launches from desktop shortcut in 0.5 seconds, already recording. | ? Requires opening browser, typing URL, or logging in. |

### Recommended Setup:
* **For Daily Tracking**: Use the native floating toolbar on her laptop (`Launch_Floating_Toolbar.bat`).
* **For Invoicing & Weekly Review**: Click `[Advanced]` on the toolbar to review the invoice on her laptop, OR upload her backup JSON to a Firebase-hosted mirror if you want to view her invoices remotely from your own computer!
