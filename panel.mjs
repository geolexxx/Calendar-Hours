import { DEFAULT_PROJECTS, migrateProjectNamesToEnglish, getRange, matchingProject, normalizeEvents, summarize, dailyTotals, displayHours, clockFormat } from './analytics.mjs';

const $ = id => document.getElementById(id);
const clone = value => JSON.parse(JSON.stringify(value));
const newId = () => globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const state = {
  projects: clone(DEFAULT_PROJECTS),
  overrides: {},
  sessions: [],
  timer: null,
  calendars: [],
  selectedCalendarIds: null,
  eventsRaw: [],
  currentEvents: [],
  rangeKind: '30',
  customStart: '',
  connected: false,
  demo: false,
  busy: false,
  truncated: false,
  eventLimit: 35,
  activeTab: 'overview'
};

const htmlEscape = val => String(val ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);
const dateLocalISO = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
const dateLabel = value => new Date(value).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function notify(message, error = false) {
  const el = $('notice');
  el.hidden = !message;
  el.textContent = message || '';
  el.classList.toggle('error', error);
}
function safeRange() {
  try { return getRange(state.rangeKind, state.customStart); }
  catch (err) { notify(err.message, true); return null; }
}
async function save(patch) {
  Object.assign(state, patch);
  const storage = Object.fromEntries(Object.entries(patch).filter(([name]) => !['eventsRaw', 'calendars', 'currentEvents', 'demo', 'busy', 'truncated'].includes(name)));
  if (Object.keys(storage).length) await chrome.storage.local.set(storage);
}
async function message(type, payload) {
  const response = await chrome.runtime.sendMessage({ type, payload });
  if (!response?.ok) throw new Error(response?.error || 'Unable to connect to the extension background service.');
  return response.data;
}
function setBusy(busy) {
  state.busy = busy;
  for (const id of ['connect', 'refresh']) $(id).disabled = busy;
  if (busy) notify('Reading calendars, please wait…');
  else if ($('notice').textContent === 'Reading calendars, please wait…') notify('');
}
function makeDemoEvents() {
  const records = [];
  const specs = [
    ['pai - coding', 2.5, 0], ['pai - decouple', 1.5, 1], ['SQL practice', 1.2, 1],
    ['career - applications', 2, 2], ['screen call', 0.75, 3], ['BDB research', 1.8, 4],
    ['pai - camera agent', 3, 5], ['career - resume', 1.5, 6], ['SQL learning', 1.3, 8],
    ['pai - debugging', 2.2, 10], ['reading', 0.6, 3]
  ];
  for (const [i, [title, hours, daysAgo]] of specs.entries()) {
    const start = new Date();
    start.setDate(start.getDate() - daysAgo);
    start.setHours(10 + (i % 4) * 2, 0, 0, 0);
    const end = new Date(start.getTime() + hours * 3600_000);
    // Exclude future demo time on the current day.
    if (+start > Date.now()) start.setDate(start.getDate() - 1);
    if (+end > Date.now()) end.setDate(end.getDate() - 1);
    records.push({ id: `demo-${i}`, calendarId: 'demo', summary: title,
      start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } });
  }
  return records;
}

async function connect() {
  setBusy(true);
  try {
    const result = await message('connect');
    state.demo = false;
    state.calendars = result.items.filter(c => c.accessRole !== 'freeBusyReader');
    if (!state.calendars.length) throw new Error('No readable calendars were found for this Google account.');
    if (state.selectedCalendarIds === null) {
      state.selectedCalendarIds = state.calendars.filter(c => c.primary).map(c => c.id);
      if (!state.selectedCalendarIds.length) state.selectedCalendarIds = [state.calendars[0].id];
    }
    await save({ connected: true, selectedCalendarIds: state.selectedCalendarIds });
    showConnected();
    await fetchEvents();
  } catch (error) {
    notify(`Connection failed: ${error.message} See the README to set up your OAuth Client ID if needed.`, true);
    showDisconnected();
  } finally { setBusy(false); }
}

