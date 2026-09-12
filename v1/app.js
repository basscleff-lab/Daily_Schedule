// Sabrina's Work Hub & Time Tracker - Core Engine
// Client: Optima Windows and Doors

(function() {
  'use strict';

  // --- Constants & Defaults ---
  const STORAGE_KEYS = {
    SHIFTS: 'sabrina_shifts_v1',
    ACTIVE_SESSION: 'sabrina_active_session_v1',
    SETTINGS: 'sabrina_settings_v1',
    TODAY_APPTS: 'sabrina_today_appts_v1',
    COMPACT_MODE: 'sabrina_compact_mode_v1'
  };

  const ACTIVITY_NAMES = {
    inbound_call: { name: 'Inbound Call', isPhone: true, icon: '📞' },
    outbound_call: { name: 'Outbound Call', isPhone: true, icon: '📱' },
    text_sms: { name: 'Text / SMS Follow-up', isPhone: false, icon: '💬' },
    email_in: { name: 'Email Inbound', isPhone: false, icon: '📥' },
    email_out: { name: 'Email Outbound', isPhone: false, icon: '📤' },
    off_phone_work: { name: 'Off-Phone / Booking Admin', isPhone: false, icon: '📋' }
  };

  // --- Application State ---
  let state = {
    settings: {
      contractorName: 'Sabrina',
      clientName: 'Optima Windows and Doors',
      hourlyRate: 25.00
    },
    shifts: [],
    activeSession: null, // { startTime, status: 'RUNNING'|'PAUSED', pauseStartTime, totalPausedMs, currentActivity, activityTimeMap: {} }
    todayAppts: 0,
    isCompact: false
  };

  let timerInterval = null;

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

  // Save State to LocalStorage
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
    } catch (e) {
      console.error('Error saving state to localStorage', e);
    }
  }

  // Load State from LocalStorage
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

    } catch (e) {
      console.warn('Error loading localStorage, using defaults', e);
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
        }
      };
    } else if (state.activeSession.status === 'PAUSED') {
      // Resume from paused
      const pauseDuration = now - state.activeSession.pauseStartTime;
      state.activeSession.totalPausedMs = (state.activeSession.totalPausedMs || 0) + pauseDuration;
      state.activeSession.pauseStartTime = null;
      state.activeSession.status = 'RUNNING';
      state.activeSession.lastActivitySwitchTime = now;
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

  // Calculate today's phone vs off-phone seconds
  function getTodayBreakdown() {
    const todayKey = formatDateKey(getTorontoNow());
    let phoneSecs = 0;
    let offPhoneSecs = 0;

    state.shifts.forEach(shift => {
      if (shift.date === todayKey) {
        phoneSecs += shift.phoneSeconds || 0;
        offPhoneSecs += shift.offPhoneSeconds || 0;
      }
    });

    if (state.activeSession) {
      const actMap = state.activeSession.activityTimeMap || {};
      for (const [k, v] of Object.entries(actMap)) {
        if (ACTIVITY_NAMES[k]?.isPhone) phoneSecs += v;
        else offPhoneSecs += v;
      }
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

    // 9. Compact mode check
    document.body.classList.toggle('compact-mode', state.isCompact);
    const compactLabel = document.getElementById('compact-toggle-label');
    if (compactLabel) {
      compactLabel.textContent = state.isCompact ? 'Expand Full View' : 'Compact Toolbar Mode';
    }
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
            <button class="btn-danger-outline" onclick="window.SabrinaApp.deleteShift('${shift.id}')" title="Delete entry">🗑️</button>
          </div>
        </div>
      `;
    });

    listEl.innerHTML = html;
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
            <button class="btn-danger-outline" onclick="window.SabrinaApp.deleteDateShifts('${dateKey}')">Delete Day</button>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
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
          totalSeconds: 0,
          phoneSecs: 0,
          offPhoneSecs: 0,
          appts: 0
        };
      }
      dateGroups[shift.date].shifts.push(shift);
      dateGroups[shift.date].totalSeconds += (shift.durationSeconds || 0);
      dateGroups[shift.date].phoneSecs += (shift.phoneSeconds || 0);
      dateGroups[shift.date].offPhoneSecs += (shift.offPhoneSeconds || 0);
      dateGroups[shift.date].appts = Math.max(dateGroups[shift.date].appts, shift.appointmentsBooked || 0);
    });

    const dates = Object.keys(dateGroups).sort();

    if (dates.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: #94a3b8;">No billable shifts recorded in this billing date range.</td></tr>`;
      document.getElementById('inv-total-formatted').textContent = '0h 00m';
      document.getElementById('inv-total-decimal').textContent = '0.00 hrs';
      document.getElementById('inv-appts-booked').textContent = '0';
      document.getElementById('inv-grand-total').textContent = '$0.00 CAD';
      return;
    }

    let overallSeconds = 0;
    let overallAppts = 0;
    let html = '';

    dates.forEach(dKey => {
      const g = dateGroups[dKey];
      overallSeconds += g.totalSeconds;
      overallAppts += g.appts;

      const decimalHours = g.totalSeconds / 3600;
      const lineTotal = decimalHours * rate;
      const shiftTimesList = g.shifts.map(s => `${format12HourTime(s.startTime)}–${format12HourTime(s.endTime)}`).join(', ');

      html += `
        <tr>
          <td><strong>${formatFriendlyDate(dKey)}</strong></td>
          <td>${shiftTimesList}</td>
          <td>${Math.round(g.phoneSecs / 60)}m</td>
          <td>${Math.round(g.offPhoneSecs / 60)}m</td>
          <td><strong>${formatHoursMinutes(g.totalSeconds)}</strong> (${decimalHours.toFixed(2)}h)</td>
          <td style="text-align: right;">$${rate.toFixed(2)}</td>
          <td style="text-align: right; font-weight: 700;">$${lineTotal.toFixed(2)}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html;

    const totalDecimalHours = overallSeconds / 3600;
    const grandTotal = totalDecimalHours * rate;

    document.getElementById('inv-total-formatted').textContent = formatHoursMinutes(overallSeconds);
    document.getElementById('inv-total-decimal').textContent = `${totalDecimalHours.toFixed(2)} hrs`;
    document.getElementById('inv-appts-booked').textContent = overallAppts.toString();
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

    state.shifts = sampleShifts;
    persistState();
    updateUI();
    if (!silent) {
      alert('✨ Sample week loaded! Check the Timesheet and Invoice tabs.');
    }
  }

  // --- CSV Export ---
  function exportCSV() {
    if (state.shifts.length === 0) {
      alert('No shifts to export yet.');
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
  }

  // --- Backup & Restore ---
  function backupJSON() {
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      shifts: state.shifts
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Sabrina_Tracker_Backup_${formatDateKey(getTorontoNow())}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function restoreJSON(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = JSON.parse(e.target.result);
        if (data.shifts && Array.isArray(data.shifts)) {
          state.shifts = data.shifts;
          if (data.settings) state.settings = { ...state.settings, ...data.settings };
          persistState();
          updateUI();
          alert('✅ Backup successfully restored!');
        } else {
          alert('Invalid backup file format.');
        }
      } catch (err) {
        alert('Could not parse backup file: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  // --- Event Bindings ---
  function initEventHandlers() {
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

    // Appointment Stepper
    document.getElementById('btn-appt-plus')?.addEventListener('click', () => {
      state.todayAppts++;
      persistState();
      updateUI();
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

    document.getElementById('btn-print-invoice')?.addEventListener('click', () => {
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
        alert('Please paste some Telus call log text first.');
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
        alert(`✅ Added ${Math.round(totalSecs / 60)} minutes of Telus phone time to current active session!`);
      } else if (todayShifts.length > 0) {
        todayShifts[0].phoneSeconds = (todayShifts[0].phoneSeconds || 0) + totalSecs;
        alert(`✅ Added ${Math.round(totalSecs / 60)} minutes of Telus phone time to today's shift record!`);
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
          notes: `Telus Phone Call Logs (${parsedTelusCalls.length} calls)`
        });
        alert(`✅ Created a shift entry with ${Math.round(totalSecs / 60)} minutes from Telus call logs!`);
      }

      persistState();
      updateUI();
    });

    // Settings
    document.getElementById('btn-save-settings')?.addEventListener('click', () => {
      state.settings.contractorName = document.getElementById('setting-name')?.value || 'Sabrina';
      state.settings.clientName = document.getElementById('setting-client')?.value || 'Optima Windows and Doors';
      state.settings.hourlyRate = parseFloat(document.getElementById('setting-rate')?.value) || 25.00;
      persistState();
      updateUI();
      alert('Settings saved!');
    });

    document.getElementById('btn-backup-json')?.addEventListener('click', backupJSON);

    document.getElementById('input-restore-json')?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        restoreJSON(e.target.files[0]);
      }
    });

    document.getElementById('btn-load-sample-shifts')?.addEventListener('click', loadSampleData);

    // Manual Shift Modal Handlers
    const manualModal = document.getElementById('manual-shift-modal');
    document.getElementById('btn-open-manual-modal')?.addEventListener('click', () => {
      document.getElementById('manual-date').value = formatDateKey(getTorontoNow());
      manualModal.style.display = 'flex';
    });

    document.getElementById('btn-cancel-manual')?.addEventListener('click', () => {
      manualModal.style.display = 'none';
    });

    document.getElementById('btn-save-manual')?.addEventListener('click', () => {
      const dateVal = document.getElementById('manual-date').value;
      const startVal = document.getElementById('manual-start').value;
      const endVal = document.getElementById('manual-end').value;
      const phoneMins = parseInt(document.getElementById('manual-phone-mins').value, 10) || 0;
      const appts = parseInt(document.getElementById('manual-appts').value, 10) || 0;
      const notes = document.getElementById('manual-notes').value || 'Manual entry';

      if (!dateVal || !startVal || !endVal) {
        alert('Please fill out date, start time, and end time.');
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

      state.shifts.unshift({
        id: 'shift_manual_' + Date.now(),
        date: dateVal,
        startTime: startDateObj.getTime(),
        endTime: endDateObj.getTime(),
        durationSeconds: durationSec,
        phoneSeconds: phoneSec,
        offPhoneSeconds: offPhoneSec,
        appointmentsBooked: appts,
        notes: notes
      });

      manualModal.style.display = 'none';
      persistState();
      updateUI();
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
  }

  // --- Exposed Global Helper for Inline HTML Handlers ---
  window.SabrinaApp = {
    deleteShift: function(shiftId) {
      if (confirm('Delete this shift segment?')) {
        state.shifts = state.shifts.filter(s => s.id !== shiftId);
        persistState();
        updateUI();
      }
    },
    deleteDateShifts: function(dateKey) {
      if (confirm(`Delete all shifts for ${formatFriendlyDate(dateKey)}?`)) {
        state.shifts = state.shifts.filter(s => s.date !== dateKey);
        persistState();
        updateUI();
      }
    }
  };

  // --- Initialization ---
  function init() {
    loadPersistedState();

    // Check URL parameters for previewing / deep-linking
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('sample') === '1') {
      loadSampleData(true);
    }
    if (urlParams.get('compact') === '1') {
      state.isCompact = true;
    }

    initEventHandlers();

    const targetTab = urlParams.get('tab');
    if (targetTab) {
      const tabBtn = document.querySelector(`.tab-btn[data-tab="tab-${targetTab}"]`);
      if (tabBtn) tabBtn.click();
    }

    updateClock();
    updateUI();

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
  }

  document.addEventListener('DOMContentLoaded', init);

})();
