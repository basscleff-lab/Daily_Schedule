// Daily Work Hub & Time Tracker - Core Engine
// Client: Configurable in Settings

(function() {
  'use strict';

  // --- Constants & Defaults ---
  const STORAGE_KEYS = {
    SHIFTS: 'tracker_shifts_v1',
    ACTIVE_SESSION: 'tracker_active_session_v1',
    SETTINGS: 'tracker_settings_v1',
    TODAY_APPTS: 'tracker_today_appts_v1',
    COMPACT_MODE: 'tracker_compact_mode_v1',
    CALLBACKS: 'tracker_callbacks_v1',
    CALLS: 'tracker_calls_v1',
    SALES_REPS: 'tracker_sales_reps_v1',
    SNAPSHOTS: 'tracker_snapshots_v1',
    DELETED_IDS: 'tracker_deleted_ids_v1',
    THEME: 'tracker_theme_v1'
  };

  const DEFAULT_SALES_REPS = [
    'Representative 1',
    'Representative 2',
    'Representative 3',
    'Lead Coordinator'
  ];

  const ACTIVITY_NAMES = {
    inbound_call: { name: 'Inbound Call', isPhone: true, icon: '📞' },
    outbound_call: { name: 'Outbound Call', isPhone: true, icon: '📱' },
    text_sms: { name: 'Text / SMS Follow-up', isPhone: false, icon: '💬' },
    email_in: { name: 'Email Inbound', isPhone: false, icon: '📥' },
    email_out: { name: 'Email Outbound', isPhone: false, icon: '📤' },
    off_phone_work: { name: 'Off-Phone / Booking Admin', isPhone: false, icon: '📋' }
  };

  const syncChannel = window.BroadcastChannel ? new BroadcastChannel('tracker_sync_channel') : null;

  // --- Application State ---
  let state = {
    version: '1.5.5',
    build: '2026.09.14-rev2',
    releaseDate: '2026-09-14',
    settings: {
      contractorName: 'Contractor',
      clientName: 'Client Company',
      hourlyRate: 25.00
    },
    shifts: [],
    activeSession: null, // { startTime, status: 'RUNNING'|'PAUSED', pauseStartTime, totalPausedMs, currentActivity, activityTimeMap: {} }
    todayAppts: 0,
    isCompact: false,
    callbacks: [],
    cbFilter: 'all',
    calls: [],
    salesReps: [],
    deletedIds: {}, // { [id]: epochMs }
    snapshots: [],
    undoStack: [],
    theme: 'dark'
  };

  let timerInterval = null;
  let snapshotInterval = null;
  let diskDirectoryHandle = null;
  let diskSyncDebounce = null;

  // --- Utility Functions ---

  function getTorontoNow() {
    return new Date();
  }

  // Format time in 12-hour Toronto format (e.g. "09:15 AM", "03:45 PM")
  function format12HourTime(dateObj) {
    if (!dateObj) return '--:--';
    const d = new Date(dateObj);
    return d.toLocaleTimeString('en-US', {
      timeZone: 'America/Toronto',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  }

  // Format date string YYYY-MM-DD for grouping
  function formatDateKey(dateObj) {
    const d = new Date(dateObj);
    const year = d.toLocaleDateString('en-CA', { timeZone: 'America/Toronto', year: 'numeric' });
    const month = d.toLocaleDateString('en-CA', { timeZone: 'America/Toronto', month: '2-digit' });
    const day = d.toLocaleDateString('en-CA', { timeZone: 'America/Toronto', day: '2-digit' });
    return `${year}-${month}-${day}`;
  }

  // Format friendly date (e.g. "Friday, Sep 11, 2026")
  function formatFriendlyDate(dateStrOrObj) {
    const d = new Date(dateStrOrObj);
    return d.toLocaleDateString('en-US', {
      timeZone: 'America/Toronto',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  // Convert seconds to "Xh Ym"
  function formatHoursMinutes(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    return `${hours}h ${mins.toString().padStart(2, '0')}m`;
  }

  // Convert seconds to "HH:MM:SS"
  function formatStopwatch(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // Record tombstone deletion
  function recordDeletedId(id) {
    if (!id) return;
    const now = Date.now();
    if (!state.deletedIds || typeof state.deletedIds !== 'object') state.deletedIds = {};
    state.deletedIds[id.toString()] = now;
    try {
      localStorage.setItem(STORAGE_KEYS.DELETED_IDS, JSON.stringify(state.deletedIds));
    } catch (e) {}
    persistState();
  }

  // Check if an item has been deleted via tombstone
  function isItemDeleted(item) {
    if (!item || !item.id || !state.deletedIds) return false;
    const delTime = state.deletedIds[item.id.toString()];
    if (!delTime) return false;
    const itemUpdated = item.updatedAt || item.endTime || item.completedAt || item.createdAt || 0;
    const itemEpoch = typeof itemUpdated === 'number' ? itemUpdated : (new Date(itemUpdated).getTime() || 0);
    return delTime >= itemEpoch;
  }

  // Save State to LocalStorage & trigger disk sync
  function persistState() {
    try {
      localStorage.setItem(STORAGE_KEYS.SHIFTS, JSON.stringify(state.shifts));
      localStorage.setItem(STORAGE_KEYS.ACTIVE_SESSION, JSON.stringify(state.activeSession));
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(state.settings));
      localStorage.setItem(STORAGE_KEYS.TODAY_APPTS, JSON.stringify({
        date: formatDateKey(getTorontoNow()),
        count: state.todayAppts
      }));
      localStorage.setItem(STORAGE_KEYS.COMPACT_MODE, JSON.stringify(state.isCompact));
      localStorage.setItem(STORAGE_KEYS.CALLBACKS, JSON.stringify(state.callbacks));
      localStorage.setItem(STORAGE_KEYS.CALLS, JSON.stringify(state.calls));
      localStorage.setItem(STORAGE_KEYS.SALES_REPS, JSON.stringify(state.salesReps));
      localStorage.setItem(STORAGE_KEYS.DELETED_IDS, JSON.stringify(state.deletedIds || {}));
      localStorage.setItem(STORAGE_KEYS.SNAPSHOTS, JSON.stringify(state.snapshots.slice(0, 24)));
      if (syncChannel) {
        syncChannel.postMessage({ type: 'SYNC_STATE', timestamp: Date.now() });
      }
      triggerDiskAutoSync();
    } catch (e) {
      console.error('Error saving state to localStorage', e);
    }
  }

  // Load State from LocalStorage and Reconcile with Toolbar Data
  function loadPersistedState() {
    try {
      const savedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (savedSettings) state.settings = { ...state.settings, ...JSON.parse(savedSettings) };

      const savedShifts = localStorage.getItem(STORAGE_KEYS.SHIFTS);
      if (savedShifts) state.shifts = JSON.parse(savedShifts);

      const savedSession = localStorage.getItem(STORAGE_KEYS.ACTIVE_SESSION);
      if (savedSession) state.activeSession = JSON.parse(savedSession);

      const savedAppts = localStorage.getItem(STORAGE_KEYS.TODAY_APPTS);
      if (savedAppts) {
        const parsed = JSON.parse(savedAppts);
        if (parsed.date === formatDateKey(getTorontoNow())) {
          state.todayAppts = parsed.count || 0;
        }
      }

      const savedCompact = localStorage.getItem(STORAGE_KEYS.COMPACT_MODE);
      if (savedCompact) state.isCompact = JSON.parse(savedCompact);

      const savedCallbacks = localStorage.getItem(STORAGE_KEYS.CALLBACKS);
      if (savedCallbacks) state.callbacks = JSON.parse(savedCallbacks);
      if (!Array.isArray(state.callbacks)) state.callbacks = [];

      const savedCalls = localStorage.getItem(STORAGE_KEYS.CALLS);
      if (savedCalls) state.calls = JSON.parse(savedCalls);
      if (!Array.isArray(state.calls)) state.calls = [];

      const savedReps = localStorage.getItem(STORAGE_KEYS.SALES_REPS);
      if (savedReps) {
        try { state.salesReps = JSON.parse(savedReps); } catch(e) {}
      }
      if (!Array.isArray(state.salesReps) || state.salesReps.length === 0) {
        state.salesReps = [...DEFAULT_SALES_REPS];
      }

      const savedDeletedIds = localStorage.getItem(STORAGE_KEYS.DELETED_IDS);
      if (savedDeletedIds) {
        try { state.deletedIds = JSON.parse(savedDeletedIds); } catch(e) {}
      }
      if (!state.deletedIds || typeof state.deletedIds !== 'object') state.deletedIds = {};

      const savedSnaps = localStorage.getItem(STORAGE_KEYS.SNAPSHOTS);
      if (savedSnaps) {
        try { state.snapshots = JSON.parse(savedSnaps); } catch(e) {}
      }
      if (!Array.isArray(state.snapshots)) state.snapshots = [];

      // Reconcile data from native floating toolbar (data/shifts_data.js) if present
      if (window.SABRINA_LOCAL_DATA) {
        if (window.SABRINA_LOCAL_DATA.version) state.version = window.SABRINA_LOCAL_DATA.version;
        if (window.SABRINA_LOCAL_DATA.build) state.build = window.SABRINA_LOCAL_DATA.build;

        // Merge toolbar deletedIds
        if (window.SABRINA_LOCAL_DATA.deletedIds && typeof window.SABRINA_LOCAL_DATA.deletedIds === 'object') {
          const fDel = window.SABRINA_LOCAL_DATA.deletedIds;
          Object.keys(fDel).forEach(k => {
            state.deletedIds[k] = Math.max(state.deletedIds[k] || 0, fDel[k] || 0);
          });
        }

        // 1. Reconcile Shifts
        let fileShifts = window.SABRINA_LOCAL_DATA.shifts;
        if (fileShifts) {
          if (!Array.isArray(fileShifts)) fileShifts = [fileShifts];
          const localShiftMap = new Map((state.shifts || []).filter(s => !isItemDeleted(s)).map(s => [s.id, s]));
          const mergedShifts = [];

          fileShifts.forEach(fs => {
            if (!fs || !fs.id || isItemDeleted(fs)) return;
            const local = localShiftMap.get(fs.id);
            if (!local) {
              mergedShifts.push(fs);
            } else {
              const fileUpdated = fs.updatedAt || fs.endTime || 0;
              const localUpdated = local.updatedAt || local.endTime || 0;
              if (fileUpdated >= localUpdated) {
                mergedShifts.push({ ...local, ...fs });
              } else {
                mergedShifts.push({ ...fs, ...local });
              }
              localShiftMap.delete(fs.id);
            }
          });

          localShiftMap.forEach(loc => {
            if (!isItemDeleted(loc)) mergedShifts.push(loc);
          });
          state.shifts = mergedShifts;
        }

        // 2. Reconcile Active Session & Today's Appts
        if (window.SABRINA_LOCAL_DATA.activeSession) {
          const tbSession = window.SABRINA_LOCAL_DATA.activeSession;
          const tbDate = tbSession.TodayDate || '';
          const todayKey = formatDateKey(getTorontoNow());
          if (tbDate === todayKey) {
            if (typeof tbSession.TodayAppts === 'number') {
              state.todayAppts = Math.max(state.todayAppts || 0, tbSession.TodayAppts);
            }
            const tbUpdated = tbSession.UpdatedAt || 0;
            const localUpdated = state.activeSession?.updatedAt || 0;
            if (tbUpdated > localUpdated) {
              state.activeSession = convertToolbarToDashboardSession(tbSession);
            }
          }
        }

        // 3. Reconcile Callbacks (Bidirectional status, notes, times & deletes)
        if (window.SABRINA_LOCAL_DATA.callbacks && Array.isArray(window.SABRINA_LOCAL_DATA.callbacks)) {
          const fileCbs = window.SABRINA_LOCAL_DATA.callbacks;
          const localCbMap = new Map((state.callbacks || []).filter(c => !isItemDeleted(c)).map(c => [c.id, c]));
          const mergedCbs = [];

          fileCbs.forEach(fc => {
            if (!fc || !fc.id || isItemDeleted(fc)) return;
            const local = localCbMap.get(fc.id);
            if (!local) {
              mergedCbs.push(fc);
            } else {
              const fileUpdated = fc.updatedAt || fc.completedAt || fc.createdAt || 0;
              const localUpdated = local.updatedAt || (local.completedAt ? (typeof local.completedAt === 'number' ? local.completedAt : new Date(local.completedAt).getTime()) : 0) || (local.createdAt ? (typeof local.createdAt === 'number' ? local.createdAt : new Date(local.createdAt).getTime()) : 0) || 0;
              if (fileUpdated >= localUpdated) {
                mergedCbs.push({ ...local, ...fc });
              } else {
                mergedCbs.push({ ...fc, ...local });
              }
              localCbMap.delete(fc.id);
            }
          });

          localCbMap.forEach(loc => {
            if (!isItemDeleted(loc)) mergedCbs.push(loc);
          });
          state.callbacks = mergedCbs;
        }

        // 4. Reconcile Call Logs
        if (window.SABRINA_LOCAL_DATA.calls && Array.isArray(window.SABRINA_LOCAL_DATA.calls)) {
          const fileCalls = window.SABRINA_LOCAL_DATA.calls;
          const localCallMap = new Map((state.calls || []).filter(c => !isItemDeleted(c)).map(c => [c.id, c]));
          const mergedCalls = [];

          fileCalls.forEach(fcall => {
            if (!fcall || !fcall.id || isItemDeleted(fcall)) return;
            const local = localCallMap.get(fcall.id);
            if (!local) {
              mergedCalls.push(fcall);
            } else {
              const fileUpdated = fcall.updatedAt || 0;
              const localUpdated = local.updatedAt || 0;
              if (fileUpdated >= localUpdated) {
                mergedCalls.push({ ...local, ...fcall });
              } else {
                mergedCalls.push({ ...fcall, ...local });
              }
              localCallMap.delete(fcall.id);
            }
          });

          localCallMap.forEach(loc => {
            if (!isItemDeleted(loc)) mergedCalls.push(loc);
          });
          state.calls = mergedCalls;
        }

        // 5. Reconcile Sales Reps
        if (window.SABRINA_LOCAL_DATA.salesReps && Array.isArray(window.SABRINA_LOCAL_DATA.salesReps) && window.SABRINA_LOCAL_DATA.salesReps.length > 0) {
          window.SABRINA_LOCAL_DATA.salesReps.forEach(r => {
            if (r && !state.salesReps.includes(r)) {
              state.salesReps.push(r);
            }
          });
        }

        // 6. Reconcile History / Snapshots
        if (window.SABRINA_LOCAL_DATA.history && Array.isArray(window.SABRINA_LOCAL_DATA.history)) {
          window.SABRINA_LOCAL_DATA.history.forEach(h => {
            if (!state.snapshots.some(s => s.timestamp === h.timestamp || (s.file && s.file === h.file))) {
              state.snapshots.push(h);
            }
          });
        }
      }

      // Final tombstone pruning
      state.shifts = (state.shifts || []).filter(s => !isItemDeleted(s));
      state.callbacks = (state.callbacks || []).filter(c => !isItemDeleted(c));
      state.calls = (state.calls || []).filter(c => !isItemDeleted(c));

      state.snapshots.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
      if (savedTheme) {
        state.theme = savedTheme;
      } else if (window.SABRINA_LOCAL_DATA && window.SABRINA_LOCAL_DATA.theme) {
        state.theme = window.SABRINA_LOCAL_DATA.theme;
      } else {
        state.theme = 'dark';
      }
      applyTheme(state.theme, false);

    } catch (e) {
      console.warn('Error loading localStorage, using defaults', e);
    }
  }

  // --- Direct File System Access API Bridge ---

  function convertDashboardToToolbarSession(activeSession, todayAppts, theme) {
    const todayKey = formatDateKey(getTorontoNow());
    if (!activeSession || activeSession.status === 'OFFLINE') {
      return {
        Status: 'OFFLINE',
        StartTime: 0,
        PauseStartTime: 0,
        TotalPausedMs: 0,
        LastActivitySwitchTime: 0,
        CurrentActivity: 'off_phone_work',
        ActivityMap: {
          inbound_call: 0,
          outbound_call: 0,
          text_sms: 0,
          email_in: 0,
          off_phone_work: 0
        },
        EventCounts: {
          inbound_call: 0,
          outbound_call: 0,
          text_sms: 0,
          email_in: 0,
          off_phone_work: 0
        },
        Events: [],
        TodayAppts: todayAppts || 0,
        TodayDate: todayKey,
        Theme: theme || 'dark',
        UpdatedAt: Date.now()
      };
    }

    const actMap = activeSession.activityTimeMap || {};
    return {
      Status: activeSession.status || 'RUNNING',
      StartTime: activeSession.startTime || Date.now(),
      PauseStartTime: activeSession.pauseStartTime || 0,
      TotalPausedMs: activeSession.totalPausedMs || 0,
      LastActivitySwitchTime: activeSession.lastActivitySwitchTime || activeSession.startTime || Date.now(),
      CurrentActivity: activeSession.currentActivity || 'off_phone_work',
      ActivityMap: {
        inbound_call: actMap.inbound_call || 0,
        outbound_call: actMap.outbound_call || 0,
        text_sms: actMap.text_sms || 0,
        email_in: (actMap.email_in || 0) + (actMap.email_out || 0),
        off_phone_work: actMap.off_phone_work || 0
      },
      EventCounts: {
        inbound_call: 0,
        outbound_call: 0,
        text_sms: 0,
        email_in: 0,
        off_phone_work: 0
      },
      Events: [],
      TodayAppts: todayAppts || 0,
      TodayDate: todayKey,
      Theme: theme || 'dark',
      UpdatedAt: activeSession.updatedAt || Date.now()
    };
  }

  function convertToolbarToDashboardSession(tbSession) {
    if (!tbSession || tbSession.Status === 'OFFLINE' || !tbSession.StartTime) {
      return null;
    }
    const tbMap = tbSession.ActivityMap || {};
    return {
      startTime: tbSession.StartTime,
      status: tbSession.Status || 'RUNNING',
      pauseStartTime: tbSession.PauseStartTime || null,
      totalPausedMs: tbSession.TotalPausedMs || 0,
      lastActivitySwitchTime: tbSession.LastActivitySwitchTime || tbSession.StartTime,
      currentActivity: tbSession.CurrentActivity || 'off_phone_work',
      activityTimeMap: {
        inbound_call: tbMap.inbound_call || 0,
        outbound_call: tbMap.outbound_call || 0,
        text_sms: tbMap.text_sms || 0,
        email_in: tbMap.email_in || 0,
        email_out: 0,
        off_phone_work: tbMap.off_phone_work || 0
      },
      updatedAt: tbSession.UpdatedAt || Date.now()
    };
  }

  async function readDiskJsonFile(fileName) {
    if (!diskDirectoryHandle) return null;
    try {
      const fileHandle = await diskDirectoryHandle.getFileHandle(fileName, { create: false });
      const file = await fileHandle.getFile();
      const text = await file.text();
      if (text && text.trim().length > 0) {
        return JSON.parse(text);
      }
    } catch (e) {
      // File may not exist yet or not valid JSON
    }
    return null;
  }

  async function acquireDiskLock(maxWaitMs = 1500) {
    if (!diskDirectoryHandle) return true;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      try {
        const lockHandle = await diskDirectoryHandle.getFileHandle('.sync.lock', { create: false });
        const file = await lockHandle.getFile();
        const text = await file.text();
        if (text) {
          const lockData = JSON.parse(text);
          const age = Date.now() - (lockData.timestamp || 0);
          if (age > 5000) {
            await diskDirectoryHandle.removeEntry('.sync.lock').catch(() => {});
          } else {
            await new Promise(r => setTimeout(r, 50));
            continue;
          }
        }
      } catch (e) {
        // Lock file does not exist
      }

      try {
        const lockHandle = await diskDirectoryHandle.getFileHandle('.sync.lock', { create: true });
        const writable = await lockHandle.createWritable();
        await writable.write(JSON.stringify({ lockedBy: 'dashboard', timestamp: Date.now() }));
        await writable.close();
        return true;
      } catch (e) {
        await new Promise(r => setTimeout(r, 50));
      }
    }
    return false;
  }

  async function releaseDiskLock() {
    if (!diskDirectoryHandle) return;
    try {
      await diskDirectoryHandle.removeEntry('.sync.lock');
    } catch (e) {}
  }

  async function connectDiskDirectory() {
    if (!window.showDirectoryPicker) {
      showToast('File System Access API is not supported in this browser. Use Export / Import below.', 'warn');
      return false;
    }
    try {
      diskDirectoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await writeStateToDiskDirectory();
      updateDiskSyncUI('Connected & Synced', '#22c55e');
      showToast('📁 Local data folder connected! Live disk sync is active.', 'success');
      return true;
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error connecting disk directory:', err);
        updateDiskSyncUI('Sync Error', '#ef4444');
        showToast('Could not access folder: ' + err.message, 'error');
      }
      return false;
    }
  }

  async function writeStateToDiskDirectory() {
    if (!diskDirectoryHandle) return;
    const locked = await acquireDiskLock();
    try {
      updateDiskSyncUI('Reconciling & Writing...', '#f59e0b');

      // 1. Read and merge disk tombstones first
      const diskDeleted = await readDiskJsonFile('deleted_ids.json');
      if (diskDeleted && typeof diskDeleted === 'object') {
        if (!state.deletedIds || typeof state.deletedIds !== 'object') state.deletedIds = {};
        Object.keys(diskDeleted).forEach(k => {
          state.deletedIds[k] = Math.max(state.deletedIds[k] || 0, diskDeleted[k] || 0);
        });
      }

      // 2. Read and reconcile disk Shifts
      const diskShifts = await readDiskJsonFile('shifts.json');
      if (Array.isArray(diskShifts)) {
        const localShiftMap = new Map((state.shifts || []).filter(s => !isItemDeleted(s)).map(s => [s.id, s]));
        const mergedShifts = [];

        diskShifts.forEach(ds => {
          if (!ds || !ds.id || isItemDeleted(ds)) return;
          const local = localShiftMap.get(ds.id);
          if (!local) {
            mergedShifts.push(ds);
          } else {
            const diskUpdated = ds.updatedAt || ds.endTime || ds.startTime || 0;
            const localUpdated = local.updatedAt || local.endTime || local.startTime || 0;
            if (diskUpdated >= localUpdated) {
              mergedShifts.push({ ...local, ...ds });
            } else {
              mergedShifts.push({ ...ds, ...local });
            }
            localShiftMap.delete(ds.id);
          }
        });

        localShiftMap.forEach(loc => {
          if (!isItemDeleted(loc)) mergedShifts.push(loc);
        });
        state.shifts = mergedShifts.filter(s => !isItemDeleted(s));
      } else {
        state.shifts = (state.shifts || []).filter(s => !isItemDeleted(s));
      }

      // 3. Read and reconcile disk Callbacks
      const diskCbs = await readDiskJsonFile('callbacks.json');
      if (Array.isArray(diskCbs)) {
        const localCbMap = new Map((state.callbacks || []).filter(c => !isItemDeleted(c)).map(c => [c.id, c]));
        const mergedCbs = [];

        diskCbs.forEach(dc => {
          if (!dc || !dc.id || isItemDeleted(dc)) return;
          const local = localCbMap.get(dc.id);
          if (!local) {
            mergedCbs.push(dc);
          } else {
            const diskUpdated = dc.updatedAt || (typeof dc.completedAt === 'number' ? dc.completedAt : (dc.completedAt ? new Date(dc.completedAt).getTime() : 0)) || (typeof dc.createdAt === 'number' ? dc.createdAt : (dc.createdAt ? new Date(dc.createdAt).getTime() : 0)) || 0;
            const localUpdated = local.updatedAt || (typeof local.completedAt === 'number' ? local.completedAt : (local.completedAt ? new Date(local.completedAt).getTime() : 0)) || (typeof local.createdAt === 'number' ? local.createdAt : (local.createdAt ? new Date(local.createdAt).getTime() : 0)) || 0;
            if (diskUpdated >= localUpdated) {
              mergedCbs.push({ ...local, ...dc });
            } else {
              mergedCbs.push({ ...dc, ...local });
            }
            localCbMap.delete(dc.id);
          }
        });

        localCbMap.forEach(loc => {
          if (!isItemDeleted(loc)) mergedCbs.push(loc);
        });
        state.callbacks = mergedCbs.filter(c => !isItemDeleted(c));
      } else {
        state.callbacks = (state.callbacks || []).filter(c => !isItemDeleted(c));
      }

      // 4. Read and reconcile disk Calls
      const diskCalls = await readDiskJsonFile('calls.json');
      if (Array.isArray(diskCalls)) {
        const localCallMap = new Map((state.calls || []).filter(c => !isItemDeleted(c)).map(c => [c.id, c]));
        const mergedCalls = [];

        diskCalls.forEach(dcall => {
          if (!dcall || !dcall.id || isItemDeleted(dcall)) return;
          const local = localCallMap.get(dcall.id);
          if (!local) {
            mergedCalls.push(dcall);
          } else {
            const diskUpdated = dcall.updatedAt || (typeof dcall.createdAt === 'number' ? dcall.createdAt : 0) || 0;
            const localUpdated = local.updatedAt || (typeof local.createdAt === 'number' ? local.createdAt : 0) || 0;
            if (diskUpdated >= localUpdated) {
              mergedCalls.push({ ...local, ...dcall });
            } else {
              mergedCalls.push({ ...dcall, ...local });
            }
            localCallMap.delete(dcall.id);
          }
        });

        localCallMap.forEach(loc => {
          if (!isItemDeleted(loc)) mergedCalls.push(loc);
        });
        state.calls = mergedCalls.filter(c => !isItemDeleted(c));
      } else {
        state.calls = (state.calls || []).filter(c => !isItemDeleted(c));
      }

      // 5. Read and reconcile disk Sales Reps
      const diskReps = await readDiskJsonFile('sales_reps.json');
      if (Array.isArray(diskReps) && diskReps.length > 0) {
        diskReps.forEach(r => {
          if (r && !state.salesReps.includes(r)) {
            state.salesReps.push(r);
          }
        });
      }

      // 6. Read and reconcile disk Active Session
      const diskSession = await readDiskJsonFile('active_session.json');
      const todayKey = formatDateKey(getTorontoNow());
      if (diskSession && diskSession.TodayDate === todayKey) {
        if (typeof diskSession.TodayAppts === 'number') {
          state.todayAppts = Math.max(state.todayAppts || 0, diskSession.TodayAppts);
        }
        const diskUpdated = diskSession.UpdatedAt || 0;
        const localUpdated = state.activeSession?.updatedAt || 0;
        if (diskUpdated > localUpdated) {
          state.activeSession = convertToolbarToDashboardSession(diskSession);
        }
      }

      // 7. Write reconciled data back to disk files
      const writeFile = async (fileName, dataObj, isJs = false) => {
        const fileHandle = await diskDirectoryHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        const content = isJs ? dataObj : JSON.stringify(dataObj, null, 2);
        await writable.write(content);
        await writable.close();
      };

      await writeFile('shifts.json', state.shifts || []);
      await writeFile('callbacks.json', state.callbacks || []);
      await writeFile('calls.json', state.calls || []);
      await writeFile('sales_reps.json', state.salesReps || DEFAULT_SALES_REPS);
      await writeFile('deleted_ids.json', state.deletedIds || {});

      const tbSessionToSave = convertDashboardToToolbarSession(state.activeSession, state.todayAppts, state.theme);
      await writeFile('active_session.json', tbSessionToSave);

      const jsContent = `window.SABRINA_LOCAL_DATA = { version: "${state.version}", build: "${state.build}", shifts: ${JSON.stringify(state.shifts || [])}, activeSession: ${JSON.stringify(tbSessionToSave)}, callbacks: ${JSON.stringify(state.callbacks || [])}, calls: ${JSON.stringify(state.calls || [])}, salesReps: ${JSON.stringify(state.salesReps || DEFAULT_SALES_REPS)}, deletedIds: ${JSON.stringify(state.deletedIds || {})}, history: ${JSON.stringify(state.snapshots.slice(0, 12))}, theme: "${state.theme || 'dark'}" };`;
      await writeFile('shifts_data.js', jsContent, true);

      // Keep localStorage in sync with reconciled data
      try {
        localStorage.setItem(STORAGE_KEYS.SHIFTS, JSON.stringify(state.shifts));
        localStorage.setItem(STORAGE_KEYS.ACTIVE_SESSION, JSON.stringify(state.activeSession));
        localStorage.setItem(STORAGE_KEYS.CALLBACKS, JSON.stringify(state.callbacks));
        localStorage.setItem(STORAGE_KEYS.CALLS, JSON.stringify(state.calls));
        localStorage.setItem(STORAGE_KEYS.SALES_REPS, JSON.stringify(state.salesReps));
        localStorage.setItem(STORAGE_KEYS.DELETED_IDS, JSON.stringify(state.deletedIds || {}));
      } catch (e) {}

      updateDiskSyncUI('Connected & Synced', '#22c55e');
      updateUI();
    } catch (e) {
      console.warn('Disk auto-sync write error:', e);
      updateDiskSyncUI('Sync Warning', '#f59e0b');
    } finally {
      if (locked) {
        await releaseDiskLock();
      }
    }
  }

  function triggerDiskAutoSync() {
    if (!diskDirectoryHandle) return;
    if (diskSyncDebounce) clearTimeout(diskSyncDebounce);
    diskSyncDebounce = setTimeout(() => {
      writeStateToDiskDirectory();
    }, 1000);
  }

  function updateDiskSyncUI(text, color) {
    const badge = document.getElementById('disk-sync-badge');
    if (badge) {
      badge.textContent = text || (diskDirectoryHandle ? 'Connected & Synced' : 'Not Connected');
      badge.style.background = color ? `${color}22` : (diskDirectoryHandle ? 'rgba(34, 197, 94, 0.2)' : 'rgba(148, 163, 184, 0.2)');
      badge.style.color = color || (diskDirectoryHandle ? '#22c55e' : 'var(--text-muted)');
    }
  }

  // --- Session Tracking Logic ---

  function startSession() {
    const now = Date.now();
    if (!state.activeSession) {
      state.activeSession = {
        startTime: now,
        status: 'RUNNING',
        pauseStartTime: null,
        totalPausedMs: 0,
        currentActivity: 'off_phone_work',
        lastActivitySwitchTime: now,
        activityTimeMap: {
          inbound_call: 0,
          outbound_call: 0,
          text_sms: 0,
          email_in: 0,
          email_out: 0,
          off_phone_work: 0
        },
        updatedAt: now
      };
    } else if (state.activeSession.status === 'PAUSED') {
      // Resume from paused
      const pauseDuration = now - state.activeSession.pauseStartTime;
      state.activeSession.totalPausedMs = (state.activeSession.totalPausedMs || 0) + pauseDuration;
      state.activeSession.pauseStartTime = null;
      state.activeSession.status = 'RUNNING';
      state.activeSession.lastActivitySwitchTime = now;
      state.activeSession.updatedAt = now;
    }
    persistState();
    updateUI();
  }

  function pauseSession() {
    if (!state.activeSession || state.activeSession.status !== 'RUNNING') return;
    const now = Date.now();
    
    // Accumulate time on active activity
    accumulateActiveActivityTime(now);

    state.activeSession.status = 'PAUSED';
    state.activeSession.pauseStartTime = now;
    state.activeSession.updatedAt = now;
    persistState();
    updateUI();
  }

  function stopSession() {
    if (!state.activeSession) return;
    const now = Date.now();

    if (state.activeSession.status === 'RUNNING') {
      accumulateActiveActivityTime(now);
    } else if (state.activeSession.status === 'PAUSED' && state.activeSession.pauseStartTime) {
      const pauseDuration = now - state.activeSession.pauseStartTime;
      state.activeSession.totalPausedMs = (state.activeSession.totalPausedMs || 0) + pauseDuration;
    }

    const grossElapsedMs = now - state.activeSession.startTime;
    const netWorkedSeconds = Math.max(0, Math.floor((grossElapsedMs - (state.activeSession.totalPausedMs || 0)) / 1000));

    if (netWorkedSeconds >= 10) { // Keep sessions > 10 seconds
      // Calculate phone time vs off phone
      let phoneSeconds = 0;
      let offPhoneSeconds = 0;
      const actMap = state.activeSession.activityTimeMap || {};

      for (const [actKey, actSecs] of Object.entries(actMap)) {
        if (ACTIVITY_NAMES[actKey]?.isPhone) {
          phoneSeconds += actSecs;
        } else {
          offPhoneSeconds += actSecs;
        }
      }

      // If untracked, treat remaining as offPhone
      const trackedSum = phoneSeconds + offPhoneSeconds;
      if (trackedSum < netWorkedSeconds) {
        offPhoneSeconds += (netWorkedSeconds - trackedSum);
      }

      const newShift = {
        id: 'shift_' + Date.now(),
        date: formatDateKey(state.activeSession.startTime),
        startTime: state.activeSession.startTime,
        endTime: now,
        durationSeconds: netWorkedSeconds,
        phoneSeconds: phoneSeconds,
        offPhoneSeconds: offPhoneSeconds,
        appointmentsBooked: state.todayAppts,
        notes: 'Tracked shift segment',
        activityMap: { ...actMap }
      };

      state.shifts.unshift(newShift);
    }

    state.activeSession = null;
    persistState();
    updateUI();
  }

  function switchActivity(newActivityKey) {
    if (!state.activeSession) {
      // Just remember selection for when start is pressed
      document.querySelectorAll('.act-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.act === newActivityKey);
      });
      return;
    }

    const now = Date.now();
    if (state.activeSession.status === 'RUNNING') {
      accumulateActiveActivityTime(now);
    }

    state.activeSession.currentActivity = newActivityKey;
    state.activeSession.lastActivitySwitchTime = now;
    state.activeSession.updatedAt = now;
    persistState();
    updateUI();
  }

  function accumulateActiveActivityTime(now) {
    if (!state.activeSession) return;
    const currentAct = state.activeSession.currentActivity || 'off_phone_work';
    const lastSwitch = state.activeSession.lastActivitySwitchTime || state.activeSession.startTime;
    const elapsedSeconds = Math.max(0, Math.floor((now - lastSwitch) / 1000));

    if (!state.activeSession.activityTimeMap) {
      state.activeSession.activityTimeMap = {};
    }
    state.activeSession.activityTimeMap[currentAct] = (state.activeSession.activityTimeMap[currentAct] || 0) + elapsedSeconds;
    state.activeSession.lastActivitySwitchTime = now;
  }

  // Calculate session elapsed seconds
  function getActiveSessionSeconds() {
    if (!state.activeSession) return 0;
    const now = Date.now();
    let grossMs = 0;
    if (state.activeSession.status === 'RUNNING') {
      grossMs = (now - state.activeSession.startTime) - (state.activeSession.totalPausedMs || 0);
    } else if (state.activeSession.status === 'PAUSED') {
      const pausedAt = state.activeSession.pauseStartTime || now;
      grossMs = (pausedAt - state.activeSession.startTime) - (state.activeSession.totalPausedMs || 0);
    }
    return Math.max(0, Math.floor(grossMs / 1000));
  }

  // Calculate total seconds worked today (closed shifts + active session)
  function getTodayWorkedSeconds() {
    const todayKey = formatDateKey(getTorontoNow());
    let totalSecs = 0;

    // From completed shifts today
    state.shifts.forEach(shift => {
      if (shift.date === todayKey) {
        totalSecs += shift.durationSeconds || 0;
      }
    });

    // Plus current active session
    if (state.activeSession) {
      totalSecs += getActiveSessionSeconds();
    }

    return totalSecs;
  }

  // Calculate active session breakdown: maps activityTimeMap + unrecorded live interval since lastActivitySwitchTime
  function getActiveSessionBreakdown() {
    if (!state.activeSession) {
      return { phoneSecs: 0, offPhoneSecs: 0, totalSecs: 0, breakdown: {} };
    }

    const breakdown = {};
    const map = state.activeSession.activityTimeMap || {};
    for (const [k, v] of Object.entries(map)) {
      breakdown[k] = (breakdown[k] || 0) + (typeof v === 'number' ? v : 0);
    }

    const currentAct = state.activeSession.currentActivity || 'off_phone_work';
    let unrecorded = 0;
    const lastSwitch = state.activeSession.lastActivitySwitchTime || state.activeSession.startTime;

    if (state.activeSession.status === 'RUNNING') {
      unrecorded = Math.max(0, Math.floor((Date.now() - lastSwitch) / 1000));
    } else if (state.activeSession.status === 'PAUSED') {
      const pausedAt = state.activeSession.pauseStartTime || Date.now();
      unrecorded = Math.max(0, Math.floor((pausedAt - lastSwitch) / 1000));
    }

    breakdown[currentAct] = (breakdown[currentAct] || 0) + unrecorded;

    let phoneSecs = 0;
    let offPhoneSecs = 0;
    let totalSecs = 0;

    for (const [k, v] of Object.entries(breakdown)) {
      totalSecs += v;
      if (ACTIVITY_NAMES[k]?.isPhone) {
        phoneSecs += v;
      } else {
        offPhoneSecs += v;
      }
    }

    const grossSecs = getActiveSessionSeconds();
    if (totalSecs < grossSecs) {
      offPhoneSecs += (grossSecs - totalSecs);
      totalSecs = grossSecs;
    }

    return { phoneSecs, offPhoneSecs, totalSecs, breakdown };
  }

  // Calculate today's phone vs off-phone seconds
  function getTodayBreakdown() {
    const todayKey = formatDateKey(getTorontoNow());
    let phoneSecs = 0;
    let offPhoneSecs = 0;

    (state.shifts || []).forEach(shift => {
      if (shift.date === todayKey) {
        phoneSecs += shift.phoneSeconds || 0;
        offPhoneSecs += shift.offPhoneSeconds || 0;
      }
    });

    if (state.activeSession) {
      const activeBreakdown = getActiveSessionBreakdown();
      phoneSecs += activeBreakdown.phoneSecs;
      offPhoneSecs += activeBreakdown.offPhoneSecs;
    }

    return { phoneSecs, offPhoneSecs };
  }

  // --- UI Update & Rendering ---

  function updateClock() {
    const now = getTorontoNow();
    const clockEl = document.getElementById('toronto-live-clock');
    const dateEl = document.getElementById('toronto-live-date');
    if (clockEl) {
      clockEl.textContent = now.toLocaleTimeString('en-US', {
        timeZone: 'America/Toronto',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    }
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString('en-US', {
        timeZone: 'America/Toronto',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    }
  }

  // --- Theme Switcher Logic ---
  function applyTheme(themeName, persist = true) {
    if (!['dark', 'light', 'highvis'].includes(themeName)) {
      themeName = 'dark';
    }
    state.theme = themeName;
    document.documentElement.setAttribute('data-theme', themeName);
    document.body.setAttribute('data-theme', themeName);
    document.body.dataset.theme = themeName;

    const labelEl = document.getElementById('web-theme-label');
    if (labelEl) {
      if (themeName === 'light') {
        labelEl.textContent = 'Theme: Light';
      } else if (themeName === 'highvis') {
        labelEl.textContent = 'Theme: High-Vis';
      } else {
        labelEl.textContent = 'Theme: Dark';
      }
    }

    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEYS.THEME, themeName);
      } catch (e) {}
      if (syncChannel) {
        syncChannel.postMessage({ type: 'THEME_CHANGE', theme: themeName });
      }
    }
  }

  function updateUI() {
    // 1. Update Transport State
    const statusPill = document.getElementById('status-pill');
    const statusText = document.getElementById('status-text');
    const activeBanner = document.getElementById('active-shift-banner');
    const btnStart = document.getElementById('btn-start-rec');
    const btnPause = document.getElementById('btn-pause');
    const btnStop = document.getElementById('btn-stop');
    const activityDisplay = document.getElementById('current-activity-display');

    if (!state.activeSession) {
      statusPill.className = 'status-pill';
      statusText.textContent = 'CLOCKED OUT';
      activeBanner.textContent = 'Ready to start shift';
      btnStart.disabled = false;
      btnStart.innerHTML = '<span>●</span><span>START / REC</span>';
      btnPause.disabled = true;
      btnPause.innerHTML = '<span>⏸</span><span>PAUSE</span>';
      btnStop.disabled = true;
      activityDisplay.textContent = '📋 Offline';
    } else if (state.activeSession.status === 'RUNNING') {
      statusPill.className = 'status-pill status-working';
      statusText.textContent = '● WORKING (REC)';
      activeBanner.textContent = 'Shift in progress (Started ' + format12HourTime(state.activeSession.startTime) + ')';
      btnStart.disabled = true;
      btnPause.disabled = false;
      btnPause.innerHTML = '<span>⏸</span><span>PAUSE</span>';
      btnStop.disabled = false;

      const actInfo = ACTIVITY_NAMES[state.activeSession.currentActivity] || { name: 'Active', icon: '⚡' };
      activityDisplay.textContent = `${actInfo.icon} ${actInfo.name}`;
    } else if (state.activeSession.status === 'PAUSED') {
      statusPill.className = 'status-pill status-paused';
      statusText.textContent = '⏸ PAUSED';
      activeBanner.textContent = 'Shift paused for break / split shift';
      btnStart.disabled = false;
      btnStart.innerHTML = '<span>▶</span><span>RESUME</span>';
      btnPause.disabled = true;
      btnStop.disabled = false;
      activityDisplay.textContent = '⏸ On Break';
    }

    // 2. Update Activity Buttons Active State
    const currentAct = state.activeSession?.currentActivity || 'off_phone_work';
    document.querySelectorAll('.act-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.act === currentAct);
    });

    // 3. Update Readouts
    const sessionSeconds = getActiveSessionSeconds();
    const todaySeconds = getTodayWorkedSeconds();
    document.getElementById('session-readout').textContent = formatStopwatch(sessionSeconds);
    document.getElementById('today-readout').textContent = formatHoursMinutes(todaySeconds);

    // 4. Update Quick Stats
    document.getElementById('stat-shift-hours').textContent = formatHoursMinutes(todaySeconds);
    const breakdown = getTodayBreakdown();
    const phoneMinutes = Math.round(breakdown.phoneSecs / 60);
    const offPhoneMinutes = Math.round(breakdown.offPhoneSecs / 60);
    document.getElementById('stat-phone-time').textContent = `📞 ${phoneMinutes}m`;
    document.getElementById('stat-offphone-time').textContent = `📋 ${offPhoneMinutes}m`;
    
    const totalMins = phoneMinutes + offPhoneMinutes;
    const ratio = totalMins > 0 ? Math.round((phoneMinutes / totalMins) * 100) : 0;
    document.getElementById('stat-phone-ratio').textContent = `${ratio}% phone time today`;
    document.getElementById('stat-appts-count').textContent = state.todayAppts;

    // 5. Update Today's Header Date
    const todayHeader = document.getElementById('today-date-header');
    if (todayHeader) todayHeader.textContent = formatFriendlyDate(getTorontoNow());

    // 6. Update Today's Shifts List
    renderTodayShifts();

    // 7. Update Timesheet Table
    renderTimesheet();

    // 8. Update Invoice
    renderInvoice();

    // 9. Update Callbacks List
    renderCallbacks();

    // 10. Update Daily Call Summary Report
    renderDailySummary();

    // 11. Update Sales Reps Settings & Dropdown
    populateSalesRepsDropdown();
    renderSalesRepsSettings();

    // 12. Compact mode check
    document.body.classList.toggle('compact-mode', state.isCompact);
    const compactLabel = document.getElementById('compact-toggle-label');
    if (compactLabel) {
      compactLabel.textContent = state.isCompact ? 'Expand Full View' : 'Compact Toolbar Mode';
    }

    // 13. Update Snapshots History & Undo Button State
    renderSnapshotsHistory();
    updateUndoButtonState();

    // 14. Update Version Display Badges
    updateVersionLabels();
  }

  function renderTodayShifts() {
    const listEl = document.getElementById('today-shifts-list');
    const emptyEl = document.getElementById('today-shifts-empty');
    if (!listEl) return;

    const todayKey = formatDateKey(getTorontoNow());
    const todayShifts = state.shifts.filter(s => s.date === todayKey);

    if (todayShifts.length === 0 && !state.activeSession) {
      emptyEl.style.display = 'block';
      listEl.innerHTML = '';
      return;
    }

    emptyEl.style.display = 'none';
    let html = '';

    // If session is currently running or paused, show top active segment card
    if (state.activeSession) {
      const activeSeconds = getActiveSessionSeconds();
      html += `
        <div class="shift-card-item active-shift">
          <div>
            <div class="shift-time-range">
              🟢 Active Shift Segment: ${format12HourTime(state.activeSession.startTime)} – Now
            </div>
            <div style="font-size: 0.8rem; color: #166534; margin-top: 0.2rem;">
              Status: ${state.activeSession.status} • Current Task: ${ACTIVITY_NAMES[state.activeSession.currentActivity]?.name || 'Working'}
            </div>
          </div>
          <div class="shift-duration-badge" style="background: #bbf7d0; color: #166534;">
            ${formatHoursMinutes(activeSeconds)}
          </div>
        </div>
      `;
    }

    todayShifts.forEach((shift, index) => {
      const shiftNum = todayShifts.length - index;
      const phoneM = Math.round((shift.phoneSeconds || 0) / 60);
      const offPhoneM = Math.round((shift.offPhoneSeconds || 0) / 60);

      html += `
        <div class="shift-card-item">
          <div>
            <div class="shift-time-range">
              Shift Segment #${shiftNum}: ${format12HourTime(shift.startTime)} – ${format12HourTime(shift.endTime)}
            </div>
            <div style="font-size: 0.8rem; color: #64748b; margin-top: 0.2rem;">
              📞 Phone: ${phoneM}m | 📋 Off-phone: ${offPhoneM}m | ${shift.notes || 'Routine duties'}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <span class="shift-duration-badge">${formatHoursMinutes(shift.durationSeconds)}</span>
            <button class="btn-danger-outline" onclick="window.SabrinaApp.deleteShift('${shift.id}', this)" title="Delete entry">🗑️</button>
          </div>
        </div>
      `;
    });

    listEl.innerHTML = html;
  }

  function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  function renderDailySummary() {
    const reportDateInput = document.getElementById('daily-summary-date');
    if (!reportDateInput) return;

    if (!reportDateInput.value) {
      reportDateInput.value = formatDateKey(getTorontoNow());
    }
    const selDateKey = reportDateInput.value;

    const dateDisplay = document.getElementById('report-display-date');
    if (dateDisplay) {
      dateDisplay.textContent = `Date: ${formatFriendlyDate(selDateKey)}`;
    }

    // Gathers shifts for selDateKey
    const dayShifts = (state.shifts || []).filter(s => s.date === selDateKey);
    let totalSec = dayShifts.reduce((sum, s) => sum + (s.durationSeconds || 0), 0);
    let phoneSec = dayShifts.reduce((sum, s) => sum + (s.phoneSeconds || 0), 0);
    let offPhoneSec = dayShifts.reduce((sum, s) => sum + (s.offPhoneSeconds || 0), 0);

    // If selDateKey is today and active session is running/paused, add live time from breakdown
    if (selDateKey === formatDateKey(getTorontoNow()) && state.activeSession) {
      const activeBreakdown = getActiveSessionBreakdown();
      totalSec += activeBreakdown.totalSecs;
      phoneSec += activeBreakdown.phoneSecs;
      offPhoneSec += activeBreakdown.offPhoneSecs;
    }

    const totalHoursEl = document.getElementById('report-total-hours');
    if (totalHoursEl) totalHoursEl.textContent = formatHoursMinutes(totalSec);

    const splitEl = document.getElementById('report-phone-split');
    if (splitEl) {
      splitEl.textContent = `${Math.round(phoneSec / 60)}m phone / ${Math.round(offPhoneSec / 60)}m admin`;
    }

    // Filter calls for selDateKey
    const dayCalls = (state.calls || []).filter(c => c.date === selDateKey);
    const dayCallbacks = (state.callbacks || []).filter(c => c.callbackDate === selDateKey);
    const dayAppts = dayCalls.filter(c => c.type === 'Appointment Booked').length || (selDateKey === formatDateKey(getTorontoNow()) ? state.todayAppts : 0);

    // Update KPI counters
    const kpiAppts = document.getElementById('report-kpi-appts');
    const kpiCalls = document.getElementById('report-kpi-calls');
    const kpiCallbacks = document.getElementById('report-kpi-callbacks');

    if (kpiAppts) kpiAppts.textContent = dayAppts;
    if (kpiCalls) kpiCalls.textContent = dayCalls.length;
    if (kpiCallbacks) kpiCallbacks.textContent = dayCallbacks.length;

    // Render table rows
    const tbody = document.getElementById('report-calls-tbody');
    if (!tbody) return;

    if (dayCalls.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; color: #94a3b8; padding: 1.5rem;">
            No specific calls logged for this date yet. Click <strong>+ Add Call / Lead</strong> above or click <strong>[+]</strong> on the toolbar when booking appointments.
          </td>
        </tr>
      `;
      return;
    }

    let rowsHtml = '';
    dayCalls.forEach((call) => {
      const isAppt = call.type === 'Appointment Booked';
      const outcomeBadge = isAppt 
        ? `<span style="background: #dcfce7; color: #15803d; font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 0.8rem;">✓ APPT BOOKED</span>`
        : `<span style="background: #e0f2fe; color: #0369a1; font-weight: 600; padding: 2px 6px; border-radius: 4px; font-size: 0.8rem;">${escapeHTML(call.type || 'Call')}</span>`;

      rowsHtml += `
        <tr>
          <td contenteditable="true">${escapeHTML(call.time || '')}</td>
          <td contenteditable="true" style="font-weight: 700; color: #0f172a;">${escapeHTML(call.contactName || '')}</td>
          <td contenteditable="true" style="color: #0284c7; font-weight: 600;">${escapeHTML(call.phone || '')}</td>
          <td contenteditable="true">${outcomeBadge} ${escapeHTML(call.outcome || '')}</td>
          <td contenteditable="true">${call.hasCallback ? '⏰ Follow-up scheduled' : 'Completed'}</td>
          <td class="no-print" style="text-align: center;">
            <button class="btn-danger-outline" style="padding: 2px 6px; font-size: 0.75rem;" onclick="window.SabrinaApp.deleteCall('${call.id}', this)" title="Delete record">🗑️</button>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = rowsHtml;
  }

  function copyDailySummaryText() {
    const reportDate = document.getElementById('daily-summary-date')?.value || formatDateKey(getTorontoNow());
    const dayCalls = (state.calls || []).filter(c => c.date === reportDate);
    const dayAppts = dayCalls.filter(c => c.type === 'Appointment Booked').length || state.todayAppts;
    const hours = document.getElementById('report-total-hours')?.textContent || '0h 00m';
    const notes = document.getElementById('report-editable-notes')?.innerText || '';

    let text = `${(state.settings.clientName || 'CLIENT COMPANY').toUpperCase()} - DAILY CALL REPORT\n`;
    text += `Date: ${reportDate}\nRepresentative: ${state.settings.contractorName || 'Contractor'}\nShift Hours: ${hours}\nAppointments Booked: ${dayAppts}\nTotal Calls Logged: ${dayCalls.length}\n\n`;
    text += `LOGGED CALLS & LEADS:\n`;
    if (dayCalls.length === 0) {
      text += `(No itemized calls logged)\n`;
    } else {
      dayCalls.forEach((c, idx) => {
        text += `${idx + 1}. ${c.time} - ${c.contactName} (${c.phone}): ${c.type} - ${c.outcome || 'N/A'}\n`;
      });
    }
    text += `\nNOTES & HANDOVER:\n${notes}\n`;

    copyToClipboard(text, '📋 Daily summary copied to clipboard! Ready to paste into SMS or email.');
  }

  function renderCallbacks() {
    const container = document.getElementById('callbacks-cards-container');
    const emptyState = document.getElementById('callbacks-empty-state');
    if (!container) return;

    const nowEpoch = Date.now();
    const todayStr = formatDateKey(getTorontoNow());

    let list = Array.isArray(state.callbacks) ? [...state.callbacks] : [];
    
    if (state.cbFilter === 'due') {
      list = list.filter(c => c.status === 'PENDING' && ((c.dueEpoch && c.dueEpoch <= nowEpoch) || (c.callbackDate && c.callbackDate < todayStr)));
    } else if (state.cbFilter === 'pending') {
      list = list.filter(c => c.status === 'PENDING' && !((c.dueEpoch && c.dueEpoch <= nowEpoch) || (c.callbackDate && c.callbackDate < todayStr)));
    } else if (state.cbFilter === 'completed') {
      list = list.filter(c => c.status === 'COMPLETED');
    }

    if (list.length === 0) {
      container.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    let html = '';
    list.forEach(c => {
      const isDue = c.status === 'PENDING' && ((c.dueEpoch && c.dueEpoch <= nowEpoch) || (c.callbackDate && c.callbackDate < todayStr));
      const cardClass = isDue ? 'callback-card due' : (c.status === 'COMPLETED' ? 'callback-card completed' : 'callback-card');
      const badgeClass = isDue ? 'callback-badge due' : (c.status === 'COMPLETED' ? 'callback-badge completed' : 'callback-badge pending');
      const badgeText = isDue ? '● DUE NOW' : (c.status === 'COMPLETED' ? '✓ COMPLETED' : '⏰ SCHEDULED');

      html += `
        <div class="${cardClass}">
          <div>
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <span class="${badgeClass}">${badgeText}</span>
              <strong style="font-size: 1.05rem; color: #0f172a;">${escapeHTML(c.contactName || 'Unnamed Contact')}</strong>
              <span style="font-size: 0.85rem; color: #64748b;">— ${c.callbackDate || ''} at ${c.callbackTime || ''}</span>
            </div>
            <div style="font-size: 0.9rem; color: #1e293b; margin-top: 0.35rem;">
              📞 <a href="tel:${escapeHTML(c.phone || '')}" style="color: #0284c7; font-weight: 600; text-decoration: none;">${escapeHTML(c.phone || 'No phone')}</a>
              ${c.email ? `<span style="color: #94a3b8; margin: 0 0.4rem;">|</span> ✉️ <a href="mailto:${escapeHTML(c.email)}" style="color: #64748b;">${escapeHTML(c.email)}</a>` : ''}
            </div>
            ${c.notes ? `<div style="font-size: 0.85rem; color: #475569; margin-top: 0.35rem; background: #f8fafc; padding: 0.35rem 0.6rem; border-radius: 4px; border: 1px solid #e2e8f0;">Note: ${escapeHTML(c.notes)}</div>` : ''}
          </div>

          <div class="callback-actions">
            <button class="btn-copy-chip" onclick="window.SabrinaApp.copyPhone('${escapeHTML(c.phone || '')}')" title="Copy raw phone for Telus softphone">📞 Copy Phone</button>
            <button class="btn-copy-chip" onclick="window.SabrinaApp.copyCbDetails('${c.id}')" title="Copy formatted text for SMS or Email">📋 Text</button>
            <button class="btn-copy-chip" onclick="window.SabrinaApp.copyCbRowExcel('${c.id}')" title="Copy table row for Excel">📊 Excel Row</button>
            ${c.status === 'PENDING' ? `
              <button class="btn-copy-chip" style="background: #f1f5f9; color: #475569;" onclick="window.SabrinaApp.snoozeCb('${c.id}', -15)" title="Step back 15m">-15m</button>
              <button class="btn-copy-chip" style="background: #fef3c7; color: #b45309; border-color: #f59e0b;" onclick="window.SabrinaApp.snoozeCb('${c.id}', 15)" title="Add 15m">+15m</button>
              <button class="btn-copy-chip" style="background: #fef3c7; color: #b45309; border-color: #f59e0b;" onclick="window.SabrinaApp.snoozeCb('${c.id}', 60)" title="Add 1 hour">+1h</button>
              <button class="btn-copy-chip" style="background: #dcfce7; color: #15803d; border-color: #22c55e; font-weight: 700;" onclick="window.SabrinaApp.completeCb('${c.id}')">✓ Done</button>
            ` : ''}
            <button class="btn-danger-outline" onclick="window.SabrinaApp.deleteCb('${c.id}', this)" title="Delete entry" style="padding: 0.25rem 0.5rem; font-size: 0.85rem;">🗑️</button>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  // Non-blocking Floating Toast Notification System
  function showToast(message, type = 'info', duration = 3000) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? '✓' : (type === 'warn' ? '⚠️' : (type === 'error' ? '✕' : 'ℹ️'));
    toast.innerHTML = `<span>${icon}</span> <span>${escapeHTML(message)}</span>`;
    toast.onclick = () => {
      toast.classList.add('toast-hiding');
      setTimeout(() => toast.remove(), 220);
    };
    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.add('toast-hiding');
        setTimeout(() => toast.remove(), 220);
      }
    }, duration);
  }

  // Time Adjustment (+/-) Helper
  function adjustTimeInputValue(inputEl, deltaMins) {
    if (!inputEl) return;
    const currentVal = (inputEl.value || '').trim();
    let baseDate = new Date();
    if (currentVal) {
      const match = currentVal.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (match) {
        let h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        const ampm = match[3] ? match[3].toUpperCase() : null;
        if (ampm === 'PM' && h < 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        baseDate.setHours(h, m, 0, 0);
      }
    }
    const newDate = new Date(baseDate.getTime() + deltaMins * 60000);
    inputEl.value = format12HourTime(newDate.getTime());
  }

  // Inline 2-Click Delete Confirmation Helper (Zero Browser Dialogs!)
  function requestInlineConfirm(buttonEl, confirmText, onConfirmed) {
    const btn = buttonEl || (window.event && window.event.target ? window.event.target.closest('button') : null);
    if (!btn) {
      onConfirmed();
      showToast('Item deleted.', 'info');
      return;
    }

    if (btn.getAttribute('data-confirming') === 'true') {
      btn.removeAttribute('data-confirming');
      btn.classList.remove('btn-confirm-delete');
      onConfirmed();
      showToast('Item deleted.', 'info');
    } else {
      btn.setAttribute('data-confirming', 'true');
      btn.classList.add('btn-confirm-delete');
      const origHtml = btn.innerHTML;
      btn.innerHTML = confirmText || 'Confirm?';
      setTimeout(() => {
        if (btn.getAttribute('data-confirming') === 'true') {
          btn.removeAttribute('data-confirming');
          btn.classList.remove('btn-confirm-delete');
          btn.innerHTML = origHtml;
        }
      }, 3500);
    }
  }

  function copyToClipboard(text, successMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        if (successMsg) showToast(successMsg, 'success');
      }).catch(() => {
        fallbackCopyText(text, successMsg);
      });
    } else {
      fallbackCopyText(text, successMsg);
    }
  }

  function fallbackCopyText(text, successMsg) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      if (successMsg) showToast(successMsg, 'success');
    } catch (err) {
      prompt('Copy to clipboard (Ctrl+C, Enter):', text);
    }
    document.body.removeChild(ta);
  }

  function copyAllCallbacksExcel() {
    const list = state.callbacks || [];
    if (list.length === 0) {
      showToast('No callbacks to copy.', 'warn');
      return;
    }
    const header = 'Name\tPhone\tEmail\tDate\tTime\tNotes\tStatus';
    const rows = list.map(c => `${c.contactName || ''}\t${c.phone || ''}\t${c.email || ''}\t${c.callbackDate || ''}\t${c.callbackTime || ''}\t${(c.notes || '').replace(/\r?\n/g, ' ')}\t${c.status || ''}`);
    const tsv = [header, ...rows].join('\n');
    copyToClipboard(tsv, `All ${list.length} callbacks copied in Excel format! Ready to paste into Excel or Google Sheets.`);
  }

  function exportCallbacksCSV() {
    const list = state.callbacks || [];
    if (list.length === 0) {
      showToast('No callbacks to export.', 'warn');
      return;
    }
    let csv = 'Name,Phone,Email,Date,Time,Notes,Status\n';
    list.forEach(c => {
      const escapeCSV = (s) => `"${(s || '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
      csv += `${escapeCSV(c.contactName)},${escapeCSV(c.phone)},${escapeCSV(c.email)},${escapeCSV(c.callbackDate)},${escapeCSV(c.callbackTime)},${escapeCSV(c.notes)},${escapeCSV(c.status)}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `Sabrina_Callbacks_${formatDateKey(getTorontoNow())}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function renderTimesheet() {
    const tbody = document.getElementById('timesheet-tbody');
    if (!tbody) return;

    if (state.shifts.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 2rem;">No historical timesheets recorded yet.</td></tr>`;
      return;
    }

    // Group shifts by date
    const dateGroups = {};
    state.shifts.forEach(shift => {
      if (!dateGroups[shift.date]) {
        dateGroups[shift.date] = {
          date: shift.date,
          shifts: [],
          totalDuration: 0,
          totalPhone: 0,
          totalOffPhone: 0,
          totalAppts: 0
        };
      }
      dateGroups[shift.date].shifts.push(shift);
      dateGroups[shift.date].totalDuration += shift.durationSeconds || 0;
      dateGroups[shift.date].totalPhone += shift.phoneSeconds || 0;
      dateGroups[shift.date].totalOffPhone += shift.offPhoneSeconds || 0;
      dateGroups[shift.date].totalAppts = Math.max(dateGroups[shift.date].totalAppts, shift.appointmentsBooked || 0);
    });

    let html = '';
    const sortedDates = Object.keys(dateGroups).sort((a,b) => b.localeCompare(a));

    sortedDates.forEach(dateKey => {
      const g = dateGroups[dateKey];
      const shiftTimesList = g.shifts.map(s => `${format12HourTime(s.startTime)}–${format12HourTime(s.endTime)}`).join(', ');
      const phoneM = Math.round(g.totalPhone / 60);
      const offPhoneM = Math.round(g.totalOffPhone / 60);

      html += `
        <tr>
          <td><strong>${formatFriendlyDate(dateKey)}</strong></td>
          <td>${shiftTimesList} (${g.shifts.length} shift${g.shifts.length > 1 ? 's' : ''})</td>
          <td style="color: #0284c7; font-weight: 600;">📞 ${phoneM} mins</td>
          <td style="color: #10b981; font-weight: 600;">📋 ${offPhoneM} mins</td>
          <td><strong>${formatHoursMinutes(g.totalDuration)}</strong></td>
          <td><span class="badge" style="background:#dcfce7; color:#15803d;">${g.totalAppts} Booked</span></td>
          <td>
            <button class="btn-danger-outline" onclick="window.SabrinaApp.deleteDateShifts('${dateKey}', this)">Delete Day</button>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  }

  function roundUpTo15Minutes(seconds) {
    if (!seconds || seconds <= 0) return 0;
    const minutes = seconds / 60;
    const roundedMinutes = Math.ceil(minutes / 15) * 15;
    return roundedMinutes * 60;
  }

  function renderInvoice() {
    const tbody = document.getElementById('invoice-tbody');
    if (!tbody) return;

    const rate = parseFloat(document.getElementById('inv-rate')?.value) || state.settings.hourlyRate || 25.00;
    const invNum = document.getElementById('inv-num')?.value || 'INV-2026-001';
    const startDateVal = document.getElementById('inv-start-date')?.value;
    const endDateVal = document.getElementById('inv-end-date')?.value;

    document.getElementById('inv-display-number').textContent = `Invoice #: ${invNum}`;
    document.getElementById('inv-display-date').textContent = `Date: ${formatFriendlyDate(getTorontoNow())}`;
    document.getElementById('inv-contractor-name').textContent = state.settings.contractorName;
    document.getElementById('inv-client-name').textContent = state.settings.clientName;
    document.getElementById('inv-hourly-rate').textContent = `$${rate.toFixed(2)} CAD / hr`;

    // Group shifts by date
    const dateGroups = {};
    state.shifts.forEach(shift => {
      // Date range filtering
      if (startDateVal && shift.date < startDateVal) return;
      if (endDateVal && shift.date > endDateVal) return;

      if (!dateGroups[shift.date]) {
        dateGroups[shift.date] = {
          date: shift.date,
          shifts: [],
          totalSeconds: 0
        };
      }
      dateGroups[shift.date].shifts.push(shift);
      dateGroups[shift.date].totalSeconds += (shift.durationSeconds || 0);
    });

    const dates = Object.keys(dateGroups).sort();

    if (dates.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 2rem; color: #94a3b8;">No billable shifts recorded in this billing date range.</td></tr>`;
      document.getElementById('inv-total-formatted').textContent = '0h 00m';
      document.getElementById('inv-total-decimal').textContent = '0.00 hrs';
      document.getElementById('inv-grand-total').textContent = '$0.00 CAD';
      return;
    }

    let overallRoundedSeconds = 0;
    let html = '';

    dates.forEach(dKey => {
      const g = dateGroups[dKey];
      const roundedSeconds = roundUpTo15Minutes(g.totalSeconds);
      overallRoundedSeconds += roundedSeconds;

      const decimalHours = roundedSeconds / 3600;
      const lineTotal = decimalHours * rate;

      html += `
        <tr>
          <td contenteditable="true"><strong>${formatFriendlyDate(dKey)}</strong></td>
          <td contenteditable="true"><strong>${decimalHours.toFixed(2)} hrs</strong> (${formatHoursMinutes(roundedSeconds)})</td>
          <td contenteditable="true" style="text-align: right;">$${rate.toFixed(2)}</td>
          <td contenteditable="true" style="text-align: right; font-weight: 700;">$${lineTotal.toFixed(2)}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html;

    const totalDecimalHours = overallRoundedSeconds / 3600;
    const grandTotal = totalDecimalHours * rate;

    document.getElementById('inv-total-formatted').textContent = formatHoursMinutes(overallRoundedSeconds);
    document.getElementById('inv-total-decimal').textContent = `${totalDecimalHours.toFixed(2)} hrs`;
    document.getElementById('inv-grand-total').textContent = `$${grandTotal.toFixed(2)} CAD`;
  }

  // --- Telus Log Parser Extrapolator ---
  function parseTelusLogs(rawText) {
    if (!rawText || !rawText.trim()) return [];

    const lines = rawText.split('\n');
    const parsedCalls = [];

    // Common Telus / RingCentral / Softphone call log regexes
    // e.g., "Inbound Call (416) 555-0192 00:04:12 10:14 AM"
    // e.g., "Outbound 905-555-1234 4m 32s"
    const durationRegex = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})|(\d+)\s*(?:m|min)\s*(\d+)?\s*(?:s|sec)?/i;
    const timeRegex = /(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)/i;
    const phoneRegex = /(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/;

    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let callType = 'Phone Call';
      if (/inbound|incoming|received/i.test(trimmed)) callType = '📞 Inbound';
      else if (/outbound|outgoing|made|dialed/i.test(trimmed)) callType = '📱 Outbound';
      else if (/missed/i.test(trimmed)) callType = '❌ Missed';

      const phoneMatch = trimmed.match(phoneRegex);
      const party = phoneMatch ? phoneMatch[0] : 'Customer';

      const timeMatch = trimmed.match(timeRegex);
      const callTime = timeMatch ? timeMatch[0] : 'Today';

      // Parse Duration
      let durationSeconds = 0;
      let durationStr = '00:00';

      const durMatch = trimmed.match(durationRegex);
      if (durMatch) {
        if (durMatch[2] !== undefined && durMatch[3] !== undefined) {
          // Format hh:mm:ss or mm:ss
          const hours = durMatch[1] ? parseInt(durMatch[1], 10) : 0;
          const mins = parseInt(durMatch[2], 10);
          const secs = parseInt(durMatch[3], 10);
          durationSeconds = (hours * 3600) + (mins * 60) + secs;
          durationStr = `${hours > 0 ? hours + ':' : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else if (durMatch[4] !== undefined) {
          // Format Xm Ys
          const mins = parseInt(durMatch[4], 10);
          const secs = durMatch[5] ? parseInt(durMatch[5], 10) : 0;
          durationSeconds = (mins * 60) + secs;
          durationStr = `${mins}m ${secs}s`;
        }
      }

      // Default reasonable assumption if line mentions call but duration not found
      if (durationSeconds === 0 && !/missed/i.test(trimmed)) {
        durationSeconds = 180; // 3 min standard estimate if only call is logged
        durationStr = '~3m 00s (est)';
      }

      parsedCalls.push({
        type: callType,
        party: party,
        time: callTime,
        durationStr: durationStr,
        durationSeconds: durationSeconds
      });
    });

    return parsedCalls;
  }

  // --- Sample Data Generator (for Quick Verification) ---
  function loadSampleData(silent = false) {
    const today = getTorontoNow();
    const sampleShifts = [];

    // Helper to generate past days
    for (let i = 4; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateKey = formatDateKey(d);

      // Morning Split Shift: 9:00 AM to 3:00 PM (6 hours)
      const morningStart = new Date(d);
      morningStart.setHours(9, 0, 0, 0);
      const morningEnd = new Date(d);
      morningEnd.setHours(15, 0, 0, 0);

      sampleShifts.push({
        id: 'sample_morn_' + i,
        date: dateKey,
        startTime: morningStart.getTime(),
        endTime: morningEnd.getTime(),
        durationSeconds: 6 * 3600,
        phoneSeconds: 2.5 * 3600, // 2.5 hours phone
        offPhoneSeconds: 3.5 * 3600,
        appointmentsBooked: 2 + (i % 3),
        notes: 'Morning booking shift: Inbound/outbound calls & email confirmations'
      });

      // Evening Split Shift: 5:00 PM to 7:00 PM (2 hours)
      const eveningStart = new Date(d);
      eveningStart.setHours(17, 0, 0, 0);
      const eveningEnd = new Date(d);
      eveningEnd.setHours(19, 0, 0, 0);

      sampleShifts.push({
        id: 'sample_eve_' + i,
        date: dateKey,
        startTime: eveningStart.getTime(),
        endTime: eveningEnd.getTime(),
        durationSeconds: 2 * 3600,
        phoneSeconds: 1.2 * 3600,
        offPhoneSeconds: 0.8 * 3600,
        appointmentsBooked: 1 + (i % 2),
        notes: 'Evening follow-up shift: Text message responses & evening calls'
      });
    }

    if (!silent) {
      pushUndoSnapshot('Load Sample Week');
    }
    state.shifts = sampleShifts;
    persistState();
    updateUI();
    if (!silent) {
      showToast('Sample week loaded! Check Timesheet & Invoice tabs.', 'success');
    }
  }

  // --- CSV Export ---
  function exportCSV() {
    if (state.shifts.length === 0) {
      showToast('No shifts to export yet.', 'warn');
      return;
    }

    const headers = ['Date', 'Start Time', 'End Time', 'Duration (Hours)', 'Phone Time (Minutes)', 'Off-Phone Time (Minutes)', 'Appts Booked', 'Notes'];
    const rows = state.shifts.map(s => [
      s.date,
      format12HourTime(s.startTime),
      format12HourTime(s.endTime),
      (s.durationSeconds / 3600).toFixed(2),
      Math.round((s.phoneSeconds || 0) / 60),
      Math.round((s.offPhoneSeconds || 0) / 60),
      s.appointmentsBooked || 0,
      `"${(s.notes || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Sabrina_Hours_${formatDateKey(getTorontoNow())}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Timesheet exported to CSV.', 'success');
  }

  // --- Sales Reps Management ---
  function populateSalesRepsDropdown() {
    const repSelect = document.getElementById('quick-appt-rep');
    if (!repSelect) return;
    const currentVal = repSelect.value;
    repSelect.innerHTML = '';
    const reps = (Array.isArray(state.salesReps) && state.salesReps.length > 0) ? state.salesReps : DEFAULT_SALES_REPS;
    reps.forEach(rep => {
      const opt = document.createElement('option');
      opt.value = rep;
      opt.textContent = rep;
      if (rep === currentVal) opt.selected = true;
      repSelect.appendChild(opt);
    });
    if (!repSelect.value && repSelect.options.length > 0) {
      repSelect.selectedIndex = 0;
    }
  }

  function renderSalesRepsSettings() {
    const container = document.getElementById('sales-reps-list');
    if (!container) return;
    container.innerHTML = '';

    const reps = (Array.isArray(state.salesReps) && state.salesReps.length > 0) ? state.salesReps : DEFAULT_SALES_REPS;
    reps.forEach((rep, index) => {
      const item = document.createElement('div');
      item.className = 'rep-item';
      item.innerHTML = `
        <div class="rep-name">
          <span>👤</span>
          <span>${escapeHtml(rep)}</span>
        </div>
        <button class="btn-secondary btn-delete-rep" data-index="${index}" style="font-size: 0.75rem; padding: 0.25rem 0.65rem; color: #ef4444; border-color: #ef4444;">
          🗑️ Remove
        </button>
      `;
      container.appendChild(item);
    });

    // Wire inline confirm for delete buttons
    container.querySelectorAll('.btn-delete-rep').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(btn.getAttribute('data-index'), 10);
        const repName = state.salesReps[idx];
        requestInlineConfirm(btn, 'Confirm?', () => {
          pushUndoSnapshot(`Remove Rep ${repName}`);
          state.salesReps.splice(idx, 1);
          persistState();
          populateSalesRepsDropdown();
          renderSalesRepsSettings();
          showToast(`Removed ${repName}`, 'info');
        });
      });
    });
  }

  // --- Backup & Restore ---
  function backupJSON() {
    const exportData = {
      version: state.version || '1.5.0',
      build: state.build || '2026.09.12-rev1',
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      shifts: state.shifts,
      callbacks: state.callbacks,
      calls: state.calls,
      salesReps: state.salesReps,
      todayAppts: state.todayAppts
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Work_Tracker_Backup_${formatDateKey(getTorontoNow())}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Backup file downloaded.', 'success');
  }

  function restoreJSON(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = JSON.parse(e.target.result);
        if (data && (Array.isArray(data.shifts) || Array.isArray(data.callbacks) || Array.isArray(data.calls) || Array.isArray(data.salesReps))) {
          pushUndoSnapshot('Before JSON Restore');
          if (Array.isArray(data.shifts)) state.shifts = data.shifts;
          if (Array.isArray(data.callbacks)) state.callbacks = data.callbacks;
          if (Array.isArray(data.calls)) state.calls = data.calls;
          if (Array.isArray(data.salesReps)) state.salesReps = data.salesReps;
          if (data.settings) state.settings = { ...state.settings, ...data.settings };
          persistState();
          updateUI();
          showToast('Backup successfully restored!', 'success');
        } else {
          showToast('Invalid backup file format.', 'error');
        }
      } catch (err) {
        showToast('Could not parse backup file: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  }

  // --- 5-Minute Auto-Save & Undo History System ---
  function pushUndoSnapshot(actionName) {
    try {
      if (!Array.isArray(state.undoStack)) state.undoStack = [];
      const snapshotData = {
        shifts: JSON.parse(JSON.stringify(state.shifts || [])),
        callbacks: JSON.parse(JSON.stringify(state.callbacks || [])),
        calls: JSON.parse(JSON.stringify(state.calls || [])),
        salesReps: JSON.parse(JSON.stringify(state.salesReps || [])),
        todayAppts: state.todayAppts || 0
      };
      state.undoStack.push({
        action: actionName || 'Change',
        timestamp: Date.now(),
        data: snapshotData
      });
      if (state.undoStack.length > 15) {
        state.undoStack.shift();
      }
      updateUndoButtonState();
    } catch (e) {
      console.error('Error pushing undo snapshot', e);
    }
  }

  function updateUndoButtonState() {
    const btnUndo = document.getElementById('btn-undo-action');
    if (!btnUndo) return;
    if (state.undoStack && state.undoStack.length > 0) {
      const lastAction = state.undoStack[state.undoStack.length - 1];
      btnUndo.disabled = false;
      btnUndo.style.opacity = '1';
      btnUndo.style.cursor = 'pointer';
      btnUndo.title = `Undo: ${lastAction.action} (${state.undoStack.length} in stack)`;
      btnUndo.innerHTML = `↩️ Undo: ${escapeHtml(lastAction.action.substring(0, 18))}${lastAction.action.length > 18 ? '...' : ''}`;
    } else {
      btnUndo.disabled = true;
      btnUndo.style.opacity = '0.5';
      btnUndo.style.cursor = 'not-allowed';
      btnUndo.title = 'No recent actions to undo';
      btnUndo.innerHTML = '↩️ Undo Last Action';
    }
  }

  function undoLastAction() {
    if (!state.undoStack || state.undoStack.length === 0) {
      showToast('No actions to undo.', 'info');
      return;
    }
    const entry = state.undoStack.pop();
    if (!entry || !entry.data) return;

    state.shifts = entry.data.shifts || [];
    state.callbacks = entry.data.callbacks || [];
    state.calls = entry.data.calls || [];
    state.salesReps = entry.data.salesReps || [...DEFAULT_SALES_REPS];
    state.todayAppts = entry.data.todayAppts || 0;

    persistState();
    updateUI();
    updateUndoButtonState();
    showToast(`Undid "${entry.action}"! Restored previous state.`, 'success');
  }

  function take5MinSnapshot(label = '5-Min Auto-Save') {
    try {
      const snap = {
        id: 'snap_' + Date.now(),
        timestamp: Date.now(),
        label: label,
        version: state.version || '1.5.0',
        build: state.build || '2026.09.12-rev1',
        formattedTime: format12HourTime(Date.now()),
        formattedDate: formatDateKey(getTorontoNow()),
        shiftsCount: (state.shifts || []).length,
        callbacksCount: (state.callbacks || []).length,
        callsCount: (state.calls || []).length,
        data: {
          shifts: JSON.parse(JSON.stringify(state.shifts || [])),
          callbacks: JSON.parse(JSON.stringify(state.callbacks || [])),
          calls: JSON.parse(JSON.stringify(state.calls || [])),
          salesReps: JSON.parse(JSON.stringify(state.salesReps || []))
        }
      };

      if (!Array.isArray(state.snapshots)) state.snapshots = [];
      // Prevent duplicate rapid snapshots within 20s if auto-saving
      if (label === '5-Min Auto-Save' && state.snapshots.length > 0) {
        const lastSnap = state.snapshots[0];
        if (Date.now() - (lastSnap.timestamp || 0) < 20000) {
          return;
        }
      }

      state.snapshots.unshift(snap);
      if (state.snapshots.length > 24) {
        state.snapshots = state.snapshots.slice(0, 24);
      }
      persistState();
      renderSnapshotsHistory();
    } catch (e) {
      console.error('Failed to take 5-minute snapshot', e);
    }
  }

  function restoreFromSnapshot(snapId, btnEl) {
    const snap = (state.snapshots || []).find(s => s.id === snapId || s.file === snapId);
    if (!snap) {
      showToast('Snapshot could not be found.', 'error');
      return;
    }

    requestInlineConfirm(btnEl, 'Restore?', () => {
      // Push undo snapshot of current state before restoring
      pushUndoSnapshot(`Restore Snapshot (${snap.formattedTime || 'History'})`);

      if (snap.data) {
        if (Array.isArray(snap.data.shifts)) state.shifts = JSON.parse(JSON.stringify(snap.data.shifts));
        if (Array.isArray(snap.data.callbacks)) state.callbacks = JSON.parse(JSON.stringify(snap.data.callbacks));
        if (Array.isArray(snap.data.calls)) state.calls = JSON.parse(JSON.stringify(snap.data.calls));
        if (Array.isArray(snap.data.salesReps)) state.salesReps = JSON.parse(JSON.stringify(snap.data.salesReps));
      }

      persistState();
      updateUI();
      showToast(`Snapshot from ${snap.formattedTime || 'History'} successfully restored!`, 'success');
    });
  }

  function renderSnapshotsHistory() {
    const container = document.getElementById('history-snapshots-list');
    if (!container) return;

    const list = state.snapshots || [];
    if (list.length === 0) {
      container.innerHTML = `
        <div style="padding: 1rem; color: var(--text-muted); font-size: 0.85rem; text-align: center; border: 1px dashed var(--border); border-radius: 6px;">
          ⏱️ No saved snapshots yet. Snapshots will appear automatically every 5 minutes while you work.
        </div>
      `;
      return;
    }

    let html = '';
    list.forEach(snap => {
      const timeStr = snap.formattedTime || (snap.timestamp ? format12HourTime(snap.timestamp) : 'Snapshot');
      const dateStr = snap.formattedDate || (snap.timestamp ? formatDateKey(new Date(snap.timestamp)) : '');
      const labelStr = snap.label || (snap.file ? 'Toolbar Snapshot' : 'Auto-Save');
      const countDetails = `${snap.shiftsCount || (snap.data?.shifts?.length || 0)} shifts &bull; ${snap.callbacksCount || (snap.data?.callbacks?.length || 0)} callbacks &bull; ${snap.callsCount || (snap.data?.calls?.length || 0)} calls`;

      html += `
        <div class="snapshot-item">
          <div class="snapshot-info">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span style="font-size: 0.95rem;">⏱️</span>
              <strong class="snapshot-time">${escapeHtml(timeStr)}</strong>
              <span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-size: 0.72rem; padding: 0.1rem 0.45rem; border-radius: 4px;">${escapeHtml(labelStr)}</span>
            </div>
            <div class="snapshot-meta">
              ${dateStr ? escapeHtml(dateStr) + ' &bull; ' : ''}${countDetails}
            </div>
          </div>
          <button class="btn-secondary btn-restore-snap" data-snap-id="${escapeHtml(snap.id || snap.file)}" style="font-size: 0.75rem; padding: 0.25rem 0.65rem; color: #10b981; border-color: #10b981;">
            ↺ Restore
          </button>
        </div>
      `;
    });

    container.innerHTML = html;

    // Attach inline confirmation to restore buttons
    container.querySelectorAll('.btn-restore-snap').forEach(btn => {
      btn.addEventListener('click', () => {
        const snapId = btn.getAttribute('data-snap-id');
        restoreFromSnapshot(snapId, btn);
      });
    });
  }

  function updateVersionLabels() {
    const vBadge = document.getElementById('app-version-badge');
    if (vBadge) vBadge.textContent = `v${state.version || '1.5.0'}`;
    const sBadge = document.getElementById('settings-version-badge');
    if (sBadge) sBadge.textContent = `v${state.version || '1.5.0'}`;
    const bId = document.getElementById('settings-build-id');
    if (bId) bId.textContent = state.build || '2026.09.11-rev2';
    const rDate = document.getElementById('settings-release-date');
    if (rDate) rDate.textContent = state.releaseDate || '2026-09-11';
  }

  function handleCheckUpdates() {
    take5MinSnapshot('Pre-Update Safety Backup');
    const btn = document.getElementById('btn-check-updates');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Checking GitHub repository...';
    }

    const githubRawUrl = 'https://raw.githubusercontent.com/basscleff-lab/Daily_Schedule/main/version.json?t=' + Date.now();

    fetch(githubRawUrl)
      .then(res => {
        if (!res.ok) throw new Error('GitHub returned status ' + res.status);
        return res.json();
      })
      .then(vData => {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🔄 Check for Updates / Pull Latest Code';
        }
        const currentVer = state.version || '1.5.0';
        const isUpToDate = vData.version === currentVer && vData.build === state.build;

        let msg = `✅ Safe Snapshot Created!\n\n`;
        if (isUpToDate) {
          msg += `Status: Up to date! (v${vData.version} - Build ${vData.build})\n\n`;
          msg += `Sabrina is currently running the latest release from GitHub.`;
          showToast(`Up to date! Latest release: v${vData.version}`, 'success');
        } else {
          msg += `🚀 New Update Available: v${vData.version} (Build ${vData.build})!\n`;
          if (vData.notes) msg += `Notes: ${vData.notes}\n\n`;
          msg += `To apply this update on Sabrina's PC:\n1. Run Deploy_To_This_PC.bat (or 'git pull').\n2. All local shift logs in data\\ are safe and protected.`;
          showToast(`New update available: v${vData.version}!`, 'info');
        }
        alert(msg);
      })
      .catch(() => {
        // Fallback to local version.json check
        fetch('version.json?t=' + Date.now())
          .then(res => res.json())
          .then(vData => {
            if (btn) {
              btn.disabled = false;
              btn.textContent = '🔄 Check for Updates / Pull Latest Code';
            }
            showToast('Snapshot saved! Local version: v' + (vData.version || '1.5.0'), 'success');
            alert(`✅ Pre-update snapshot saved!\n\nLocal Version: v${vData.version || '1.5.0'}\nGitHub Repo: github.com/basscleff-lab/Daily_Schedule\n\nRun Deploy_To_This_PC.bat to sync latest files.`);
          })
          .catch(() => {
            if (btn) {
              btn.disabled = false;
              btn.textContent = '🔄 Check for Updates / Pull Latest Code';
            }
            showToast('Pre-update safety snapshot saved!', 'success');
            alert(`✅ Pre-update snapshot saved!\n\nAll live data in data\\ is strictly preserved.`);
          });
      });
  }

  // --- Event Bindings ---
  function initEventHandlers() {
    // Theme Switcher Button
    document.getElementById('btn-web-theme')?.addEventListener('click', () => {
      const themes = ['dark', 'light', 'highvis'];
      const nextIdx = (themes.indexOf(state.theme) + 1) % themes.length;
      applyTheme(themes[nextIdx], true);
    });

    // Transport Buttons
    document.getElementById('btn-start-rec')?.addEventListener('click', startSession);
    document.getElementById('btn-pause')?.addEventListener('click', pauseSession);
    document.getElementById('btn-stop')?.addEventListener('click', stopSession);

    // Activity Switcher Buttons
    document.getElementById('activity-btn-group')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.act-btn');
      if (btn && btn.dataset.act) {
        switchActivity(btn.dataset.act);
      }
    });

    // Compact Mode Toggle
    document.getElementById('btn-toggle-compact')?.addEventListener('click', () => {
      state.isCompact = !state.isCompact;
      persistState();
      updateUI();
    });

    // Always-On-Top Document Picture-in-Picture Float
    let pipWindow = null;
    document.getElementById('btn-pip-float')?.addEventListener('click', async () => {
      if (window.documentPictureInPicture && window.documentPictureInPicture.window) {
        window.documentPictureInPicture.window.close();
        return;
      }

      if (!('documentPictureInPicture' in window)) {
        window.open('popup.html', 'SabrinaMiniBar', 'width=500,height=225,resizable=yes');
        return;
      }

      try {
        pipWindow = await window.documentPictureInPicture.requestWindow({
          width: 500,
          height: 185
        });

        // Copy styles
        [...document.styleSheets].forEach((styleSheet) => {
          try {
            const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
            const style = document.createElement('style');
            style.textContent = cssRules;
            pipWindow.document.head.appendChild(style);
          } catch (e) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.type = styleSheet.type;
            link.media = styleSheet.media;
            link.href = styleSheet.href;
            pipWindow.document.head.appendChild(link);
          }
        });

        pipWindow.document.body.style.background = '#0f172a';
        pipWindow.document.body.style.margin = '0';
        pipWindow.document.body.style.padding = '8px';

        const transportBar = document.getElementById('transport-bar');
        const placeholder = document.createElement('div');
        placeholder.id = 'transport-bar-placeholder';
        placeholder.style.display = 'none';
        transportBar.parentNode.insertBefore(placeholder, transportBar);
        pipWindow.document.body.appendChild(transportBar);

        pipWindow.addEventListener('pagehide', () => {
          placeholder.parentNode.insertBefore(transportBar, placeholder);
          placeholder.remove();
          pipWindow = null;
        });
      } catch (err) {
        console.warn('Document PiP request error, falling back to popup', err);
        window.open('popup.html', 'SabrinaMiniBar', 'width=500,height=225,resizable=yes');
      }
    });

    // Pop Out Dedicated Mini Toolbar
    document.getElementById('btn-popout-mini')?.addEventListener('click', () => {
      window.open('popup.html', 'SabrinaMiniBar', 'width=500,height=230,resizable=yes');
    });

    // Cross-window live sync
    window.addEventListener('storage', () => {
      loadPersistedState();
      updateUI();
    });

    if (syncChannel) {
      syncChannel.onmessage = (e) => {
        if (e.data && e.data.type === 'THEME_CHANGE') {
          applyTheme(e.data.theme, false);
        } else {
          loadPersistedState();
          updateUI();
        }
      };
    }

    // Appointment Stepper & Quick Modal
    const quickApptModal = document.getElementById('quick-appt-modal');
    const quickApptName = document.getElementById('quick-appt-name');
    const quickApptPhone = document.getElementById('quick-appt-phone');
    const quickApptDate = document.getElementById('quick-appt-date');
    const quickApptTime = document.getElementById('quick-appt-time');
    const quickApptRep = document.getElementById('quick-appt-rep');
    const quickApptCbCheck = document.getElementById('quick-appt-cb-check');
    const quickApptCbBox = document.getElementById('quick-appt-cb-time-box');

    quickApptCbCheck?.addEventListener('change', () => {
      if (quickApptCbBox) {
        quickApptCbBox.style.display = quickApptCbCheck.checked ? 'block' : 'none';
      }
    });

    // Delegated listener for all Stepper Chips (+/- buttons)
    document.addEventListener('click', (e) => {
      const chip = e.target.closest('.stepper-chip[data-delta]');
      if (chip) {
        const targetId = chip.getAttribute('data-target');
        const delta = parseInt(chip.getAttribute('data-delta'), 10);
        const targetInput = document.getElementById(targetId);
        if (targetInput && !isNaN(delta)) {
          adjustTimeInputValue(targetInput, delta);
        }
      }
    });

    // Quick Appt Presets
    document.getElementById('btn-quick-cb-today')?.addEventListener('click', () => {
      const d = document.getElementById('quick-appt-cb-date');
      if (d) d.value = formatDateKey(getTorontoNow());
    });
    document.getElementById('btn-quick-cb-tomorrow')?.addEventListener('click', () => {
      const d = document.getElementById('quick-appt-cb-date');
      const tom = new Date(Date.now() + 86400 * 1000);
      if (d) d.value = formatDateKey(tom);
    });

    // Inline Callback Presets
    document.getElementById('btn-inline-cb-today')?.addEventListener('click', () => {
      const d = document.getElementById('inline-cb-date');
      if (d) d.value = formatDateKey(getTorontoNow());
    });
    document.getElementById('btn-inline-cb-tomorrow')?.addEventListener('click', () => {
      const d = document.getElementById('inline-cb-date');
      const tom = new Date(Date.now() + 86400 * 1000);
      if (d) d.value = formatDateKey(tom);
    });

    document.getElementById('btn-appt-plus')?.addEventListener('click', () => {
      if (quickApptModal) {
        if (quickApptName) quickApptName.value = '';
        if (quickApptPhone) quickApptPhone.value = '';
        const tom = new Date(Date.now() + 86400 * 1000);
        if (quickApptDate) quickApptDate.value = formatDateKey(tom);
        if (quickApptTime) quickApptTime.value = '10:00 AM';
        if (quickApptCbCheck) quickApptCbCheck.checked = true;
        if (quickApptCbBox) quickApptCbBox.style.display = 'block';
        const d = document.getElementById('quick-appt-cb-date');
        const t = document.getElementById('quick-appt-cb-time');
        if (d) d.value = formatDateKey(getTorontoNow());
        if (t) t.value = format12HourTime(Date.now() + 3600 * 1000);
        quickApptModal.style.display = 'flex';
        quickApptName?.focus();
      } else {
        state.todayAppts++;
        persistState();
        updateUI();
      }
    });

    document.getElementById('btn-close-quick-appt')?.addEventListener('click', () => {
      if (quickApptModal) quickApptModal.style.display = 'none';
    });

    document.getElementById('btn-quick-appt-cancel')?.addEventListener('click', () => {
      if (quickApptModal) quickApptModal.style.display = 'none';
    });

    quickApptModal?.addEventListener('click', (e) => {
      if (e.target === quickApptModal) quickApptModal.style.display = 'none';
    });

    document.getElementById('btn-quick-appt-skip')?.addEventListener('click', () => {
      state.todayAppts++;
      if (quickApptModal) quickApptModal.style.display = 'none';
      persistState();
      updateUI();
      showToast('Appointment count increased (+1).', 'info');
    });

    document.getElementById('btn-quick-appt-save')?.addEventListener('click', () => {
      state.todayAppts++;

      const name = (quickApptName?.value || '').trim();
      const phone = (quickApptPhone?.value || '').trim();
      const apptDateVal = quickApptDate?.value || formatDateKey(new Date(Date.now() + 86400 * 1000));
      const apptTimeVal = (quickApptTime?.value || '10:00 AM').trim();
      const repVal = quickApptRep?.value || (state.salesReps && state.salesReps[0]) || 'Representative 1';
      const isCb = quickApptCbCheck ? quickApptCbCheck.checked : false;

      const nowMs = Date.now();
      const newCall = {
        id: 'call_' + nowMs,
        date: formatDateKey(getTorontoNow()),
        time: format12HourTime(nowMs),
        contactName: name || 'Customer',
        phone: phone || '',
        type: 'Appointment Booked',
        apptDate: apptDateVal,
        apptTime: apptTimeVal,
        salesRep: repVal,
        outcome: `Appt scheduled for ${repVal} on ${apptDateVal} at ${apptTimeVal}`,
        hasCallback: isCb,
        createdAt: nowMs,
        updatedAt: nowMs
      };
      state.calls.unshift(newCall);

      if (isCb) {
        const cbDate = document.getElementById('quick-appt-cb-date')?.value || formatDateKey(getTorontoNow());
        const cbTimeStr = (document.getElementById('quick-appt-cb-time')?.value || format12HourTime(nowMs + 3600 * 1000)).trim();
        const dueEpoch = parseDateTimeToEpoch(cbDate, cbTimeStr);
        state.callbacks.unshift({
          id: 'cb_' + (nowMs + 1),
          contactName: name || 'Customer',
          phone: phone || '',
          email: '',
          callbackDate: cbDate,
          callbackTime: cbTimeStr,
          dueEpoch: dueEpoch,
          notes: `Follow-up for appt with ${repVal} (${apptDateVal} at ${apptTimeVal})`,
          status: 'PENDING',
          createdAt: nowMs,
          updatedAt: nowMs
        });
      }

      if (quickApptModal) quickApptModal.style.display = 'none';
      persistState();
      updateUI();
      showToast(`Appointment booked for ${name || 'Customer'}!`, 'success');
    });

    // Inline Add Callback Handler (From Callbacks Tab - No popup!)
    document.getElementById('btn-inline-add-cb')?.addEventListener('click', () => {
      const name = (document.getElementById('inline-cb-name')?.value || '').trim();
      const phone = (document.getElementById('inline-cb-phone')?.value || '').trim();
      let dateVal = (document.getElementById('inline-cb-date')?.value || '').trim();
      let timeVal = (document.getElementById('inline-cb-time')?.value || '').trim();
      const notes = (document.getElementById('inline-cb-notes')?.value || '').trim();

      if (!name && !phone) {
        showToast('Please enter at least a contact name or phone number.', 'warn');
        return;
      }

      const nowMs = Date.now();
      if (!dateVal) dateVal = formatDateKey(getTorontoNow());
      if (!timeVal) timeVal = format12HourTime(nowMs + 15 * 60 * 1000);

      const dueEpoch = parseDateTimeToEpoch(dateVal, timeVal);
      state.callbacks.unshift({
        id: 'cb_' + nowMs,
        contactName: name || 'Contact',
        phone: phone,
        email: '',
        callbackDate: dateVal,
        callbackTime: timeVal,
        dueEpoch: dueEpoch,
        notes: notes,
        status: 'PENDING',
        createdAt: nowMs,
        updatedAt: nowMs
      });

      // Clear inline inputs
      const nameEl = document.getElementById('inline-cb-name');
      const phoneEl = document.getElementById('inline-cb-phone');
      const notesEl = document.getElementById('inline-cb-notes');
      if (nameEl) nameEl.value = '';
      if (phoneEl) phoneEl.value = '';
      if (notesEl) notesEl.value = '';

      persistState();
      updateUI();
      showToast(`Callback added for ${name || phone}!`, 'success');
    });

    // Inline Add Call / Lead Handler (From Daily Summary Tab - No popup!)
    document.getElementById('btn-inline-add-call')?.addEventListener('click', () => {
      const name = (document.getElementById('inline-call-name')?.value || '').trim();
      const phone = (document.getElementById('inline-call-phone')?.value || '').trim();
      const type = document.getElementById('inline-call-type')?.value || 'Inbound Inquiry';
      let timeVal = (document.getElementById('inline-call-time')?.value || '').trim();
      const outcome = (document.getElementById('inline-call-outcome')?.value || '').trim();
      const reportDate = document.getElementById('daily-summary-date')?.value || formatDateKey(getTorontoNow());

      if (!name && !phone) {
        showToast('Please enter at least a customer name or phone number.', 'warn');
        return;
      }

      const nowMs = Date.now();
      if (!timeVal) timeVal = format12HourTime(nowMs);

      state.calls.unshift({
        id: 'call_' + nowMs,
        date: reportDate,
        time: timeVal,
        contactName: name || 'Customer',
        phone: phone || '',
        type: type,
        outcome: outcome || 'Call logged',
        hasCallback: false,
        createdAt: nowMs,
        updatedAt: nowMs
      });

      if (type === 'Appointment Booked') {
        state.todayAppts++;
      }

      // Clear inline inputs
      const nameEl = document.getElementById('inline-call-name');
      const phoneEl = document.getElementById('inline-call-phone');
      const outcomeEl = document.getElementById('inline-call-outcome');
      if (nameEl) nameEl.value = '';
      if (phoneEl) phoneEl.value = '';
      if (outcomeEl) outcomeEl.value = '';

      persistState();
      updateUI();
      showToast(`Logged ${type} for ${name || phone}!`, 'success');
    });

    document.getElementById('btn-appt-minus')?.addEventListener('click', () => {
      if (state.todayAppts > 0) {
        state.todayAppts--;
        persistState();
        updateUI();
      }
    });

    // Tab Navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(targetTab)?.classList.add('active');
      });
    });

    // Invoice Controls
    ['inv-start-date', 'inv-end-date', 'inv-rate', 'inv-num'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', renderInvoice);
    });

    const invoiceSheet = document.getElementById('invoice-sheet');
    const btnToggleInv = document.getElementById('btn-toggle-invoice-preview');
    const btnCloseInv = document.getElementById('btn-close-invoice-sheet');

    function toggleInvoicePreview(forceHide) {
      if (!invoiceSheet) return;
      const willHide = forceHide !== undefined ? forceHide : (invoiceSheet.style.display !== 'none');
      if (willHide) {
        invoiceSheet.style.display = 'none';
        if (btnToggleInv) btnToggleInv.innerHTML = '👁️ Show Invoice Preview';
      } else {
        invoiceSheet.style.display = 'block';
        if (btnToggleInv) btnToggleInv.innerHTML = '👁️ Hide Preview';
        invoiceSheet.scrollIntoView({ behavior: 'smooth' });
      }
    }

    btnToggleInv?.addEventListener('click', () => toggleInvoicePreview());
    btnCloseInv?.addEventListener('click', () => toggleInvoicePreview(true));

    document.getElementById('btn-print-invoice')?.addEventListener('click', () => {
      if (invoiceSheet) invoiceSheet.style.display = 'block';
      if (btnToggleInv) btnToggleInv.innerHTML = '👁️ Hide Preview';
      window.print();
    });

    document.getElementById('btn-export-csv')?.addEventListener('click', exportCSV);

    // Telus Log Parser Controls
    let parsedTelusCalls = [];
    document.getElementById('btn-parse-telus')?.addEventListener('click', () => {
      const rawText = document.getElementById('telus-raw-input')?.value || '';
      parsedTelusCalls = parseTelusLogs(rawText);

      const resContainer = document.getElementById('telus-results-container');
      const resTbody = document.getElementById('telus-parsed-tbody');
      const summaryText = document.getElementById('telus-summary-text');

      if (parsedTelusCalls.length === 0) {
        showToast('Please paste some Telus call log text first.', 'warn');
        return;
      }

      let totalSecs = 0;
      let rowsHtml = '';
      parsedTelusCalls.forEach(call => {
        totalSecs += call.durationSeconds;
        rowsHtml += `
          <tr>
            <td>${call.type}</td>
            <td>${call.party}</td>
            <td>${call.time}</td>
            <td><strong>${call.durationStr}</strong></td>
            <td>${call.durationSeconds}s</td>
          </tr>
        `;
      });

      resTbody.innerHTML = rowsHtml;
      summaryText.textContent = `Found ${parsedTelusCalls.length} calls totaling ${formatHoursMinutes(totalSecs)} (${Math.round(totalSecs / 60)} minutes) of talk time.`;
      resContainer.style.display = 'block';
    });

    document.getElementById('btn-sample-telus')?.addEventListener('click', () => {
      document.getElementById('telus-raw-input').value = 
`Inbound Call  (416) 555-0192  00:04:12  09:25 AM
Outbound Call (905) 555-0144  00:08:45  10:14 AM
Outbound Call (647) 555-9821  00:02:30  11:30 AM
Inbound Call  (416) 555-3388  00:12:10  01:15 PM
Outbound Call (905) 555-7711  00:05:00  05:30 PM`;
    });

    document.getElementById('btn-clear-telus')?.addEventListener('click', () => {
      document.getElementById('telus-raw-input').value = '';
      document.getElementById('telus-results-container').style.display = 'none';
      parsedTelusCalls = [];
    });

    document.getElementById('btn-apply-telus-today')?.addEventListener('click', () => {
      if (parsedTelusCalls.length === 0) return;
      const totalSecs = parsedTelusCalls.reduce((sum, c) => sum + c.durationSeconds, 0);

      // Add to today's active session or today's latest shift
      const todayKey = formatDateKey(getTorontoNow());
      const todayShifts = state.shifts.filter(s => s.date === todayKey);

      if (state.activeSession) {
        state.activeSession.activityTimeMap['inbound_call'] = (state.activeSession.activityTimeMap['inbound_call'] || 0) + Math.floor(totalSecs / 2);
        state.activeSession.activityTimeMap['outbound_call'] = (state.activeSession.activityTimeMap['outbound_call'] || 0) + Math.ceil(totalSecs / 2);
        showToast(`Added ${Math.round(totalSecs / 60)} minutes of Telus phone time to current active session!`, 'success');
      } else if (todayShifts.length > 0) {
        todayShifts[0].phoneSeconds = (todayShifts[0].phoneSeconds || 0) + totalSecs;
        todayShifts[0].updatedAt = Date.now();
        showToast(`Added ${Math.round(totalSecs / 60)} minutes of Telus phone time to today's shift record!`, 'success');
      } else {
        // Create an entry for today
        const now = Date.now();
        state.shifts.unshift({
          id: 'shift_telus_' + now,
          date: todayKey,
          startTime: now - (totalSecs * 1000),
          endTime: now,
          durationSeconds: totalSecs,
          phoneSeconds: totalSecs,
          offPhoneSeconds: 0,
          appointmentsBooked: state.todayAppts,
          notes: `Telus Phone Call Logs (${parsedTelusCalls.length} calls)`,
          createdAt: now,
          updatedAt: now
        });
        showToast(`Created a shift entry with ${Math.round(totalSecs / 60)} minutes from Telus call logs!`, 'success');
      }

      persistState();
      updateUI();
    });

    // Settings
    document.getElementById('btn-save-settings')?.addEventListener('click', () => {
      state.settings.contractorName = document.getElementById('setting-name')?.value || 'Contractor';
      state.settings.clientName = document.getElementById('setting-client')?.value || 'Client Company';
      state.settings.hourlyRate = parseFloat(document.getElementById('setting-rate')?.value) || 25.00;
      persistState();
      updateUI();
      showToast('Settings saved!', 'success');
    });

    // Sales Rep Management
    const btnAddRep = document.getElementById('btn-add-rep');
    const inputNewRep = document.getElementById('input-new-rep-name');
    if (btnAddRep && inputNewRep) {
      const handleAddRep = () => {
        const val = inputNewRep.value.trim();
        if (!val) {
          showToast('Please enter a representative name & role', 'warn');
          inputNewRep.focus();
          return;
        }
        if (state.salesReps.some(r => r.toLowerCase() === val.toLowerCase())) {
          showToast('That sales person is already in the list', 'warn');
          return;
        }
        state.salesReps.push(val);
        inputNewRep.value = '';
        persistState();
        populateSalesRepsDropdown();
        renderSalesRepsSettings();
        showToast(`Added ${val} to sales team`, 'success');
      };

      btnAddRep.addEventListener('click', handleAddRep);
      inputNewRep.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleAddRep();
        }
      });
    }

    document.getElementById('btn-export-reps-json')?.addEventListener('click', () => {
      const reps = (Array.isArray(state.salesReps) && state.salesReps.length > 0) ? state.salesReps : DEFAULT_SALES_REPS;
      const blob = new Blob([JSON.stringify(reps, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sales_reps.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Downloaded sales_reps.json', 'success');
    });

    // Direct Disk Sync Handlers
    document.getElementById('btn-connect-disk-folder')?.addEventListener('click', connectDiskDirectory);
    document.getElementById('btn-save-to-disk-now')?.addEventListener('click', async () => {
      if (!diskDirectoryHandle) {
        await connectDiskDirectory();
      } else {
        await writeStateToDiskDirectory();
        showToast('💾 Saved all data directly to toolbar files!', 'success');
      }
    });
    document.getElementById('btn-reload-disk-data')?.addEventListener('click', () => {
      window.location.reload();
    });

    document.getElementById('btn-backup-json')?.addEventListener('click', backupJSON);

    document.getElementById('input-restore-json')?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        restoreJSON(e.target.files[0]);
      }
    });

    document.getElementById('btn-load-sample-shifts')?.addEventListener('click', loadSampleData);

    // 5-Minute Snapshots & Undo Recovery Handlers
    document.getElementById('btn-undo-action')?.addEventListener('click', undoLastAction);
    document.getElementById('btn-take-snapshot')?.addEventListener('click', () => {
      take5MinSnapshot('Manual Snapshot');
      showToast('📸 Snapshot saved to recovery history!', 'success');
    });
    document.getElementById('btn-check-updates')?.addEventListener('click', handleCheckUpdates);

    // Manual Shift Modal Handlers
    const manualModal = document.getElementById('manual-shift-modal');
    document.getElementById('btn-open-manual-modal')?.addEventListener('click', () => {
      document.getElementById('manual-date').value = formatDateKey(getTorontoNow());
      if (manualModal) manualModal.style.display = 'flex';
    });

    document.getElementById('btn-cancel-manual')?.addEventListener('click', () => {
      if (manualModal) manualModal.style.display = 'none';
    });

    document.getElementById('btn-save-manual')?.addEventListener('click', () => {
      const dateVal = document.getElementById('manual-date').value;
      const startVal = document.getElementById('manual-start').value;
      const endVal = document.getElementById('manual-end').value;
      const phoneMins = parseInt(document.getElementById('manual-phone-mins').value, 10) || 0;
      const appts = parseInt(document.getElementById('manual-appts').value, 10) || 0;
      const notes = document.getElementById('manual-notes').value || 'Manual entry';

      if (!dateVal || !startVal || !endVal) {
        showToast('Please fill out date, start time, and end time.', 'warn');
        return;
      }

      // Convert times to epoch
      const [sh, sm] = startVal.split(':').map(Number);
      const [eh, em] = endVal.split(':').map(Number);

      const startDateObj = new Date(dateVal + 'T00:00:00');
      startDateObj.setHours(sh, sm, 0, 0);

      const endDateObj = new Date(dateVal + 'T00:00:00');
      endDateObj.setHours(eh, em, 0, 0);

      let durationSec = Math.max(0, Math.floor((endDateObj.getTime() - startDateObj.getTime()) / 1000));
      if (durationSec === 0) durationSec = 3600; // fallback 1 hr

      const phoneSec = phoneMins * 60;
      const offPhoneSec = Math.max(0, durationSec - phoneSec);
      const nowMs = Date.now();

      state.shifts.unshift({
        id: 'shift_manual_' + nowMs,
        date: dateVal,
        startTime: startDateObj.getTime(),
        endTime: endDateObj.getTime(),
        durationSeconds: durationSec,
        phoneSeconds: phoneSec,
        offPhoneSeconds: offPhoneSec,
        appointmentsBooked: appts,
        notes: notes,
        createdAt: nowMs,
        updatedAt: nowMs
      });

      if (manualModal) manualModal.style.display = 'none';
      persistState();
      updateUI();
      showToast('Manual shift added.', 'success');
    });

    // Default dates for invoice (Current Month or Bi-weekly)
    const now = getTorontoNow();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    if (document.getElementById('inv-start-date')) {
      document.getElementById('inv-start-date').value = formatDateKey(firstDay);
    }
    if (document.getElementById('inv-end-date')) {
      document.getElementById('inv-end-date').value = formatDateKey(lastDay);
    }

    // --- Callback Modal & Handlers (Fallback Modal) ---
    const cbModal = document.getElementById('add-cb-modal');
    document.getElementById('btn-open-cb-modal')?.addEventListener('click', () => {
      document.getElementById('cb-date').value = formatDateKey(getTorontoNow());
      const defaultTime = new Date(Date.now() + 15 * 60 * 1000);
      document.getElementById('cb-time').value = format12HourTime(defaultTime.getTime());
      document.getElementById('cb-name').value = '';
      document.getElementById('cb-phone').value = '';
      document.getElementById('cb-email').value = '';
      document.getElementById('cb-notes').value = '';
      if (cbModal) cbModal.style.display = 'flex';
    });

    document.getElementById('btn-cancel-cb')?.addEventListener('click', () => {
      if (cbModal) cbModal.style.display = 'none';
    });

    cbModal?.addEventListener('click', (e) => {
      if (e.target === cbModal) cbModal.style.display = 'none';
    });

    document.getElementById('btn-cb-quick-today')?.addEventListener('click', () => {
      document.getElementById('cb-date').value = formatDateKey(getTorontoNow());
    });

    document.getElementById('btn-cb-quick-tomorrow')?.addEventListener('click', () => {
      const tmrw = getTorontoNow();
      tmrw.setDate(tmrw.getDate() + 1);
      document.getElementById('cb-date').value = formatDateKey(tmrw);
    });

    document.getElementById('btn-cb-quick-15m')?.addEventListener('click', () => {
      const t15 = new Date(Date.now() + 15 * 60 * 1000);
      document.getElementById('cb-time').value = format12HourTime(t15.getTime());
    });

    document.getElementById('btn-cb-quick-1h')?.addEventListener('click', () => {
      const t1h = new Date(Date.now() + 60 * 60 * 1000);
      document.getElementById('cb-time').value = format12HourTime(t1h.getTime());
    });

    function parseDateTimeToEpoch(dateStr, timeStr) {
      try {
        let hours = 9, minutes = 0;
        if (timeStr) {
          const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
          if (match) {
            hours = parseInt(match[1], 10);
            minutes = parseInt(match[2], 10);
            const ampm = match[3] ? match[3].toUpperCase() : null;
            if (ampm === 'PM' && hours < 12) hours += 12;
            if (ampm === 'AM' && hours === 12) hours = 0;
          }
        }
        const d = new Date(dateStr + 'T00:00:00');
        d.setHours(hours, minutes, 0, 0);
        return d.getTime();
      } catch (e) {
        return Date.now();
      }
    }

    document.getElementById('btn-save-cb')?.addEventListener('click', () => {
      const name = (document.getElementById('cb-name')?.value || '').trim();
      const phone = (document.getElementById('cb-phone')?.value || '').trim();
      const email = (document.getElementById('cb-email')?.value || '').trim();
      let dateVal = (document.getElementById('cb-date')?.value || '').trim();
      let timeVal = (document.getElementById('cb-time')?.value || '').trim();
      const notes = (document.getElementById('cb-notes')?.value || '').trim();

      if (!name && !phone) {
        showToast('Please enter at least a contact name or phone number.', 'warn');
        return;
      }

      const nowMs = Date.now();
      if (!dateVal) dateVal = formatDateKey(getTorontoNow());
      if (!timeVal) {
        const defaultTime = new Date(nowMs + 15 * 60 * 1000);
        timeVal = format12HourTime(defaultTime.getTime());
      }

      const dueEpoch = parseDateTimeToEpoch(dateVal, timeVal);

      state.callbacks.unshift({
        id: 'cb_' + nowMs,
        contactName: name || 'Contact',
        phone: phone,
        email: email,
        callbackDate: dateVal,
        callbackTime: timeVal,
        dueEpoch: dueEpoch,
        notes: notes,
        status: 'PENDING',
        createdAt: nowMs,
        updatedAt: nowMs
      });

      if (cbModal) cbModal.style.display = 'none';
      persistState();
      updateUI();
      showToast(`Callback saved for ${name || phone}!`, 'success');
    });

    // Callback Filter Buttons
    document.querySelectorAll('.cb-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cb-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.cbFilter = btn.dataset.filter || 'all';
        renderCallbacks();
      });
    });

    document.getElementById('btn-copy-all-cb-excel')?.addEventListener('click', copyAllCallbacksExcel);
    document.getElementById('btn-export-cb-csv')?.addEventListener('click', exportCallbacksCSV);

    // Daily Summary Controls
    document.getElementById('daily-summary-date')?.addEventListener('change', renderDailySummary);
    document.getElementById('btn-print-daily-summary')?.addEventListener('click', () => {
      window.print();
    });
    document.getElementById('btn-copy-daily-summary-text')?.addEventListener('click', copyDailySummaryText);

    const manualCallModal = document.getElementById('add-call-modal');
    document.getElementById('btn-add-summary-call')?.addEventListener('click', () => {
      document.getElementById('manual-call-name').value = '';
      document.getElementById('manual-call-phone').value = '';
      document.getElementById('manual-call-outcome').value = '';
      if (manualCallModal) manualCallModal.style.display = 'flex';
    });

    document.getElementById('btn-cancel-manual-call')?.addEventListener('click', () => {
      if (manualCallModal) manualCallModal.style.display = 'none';
    });

    manualCallModal?.addEventListener('click', (e) => {
      if (e.target === manualCallModal) manualCallModal.style.display = 'none';
    });

    document.getElementById('btn-save-manual-call')?.addEventListener('click', () => {
      const name = (document.getElementById('manual-call-name')?.value || '').trim();
      const phone = (document.getElementById('manual-call-phone')?.value || '').trim();
      const type = document.getElementById('manual-call-type')?.value || 'Inbound Call';
      const outcome = (document.getElementById('manual-call-outcome')?.value || '').trim();
      const reportDate = document.getElementById('daily-summary-date')?.value || formatDateKey(getTorontoNow());

      if (!name && !phone) {
        showToast('Please enter at least a customer name or phone number.', 'warn');
        return;
      }

      const nowMs = Date.now();
      state.calls.unshift({
        id: 'call_' + nowMs,
        date: reportDate,
        time: format12HourTime(nowMs),
        contactName: name || 'Customer',
        phone: phone || '',
        type: type,
        outcome: outcome || 'Call logged',
        hasCallback: false,
        createdAt: nowMs,
        updatedAt: nowMs
      });

      if (type === 'Appointment Booked') {
        state.todayAppts++;
      }

      if (manualCallModal) manualCallModal.style.display = 'none';
      persistState();
      updateUI();
      showToast(`Logged ${type} for ${name || phone}!`, 'success');
    });
  }

  // --- Exposed Global Helper for Inline HTML Handlers ---
  window.SabrinaApp = {
    deleteShift: function(shiftId, el) {
      requestInlineConfirm(el, 'Delete?', () => {
        pushUndoSnapshot('Delete Shift');
        recordDeletedId(shiftId);
        state.shifts = state.shifts.filter(s => s.id !== shiftId);
        persistState();
        updateUI();
      });
    },
    deleteDateShifts: function(dateKey, el) {
      requestInlineConfirm(el, 'Delete Day?', () => {
        pushUndoSnapshot(`Delete Day (${dateKey})`);
        const dayShifts = state.shifts.filter(s => s.date === dateKey);
        dayShifts.forEach(s => recordDeletedId(s.id));
        state.shifts = state.shifts.filter(s => s.date !== dateKey);
        persistState();
        updateUI();
      });
    },
    copyPhone: function(phone) {
      if (!phone) {
        showToast('No phone number for this contact.', 'warn');
        return;
      }
      const digitsOnly = phone.replace(/[^\d+]/g, '');
      copyToClipboard(digitsOnly || phone, `📞 Phone copied: ${digitsOnly || phone}`);
    },
    copyCbDetails: function(cbId) {
      const cb = (state.callbacks || []).find(c => c.id === cbId);
      if (!cb) return;
      const text = `Callback Reminder:\nName: ${cb.contactName || 'N/A'}\nPhone: ${cb.phone || 'N/A'}\nScheduled: ${cb.callbackDate || ''} at ${cb.callbackTime || ''}\nNotes: ${cb.notes || 'None'}`;
      copyToClipboard(text, `📋 Callback summary copied for SMS / Email!`);
    },
    copyCbRowExcel: function(cbId) {
      const cb = (state.callbacks || []).find(c => c.id === cbId);
      if (!cb) return;
      const row = `${cb.contactName || ''}\t${cb.phone || ''}\t${cb.email || ''}\t${cb.callbackDate || ''}\t${cb.callbackTime || ''}\t${(cb.notes || '').replace(/\r?\n/g, ' ')}\t${cb.status || ''}`;
      copyToClipboard(row, `📊 Excel row copied! Ready to paste into spreadsheet.`);
    },
    snoozeCb: function(cbId, mins) {
      const cb = (state.callbacks || []).find(c => c.id === cbId);
      if (!cb) return;
      const currentEpoch = cb.dueEpoch || parseDateTimeToEpoch(cb.callbackDate, cb.callbackTime) || Date.now();
      const newTime = new Date(currentEpoch + (mins * 60 * 1000));
      cb.callbackDate = formatDateKey(newTime);
      cb.callbackTime = format12HourTime(newTime.getTime());
      cb.dueEpoch = newTime.getTime();
      cb.status = 'PENDING';
      cb.updatedAt = Date.now();
      persistState();
      updateUI();
      showToast(`Callback adjusted (${mins > 0 ? '+' : ''}${mins}m) to ${cb.callbackTime}`, 'info');
    },
    completeCb: function(cbId) {
      const cb = (state.callbacks || []).find(c => c.id === cbId);
      if (!cb) return;
      cb.status = 'COMPLETED';
      cb.completedAt = Date.now();
      cb.updatedAt = Date.now();
      persistState();
      updateUI();
      showToast(`Callback for ${cb.contactName} marked complete!`, 'success');
    },
    deleteCb: function(cbId, el) {
      requestInlineConfirm(el, 'Delete?', () => {
        pushUndoSnapshot('Delete Callback');
        recordDeletedId(cbId);
        state.callbacks = (state.callbacks || []).filter(c => c.id !== cbId);
        persistState();
        updateUI();
      });
    },
    deleteCall: function(callId, el) {
      requestInlineConfirm(el, 'Delete?', () => {
        pushUndoSnapshot('Delete Call Log');
        recordDeletedId(callId);
        state.calls = (state.calls || []).filter(c => c.id !== callId);
        persistState();
        updateUI();
      });
    },
    connectDiskDirectory: connectDiskDirectory,
    writeStateToDiskDirectory: writeStateToDiskDirectory,
    undo: undoLastAction,
    takeSnapshot: function(label) {
      take5MinSnapshot(label || 'Manual Snapshot');
    },
    restoreFromSnapshot: restoreFromSnapshot
  };

  // --- Initialization ---
  function init() {
    loadPersistedState();

    // Check URL parameters for previewing / deep-linking
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('theme') && ['dark', 'light', 'highvis'].includes(urlParams.get('theme'))) {
      applyTheme(urlParams.get('theme'), false);
    }
    if (urlParams.get('sample') === '1') {
      loadSampleData(true);
    }
    if (urlParams.get('compact') === '1') {
      state.isCompact = true;
    }

    initEventHandlers();

    updateClock();
    updateUI();

    const targetTab = urlParams.get('tab');
    if (targetTab) {
      const tabBtn = document.querySelector(`.tab-btn[data-tab="tab-${targetTab}"]`);
      if (tabBtn) tabBtn.click();
    }

    if (urlParams.get('openAppt') === '1') {
      const modal = document.getElementById('quick-appt-modal');
      if (modal) modal.style.display = 'flex';
    }
    if (urlParams.get('openCb') === '1') {
      const modal = document.getElementById('add-cb-modal');
      if (modal) modal.style.display = 'flex';
    }

    // Initialize baseline snapshot if empty
    if (!state.snapshots || state.snapshots.length === 0) {
      take5MinSnapshot('Initial State');
    }

    // 5-Minute Rolling Auto-Save Interval
    setInterval(() => {
      take5MinSnapshot('5-Min Auto-Save');
    }, 5 * 60 * 1000);

    // Start 1-second ticker for clock and live timer
    timerInterval = setInterval(() => {
      updateClock();
      if (state.activeSession && state.activeSession.status === 'RUNNING') {
        const sessionSeconds = getActiveSessionSeconds();
        const todaySeconds = getTodayWorkedSeconds();
        const sessionReadout = document.getElementById('session-readout');
        const todayReadout = document.getElementById('today-readout');
        if (sessionReadout) sessionReadout.textContent = formatStopwatch(sessionSeconds);
        if (todayReadout) todayReadout.textContent = formatHoursMinutes(todaySeconds);
      }
    }, 1000);

    // Global Escape key listener to close all open modals
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay').forEach(modal => {
          modal.style.display = 'none';
        });
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);

})();