async function loadExistingConnection() {
  if (!state.connected) { showDisconnected(); return; }
  setBusy(true);
  try {
    const result = await message('calendarList');
    state.calendars = result.items.filter(c => c.accessRole !== 'freeBusyReader');
    if (!state.calendars.length) throw new Error('No readable calendars were found for this account.');
    state.selectedCalendarIds ??= state.calendars.filter(c => c.primary).map(c => c.id);
    showConnected();
    await fetchEvents();
  } catch (err) {
    showDisconnected();
    notify(`Unable to restore authorization: ${err.message} Click “Connect Google Calendar” to try again.`, true);
  } finally { setBusy(false); }
}

function showDisconnected() {
  $('connect-view').hidden = false;
  $('main-view').hidden = true;
}
function showConnected() {
  $('connect-view').hidden = true;
  $('main-view').hidden = false;
  $('leave-demo').hidden = !state.demo;
  $('disconnect').hidden = state.demo;
  render();
}

async function fetchEvents() {
  const range = safeRange();
  if (!range) return;
  if (state.demo) { state.eventsRaw = makeDemoEvents(); state.truncated = false; render(); return; }
  if (!state.connected) return;
  if (!state.selectedCalendarIds?.length) {
    state.eventsRaw = []; state.truncated = false;
    notify('Select at least one calendar in Settings.');
    render(); return;
  }
  setBusy(true);
  try {
    const result = await message('events', {
      calendarIds: state.selectedCalendarIds,
      startISO: range.start.toISOString(),
      endISO: range.end.toISOString()
    });
    state.eventsRaw = result.items;
    state.truncated = result.truncated;
    if (state.truncated) notify('Some calendars exceeded the 20,000-event limit. Try a shorter date range.');
    else notify('');
    state.eventLimit = 35;
    render();
  } catch (error) {
    notify(`Event sync failed: ${error.message}`, true);
  } finally { setBusy(false); }
}

function render() {
  if ($('main-view').hidden) return;
  const range = safeRange();
  if (!range) return;
  $('range').value = state.rangeKind;
  $('custom-start').hidden = state.rangeKind !== 'custom';
  $('custom-start').value = state.customStart;
  state.currentEvents = normalizeEvents(state.eventsRaw, state.projects, state.overrides, range);
  const summary = summarize(state.currentEvents, state.sessions, state.projects, range);
  $('total-hours').innerHTML = `${(summary.calendarMinutes / 60).toFixed(1)}<span>hours</span>`;
  const rate = summary.totalEvents ? (summary.assignedEvents / summary.totalEvents * 100).toFixed(0) : '0';
  $('summary-meta').textContent = `${summary.assignedEvents}/${summary.totalEvents} events assigned · ${rate}% coverage` + (state.demo ? ' · Demo data' : '');
  $('timer-total').textContent = displayHours(summary.timerMinutes);
  $('unassigned-total').textContent = displayHours(summary.unassignedMinutes);
  $('project-count').textContent = `${state.projects.length} ${state.projects.length === 1 ? 'project' : 'projects'}`;
  renderProjectChart(summary);
  renderDayChart(range);
  renderEventList();
  renderTimer();
  renderCalendars();
  renderProjectEditor();
}

