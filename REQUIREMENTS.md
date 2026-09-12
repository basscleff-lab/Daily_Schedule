# Work Hub: Requirements & Deployment Guide
**Target Installation Path:** `C:\Apps\Daily_Schedule`

---

## 1. System Requirements
The tracker needs **zero third-party development tools**. Everything required to run the floating tracker and invoice dashboard is **already built into Windows**.

| Component | Required Version | Status on Standard Windows PC |
|---|---|---|
| **Operating System** | Windows 10 (Home/Pro) or Windows 11 | Standard on virtually all modern PCs |
| **PowerShell** | Windows PowerShell **5.1** | **Pre-installed out of the box** (`powershell.exe`) |
| **GUI Framework** | Windows Presentation Foundation (WPF) / .NET 4.5+ | **Pre-installed out of the box** by Microsoft |
| **Web Browser** | Microsoft Edge, Google Chrome, Brave, or Firefox | For viewing itemized invoices and reports |
| **Node.js / Python** | **NOT NEEDED** | Zero runtime dependencies. |
| **Admin Privileges** | Optional / Standard user | Installs directly to `C:\Apps\Daily_Schedule` |

---

## 2. Fast USB Deployment (3 Easy Steps)

### Step 1: Copy to USB
Copy the entire `Daily_Schedule` folder onto your USB flash drive.

### Step 2: Plug into Target Laptop
Insert the USB drive into the PC and open the folder.

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
   - **"Work Tracker"** (Launches the floating transport bar).
   - **"Invoices & Reports"** (Opens the full dashboard).

---

## 3. Data Storage & JSON Backups

All shifts, hours, and appointments are stored safely in human-readable JSON files in `data\`:
- `data\shifts.json`: All completed shift records.
- `data\callbacks.json`: Scheduled client callbacks.
- `data\calls.json`: Daily call activity logs.
- `data\sales_reps.json`: Sales representative list.
- `data\history\`: 5-minute rolling auto-save recovery snapshots.

All data files remain local to the PC and are never committed to remote source repositories.
