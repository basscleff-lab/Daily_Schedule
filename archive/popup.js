// Sabrina Mini Floating Transport Bar Controller
// Client: Optima Windows and Doors

(function() {
  'use strict';

  const STORAGE_KEYS = {
    SHIFTS: 'sabrina_shifts_v1',
    ACTIVE_SESSION: 'sabrina_active_session_v1',
    SETTINGS: 'sabrina_settings_v1',
    TODAY_APPTS: 'sabrina_today_appts_v1'
  };

  const channel = window.BroadcastChannel ? new BroadcastChannel('sabrina_sync_channel') : null;

  let state = {
    shifts: [],
    activeSession: null,
    todayAppts: 0
  };

  let ticker = null;

  function getTorontoNow() {
    return new Date();
  }

  function formatDateKey(d) {
    const dt = new Date(d);
    const y = dt.toLocaleDateString('en-CA', { timeZone: 'America/Toronto', year: 'numeric' });
    const m = dt.toLocaleDateString('en-CA', { timeZone: 'America/Toronto', month: '2-digit' });
    const day = dt.toLocaleDateString('en-CA', { timeZone: 'America/Toronto', day: '2-digit' });
    return `${y}-${m}-${day}`;
  }

  function formatStopwatch(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  function formatHoursMinutes(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    return `${hours}h ${mins.toString().padStart(2, '0')}m`;
  }

  function loadState() {
    try {
      const sShifts = localStorage.getItem(STORAGE_KEYS.SHIFTS);
      if (sShifts) state.shifts = JSON.parse(sShifts);

      const sSession = localStorage.getItem(STORAGE_KEYS.ACTIVE_SESSION);
      state.activeSession = sSession ? JSON.parse(sSession) : null;

      const sAppts = localStorage.getItem(STORAGE_KEYS.TODAY_APPTS);
      if (sAppts) {
        const parsed = JSON.parse(sAppts);
        if (parsed.date === formatDateKey(getTorontoNow())) {
          state.todayAppts = parsed.count || 0;
        }
      }
    } catch (e) {
      console.warn('Error loading storage in popup', e);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEYS.SHIFTS, JSON.stringify(state.shifts));
      localStorage.setItem(STORAGE_KEYS.ACTIVE_SESSION, JSON.stringify(state.activeSession));
      localStorage.setItem(STORAGE_KEYS.TODAY_APPTS, JSON.stringify({
        date: formatDateKey(getTorontoNow()),
        count: state.todayAppts
      }));

      if (channel) {
        channel.postMessage({ type: 'SYNC_STATE', timestamp: Date.now() });
      }
    } catch (e) {
      console.error('Error saving storage in popup', e);
    }
  }

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

  function getTodayWorkedSeconds() {
    const todayKey = formatDateKey(getTorontoNow());
    let totalSecs = 0;
    state.shifts.forEach(s => {
      if (s.date === todayKey) totalSecs += (s.durationSeconds || 0);
    });
    if (state.activeSession) {
      totalSecs += getActiveSessionSeconds();
    }
    return totalSecs;
  }

  function accumulateActiveTime(now) {
    if (!state.activeSession) return;
    const act = state.activeSession.currentActivity || 'off_phone_work';
    const lastSwitch = state.activeSession.lastActivitySwitchTime || state.activeSession.startTime;
    const elapsed = Math.max(0, Math.floor((now - lastSwitch) / 1000));
    if (!state.activeSession.activityTimeMap) state.activeSession.activityTimeMap = {};
    state.activeSession.activityTimeMap[act] = (state.activeSession.activityTimeMap[act] || 0) + elapsed;
    state.activeSession.lastActivitySwitchTime = now;
  }

  function startOrResume() {
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
        }
      };
    } else if (state.activeSession.status === 'PAUSED') {
      const pauseDuration = now - state.activeSession.pauseStartTime;
      state.activeSession.totalPausedMs = (state.activeSession.totalPausedMs || 0) + pauseDuration;
      state.activeSession.pauseStartTime = null;
      state.activeSession.status = 'RUNNING';
      state.activeSession.lastActivitySwitchTime = now;
    }
    saveState();
    updateUI();
  }

  function pause() {
    if (!state.activeSession || state.activeSession.status !== 'RUNNING') return;
    const now = Date.now();
    accumulateActiveTime(now);
    state.activeSession.status = 'PAUSED';
    state.activeSession.pauseStartTime = now;
    saveState();
    updateUI();
  }

  function stop() {
    if (!state.activeSession) return;
    const now = Date.now();
    if (state.activeSession.status === 'RUNNING') {
      accumulateActiveTime(now);
    } else if (state.activeSession.status === 'PAUSED' && state.activeSession.pauseStartTime) {
      const pauseDuration = now - state.activeSession.pauseStartTime;
      state.activeSession.totalPausedMs = (state.activeSession.totalPausedMs || 0) + pauseDuration;
    }

    const grossElapsedMs = now - state.activeSession.startTime;
    const netWorkedSeconds = Math.max(0, Math.floor((grossElapsedMs - (state.activeSession.totalPausedMs || 0)) / 1000));

    if (netWorkedSeconds >= 10) {
      let phoneSeconds = 0;
      let offPhoneSeconds = 0;
      const actMap = state.activeSession.activityTimeMap || {};

      for (const [k, secs] of Object.entries(actMap)) {
        if (k === 'inbound_call' || k === 'outbound_call') phoneSeconds += secs;
        else offPhoneSeconds += secs;
      }
      const sum = phoneSeconds + offPhoneSeconds;
      if (sum < netWorkedSeconds) offPhoneSeconds += (netWorkedSeconds - sum);

      state.shifts.unshift({
        id: 'shift_' + Date.now(),
        date: formatDateKey(state.activeSession.startTime),
        startTime: state.activeSession.startTime,
        endTime: now,
        durationSeconds: netWorkedSeconds,
        phoneSeconds: phoneSeconds,
        offPhoneSeconds: offPhoneSeconds,
        appointmentsBooked: state.todayAppts,
        notes: 'Tracked via Mini Transport Bar',
        activityMap: { ...actMap }
      });
    }

    state.activeSession = null;
    saveState();
    updateUI();
  }

  function switchActivity(actKey) {
    if (!state.activeSession) {
      document.querySelectorAll('.pill-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.act === actKey);
      });
      return;
    }
    const now = Date.now();
    if (state.activeSession.status === 'RUNNING') accumulateActiveTime(now);
    state.activeSession.currentActivity = actKey;
    state.activeSession.lastActivitySwitchTime = now;
    saveState();
    updateUI();
  }

  function updateClock() {
    const clockEl = document.getElementById('toronto-time-clock');
    if (clockEl) {
      clockEl.textContent = getTorontoNow().toLocaleTimeString('en-US', {
        timeZone: 'America/Toronto',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    }
  }

  function updateUI() {
    const cluster = document.getElementById('status-cluster');
    const label = document.getElementById('status-label');
    const btnRec = document.getElementById('btn-mini-rec');
    const btnRecLabel = document.getElementById('btn-rec-label');
    const btnPause = document.getElementById('btn-mini-pause');
    const btnStop = document.getElementById('btn-mini-stop');

    if (!state.activeSession) {
      cluster.className = 'status-cluster';
      label.textContent = 'OFFLINE';
      btnRec.disabled = false;
      btnRecLabel.textContent = 'REC';
      btnPause.disabled = true;
      btnStop.disabled = true;
    } else if (state.activeSession.status === 'RUNNING') {
      cluster.className = 'status-cluster status-working';
      label.textContent = 'REC (ON)';
      btnRec.disabled = true;
      btnPause.disabled = false;
      btnStop.disabled = false;
    } else if (state.activeSession.status === 'PAUSED') {
      cluster.className = 'status-cluster status-paused';
      label.textContent = 'PAUSED';
      btnRec.disabled = false;
      btnRecLabel.textContent = 'RESUME';
      btnPause.disabled = true;
      btnStop.disabled = false;
    }

    // Update digits
    const sessionSecs = getActiveSessionSeconds();
    const todaySecs = getTodayWorkedSeconds();
    document.getElementById('mini-session-digits').textContent = formatStopwatch(sessionSecs);
    document.getElementById('mini-today-digits').textContent = formatHoursMinutes(todaySecs);
    document.getElementById('popup-appt-count').textContent = state.todayAppts;

    // Active pill
    const curAct = state.activeSession?.currentActivity || 'off_phone_work';
    document.querySelectorAll('.pill-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.act === curAct);
    });
  }

  function init() {
    loadState();

    // Auto-start tracking on launch so no 2nd action is needed
    if (!state.activeSession) {
      startOrResume();
    }

    updateClock();
    updateUI();

    // Event listeners
    document.getElementById('btn-mini-rec')?.addEventListener('click', startOrResume);
    document.getElementById('btn-mini-pause')?.addEventListener('click', pause);
    document.getElementById('btn-mini-stop')?.addEventListener('click', stop);

    document.getElementById('popup-activity-group')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.pill-btn');
      if (btn && btn.dataset.act) switchActivity(btn.dataset.act);
    });

    document.getElementById('btn-popup-appt-plus')?.addEventListener('click', () => {
      state.todayAppts++;
      saveState();
      updateUI();
    });

    // Cross-window sync via storage event and channel
    window.addEventListener('storage', () => {
      loadState();
      updateUI();
    });

    if (channel) {
      channel.onmessage = () => {
        loadState();
        updateUI();
      };
    }

    // 1-sec ticker
    ticker = setInterval(() => {
      updateClock();
      if (state.activeSession && state.activeSession.status === 'RUNNING') {
        const sessionSecs = getActiveSessionSeconds();
        const todaySecs = getTodayWorkedSeconds();
        const sessionDigits = document.getElementById('mini-session-digits');
        const todayDigits = document.getElementById('mini-today-digits');
        if (sessionDigits) sessionDigits.textContent = formatStopwatch(sessionSecs);
        if (todayDigits) todayDigits.textContent = formatHoursMinutes(todaySecs);
      }
    }, 1000);
  }

  document.addEventListener('DOMContentLoaded', init);

})();