function renderProjectChart(summary) {
  const max = Math.max(1, ...summary.rows.map(row => row.minutes));
  $('project-chart').innerHTML = summary.rows.length ? summary.rows.map(row => `
    <div class="project-line"><div class="project-label"><span class="project-name">
      <span class="dot" style="background:${htmlEscape(row.color)}"></span>${htmlEscape(row.name)}</span>
      <strong>${displayHours(row.minutes)}</strong></div>
      <div class="bar-bg"><div class="bar-fill" style="width:${Math.max(0, row.minutes / max * 100).toFixed(2)}%;background:${htmlEscape(row.color)}"></div></div>
    </div>`).join('') : '<div class="no-data">Add a project to see your stats</div>';
}
function renderDayChart(range) {
  const days = dailyTotals(state.currentEvents, range);
  const max = Math.max(30, ...days.map(day => day.minutes));
  $('day-chart').innerHTML = days.map(day => {
    const height = Math.max(2, day.minutes / max * 112);
    return `<div class="day-group" title="${htmlEscape(dateLocalISO(day.date))}: ${displayHours(day.minutes)}">
      <div class="day-col" style="height:${height.toFixed(2)}px"></div>
      <div class="day-caption">${day.date.getMonth() + 1}/${day.date.getDate()}</div>
    </div>`;
  }).join('');
}
function optionList(current) {
  return `<option value="__auto__" ${current === '__auto__' ? 'selected' : ''}>Auto-detect</option>
    <option value="__none__" ${current === '__none__' ? 'selected' : ''}>Exclude from projects</option>` +
    state.projects.map(p => `<option value="${htmlEscape(p.id)}" ${current === p.id ? 'selected' : ''}>${htmlEscape(p.name)}</option>`).join('');
}
function renderEventList() {
  const filter = $('event-filter').value;
  const events = state.currentEvents.filter(event => filter === 'all' || (filter === 'assigned' ? !!event.projectId : !event.projectId));
  $('event-counter').textContent = `${events.length} ${events.length === 1 ? 'event' : 'events'}`;
  $('event-list').innerHTML = events.length ? events.slice(0, state.eventLimit).map(event => {
    const override = Object.prototype.hasOwnProperty.call(state.overrides, event.key)
      ? (state.overrides[event.key] ?? '__none__') : '__auto__';
    const autoProject = matchingProject(event.title, state.projects);
    const name = state.projects.find(p => p.id === event.projectId)?.name || 'Unassigned';
    return `<article class="event">
      <div class="event-top"><div class="event-title">${htmlEscape(event.title)}</div>
      <div class="event-duration">${displayHours(event.minutes)}</div></div>
      <div class="event-meta">${htmlEscape(dateLabel(event.start))} · Project: ${htmlEscape(name)}${override === '__auto__' && autoProject ? ' (auto)' : ''}</div>
      <select class="select event-override" data-key="${htmlEscape(event.key)}" aria-label="Change event project">${optionList(override)}</select>
    </article>`;
  }).join('') + (events.length > state.eventLimit ? `<button type="button" class="more-btn" id="load-more">Show more (${events.length - state.eventLimit} remaining)</button>` : '')
    : '<div class="no-data">No events match this filter.<br/>You can adjust keywords in Settings.</div>';
  document.querySelectorAll('.event-override').forEach(node => node.addEventListener('change', async () => {
    const next = { ...state.overrides };
    if (node.value === '__auto__') delete next[node.dataset.key];
    else next[node.dataset.key] = node.value === '__none__' ? null : node.value;
    await save({ overrides: next });
    render();
  }));
  $('load-more')?.addEventListener('click', () => { state.eventLimit += 35; renderEventList(); });
}

function renderTimer() {
  const selected = $('timer-project').value || state.projects[0]?.id || '';
  $('timer-project').innerHTML = state.projects.map(p => `<option value="${htmlEscape(p.id)}">${htmlEscape(p.name)}</option>`).join('');
  $('timer-project').value = state.timer?.projectId || selected;
  $('timer-project').disabled = !!state.timer;
  $('start-timer').hidden = !!state.timer;
  $('stop-timer').hidden = !state.timer;
  $('start-timer').disabled = !state.projects.length;
  updateStopwatch();
  const recent = [...state.sessions].sort((a, b) => new Date(b.start) - new Date(a.start)).slice(0, 50);
  $('sessions-list').innerHTML = recent.length ? recent.map(session => {
    const p = state.projects.find(p => p.id === session.projectId);
    return `<div class="session"><div><div class="session-title">${htmlEscape(p?.name || 'Deleted project')}</div>
      <div class="session-note">${htmlEscape(dateLabel(session.start))}</div></div>
      <span class="session-duration">${displayHours((new Date(session.end) - new Date(session.start)) / 60000)}</span></div>`;
  }).join('') : '<div class="no-data">No timer sessions yet. Start a timer to track your work.</div>';
}
function updateStopwatch() {
  $('stopwatch').textContent = state.timer ? clockFormat(Date.now() - new Date(state.timer.start).getTime()) : '00:00:00';
}

function renderCalendars() {
  if (state.demo) {
    $('calendar-options').innerHTML = '<div class="no-data">Demo mode. No real calendar is connected.</div>';
    return;
  }
  $('calendar-options').innerHTML = state.calendars.length ? state.calendars.map(c => `
    <label class="calendar-row"><input type="checkbox" data-calendar="${htmlEscape(c.id)}" ${state.selectedCalendarIds?.includes(c.id) ? 'checked' : ''}/>
      <span>${htmlEscape(c.summary || c.id)} ${c.primary ? '<span class="muted">(primary)</span>' : ''}</span></label>`).join('')
    : '<div class="no-data">No readable calendars</div>';
  document.querySelectorAll('[data-calendar]').forEach(input => input.addEventListener('change', async () => {
    const selectedCalendarIds = [...document.querySelectorAll('[data-calendar]:checked')].map(node => node.dataset.calendar);
    if (selectedCalendarIds.length > 15) {
      input.checked = false;
      notify('You can select up to 15 calendars.', true); return;
    }
    await save({ selectedCalendarIds });
    await fetchEvents();
  }));
}
function renderProjectEditor() {
  $('project-editor').innerHTML = state.projects.map(p => `
    <div class="project-edit" data-project="${htmlEscape(p.id)}">
      <div class="project-edit-top"><input type="color" class="project-color" value="${htmlEscape(p.color)}" title="Project color"/>
        <input class="text-input project-title" type="text" maxlength="50" value="${htmlEscape(p.name)}" aria-label="Project name" />
        <button class="remove-project" type="button" title="Delete project" aria-label="Delete project">×</button></div>
      <input class="text-input project-keywords" type="text" maxlength="1000" value="${htmlEscape(p.keywords || '')}" placeholder="Keywords, separated by commas" aria-label="Matching keywords" />
    </div>`).join('');
  document.querySelectorAll('[data-project]').forEach(card => {
    const id = card.dataset.project;
    const update = async () => {
      const projects = state.projects.map(p => p.id === id ? {
        ...p, color: card.querySelector('.project-color').value,
        name: card.querySelector('.project-title').value.trim() || p.name,
        keywords: card.querySelector('.project-keywords').value
      } : p);
      await save({ projects }); render();
    };
    card.querySelectorAll('input').forEach(node => node.addEventListener('change', update));
    card.querySelector('.remove-project').addEventListener('click', async () => {
      if (state.timer?.projectId === id) { notify('Stop the timer for this project before deleting it.', true); return; }
      if (!confirm('Delete this project? Existing events will be kept, but will no longer be assigned to this project automatically.')) return;
      await save({ projects: state.projects.filter(p => p.id !== id) }); render();
    });
  });
}

async function stopTimer() {
  if (!state.timer) return;
  const stop = new Date();
  const start = new Date(state.timer.start);
  const sessions = [...state.sessions];
  if (+stop > +start + 1000) sessions.push({ id: newId(), projectId: state.timer.projectId,
    start: start.toISOString(), end: stop.toISOString() });
  await save({ timer: null, sessions });
  render();
}
function csvField(value) {
  let str = String(value ?? '');
  // Protect spreadsheet clients against formula injection from calendar event titles.
  if (/^[\s]*[=+@\-\t\r]/.test(str)) str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
}
function exportCSV() {
  const rows = [['Source', 'Project', 'Title', 'Start time', 'End time', 'Hours']];
  for (const event of state.currentEvents) rows.push(['Google Calendar', state.projects.find(p => p.id === event.projectId)?.name || 'Unassigned',
    event.title, new Date(event.start).toLocaleString('en-US'), new Date(event.end).toLocaleString('en-US'), (event.minutes / 60).toFixed(3)]);
  const range = safeRange();
  if (!range) return;
  for (const session of state.sessions) {
    const from = Math.max(new Date(session.start).getTime(), range.start.getTime());
    const to = Math.min(new Date(session.end).getTime(), range.end.getTime());
    if (to <= from) continue;
    rows.push(['Timer', state.projects.find(p => p.id === session.projectId)?.name || 'Deleted project', 'Actual work',
      new Date(from).toLocaleString('en-US'), new Date(to).toLocaleString('en-US'), ((to - from) / 3600000).toFixed(3)]);
  }
  const body = '\ufeff' + rows.map(row => row.map(csvField).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `calendar-hours-${dateLocalISO(new Date())}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function bindEvents() {
  $('connect').addEventListener('click', connect);
  $('demo').addEventListener('click', async () => {
    state.demo = true;
    state.eventsRaw = makeDemoEvents();
    state.calendars = [];
    showConnected();
    render();
  });
  $('leave-demo').addEventListener('click', () => { state.demo = false; showDisconnected(); notify(''); });
  $('refresh').addEventListener('click', () => state.demo ? fetchEvents() : state.connected ? fetchEvents() : connect());
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
    state.activeTab = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === btn));
    for (const name of ['overview', 'events', 'timer', 'settings']) $(`${name}-page`).hidden = name !== state.activeTab;
  }));
  $('range').addEventListener('change', async event => {
    if (event.target.value === 'custom') $('custom-start').hidden = false;
    await save({ rangeKind: event.target.value });
    await fetchEvents();
  });
  $('custom-start').addEventListener('change', async event => {
    await save({ customStart: event.target.value });
    await fetchEvents();
  });
  $('event-filter').addEventListener('change', () => { state.eventLimit = 35; renderEventList(); });
  $('start-timer').addEventListener('click', async () => {
    const projectId = $('timer-project').value;
    if (!projectId) { notify('Add a project first.', true); return; }
    await save({ timer: { start: new Date().toISOString(), projectId } });
    render();
  });
  $('stop-timer').addEventListener('click', stopTimer);
  $('clear-sessions').addEventListener('click', async () => {
    if (!confirm('Permanently delete all timer sessions stored on this device? This cannot be undone.')) return;
    await save({ sessions: [] }); render();
  });
  $('add-project').addEventListener('click', async () => {
    await save({ projects: [...state.projects, {
      id: newId(), name: 'New project', color: '#a18ad8', keywords: ''
    }] });
    render();
  });
  $('export-csv').addEventListener('click', exportCSV);
  $('disconnect').addEventListener('click', async () => {
    if (!confirm('Disconnect? Your local projects and timer sessions will be kept.')) return;
    await save({ connected: false });
    state.calendars = []; state.eventsRaw = [];
    showDisconnected(); notify('Disconnected. Chrome may still cache your Google authorization. To revoke access completely, remove the extension in your Google account’s third-party access settings.');
  });
  setInterval(updateStopwatch, 1000);
}

async function init() {
  bindEvents();
  const values = await chrome.storage.local.get(['projects', 'overrides', 'sessions', 'timer', 'connected', 'rangeKind', 'customStart', 'selectedCalendarIds']);
  state.projects = Array.isArray(values.projects) ? migrateProjectNamesToEnglish(values.projects) : clone(DEFAULT_PROJECTS);
  if (Array.isArray(values.projects) && state.projects.some((project, index) => project !== values.projects[index])) {
    await save({ projects: state.projects });
  }
  state.overrides = values.overrides && typeof values.overrides === 'object' ? values.overrides : {};
  state.sessions = Array.isArray(values.sessions) ? values.sessions : [];
  state.timer = values.timer || null;
  state.connected = !!values.connected;
  state.rangeKind = values.rangeKind || '30';
  const fallbackStart = new Date(); fallbackStart.setMonth(fallbackStart.getMonth() - 1);
  state.customStart = values.customStart || dateLocalISO(fallbackStart);
  state.selectedCalendarIds = Array.isArray(values.selectedCalendarIds) ? values.selectedCalendarIds : null;
  $('range').value = state.rangeKind;
  $('custom-start').value = state.customStart;
  await loadExistingConnection();
}

init().catch(error => notify(`Initialization failed: ${error.message}`, true));
