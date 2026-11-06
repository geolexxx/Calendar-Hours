export const DEFAULT_PROJECTS = [
  { id: 'pai', name: 'pai Development', color: '#7665ed', keywords: 'pai, camera agent, decouple' },
  { id: 'career', name: 'Job Search', color: '#ee9561', keywords: 'career, job search, interview, recruiter, resume, screen call, application' },
  { id: 'sql', name: 'SQL Learning', color: '#36a89a', keywords: 'sql, datacamp, database, duckdb' },
  { id: 'nfl', name: 'NFL / BDB', color: '#6d9eea', keywords: 'nfl, bdb, big data bowl, quarterback' }
];

export function migrateProjectNamesToEnglish(projects) {
  const legacyNames = {
    pai: 'pai \u5f00\u53d1',
    career: '\u6c42\u804c',
    sql: 'SQL \u5b66\u4e60'
  };
  return projects.map(project => {
    const preset = DEFAULT_PROJECTS.find(p => p.id === project.id);
    // Only rename unchanged presets; keep custom names, colors, keywords, and IDs.
    return preset && project.name === legacyNames[project.id]
      ? { ...project, name: preset.name } : project;
  });
}

export function getRange(kind, custom, now = new Date()) {
  const end = new Date(now);
  let start;
  if (kind === 'custom') {
    const match = /^\d{4}-\d{2}-\d{2}$/.test(custom || '');
    if (!match) throw new Error('Select a custom start date first.');
    const [year, month, day] = custom.split('-').map(Number);
    start = new Date(year, month - 1, day);
    if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) {
      throw new Error('Invalid start date.');
    }
  } else {
    const days = Number(kind);
    if (![7, 30, 90, 365].includes(days)) throw new Error('Invalid date range.');
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1);
  }
  if (start >= end) throw new Error('The start date must be earlier than the current time.');
  return { start, end };
}

export function matchingProject(title, projects) {
  const normalized = String(title || '').toLowerCase();
  for (const project of projects) {
    const terms = String(project.keywords || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    for (const term of terms) {
      // Avoid "pai" matching unrelated words like "paid" or "repair".
      const asciiWord = /^[a-z0-9]+$/.test(term);
      if (asciiWord) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(normalized)) return project.id;
      } else if (normalized.includes(term)) return project.id;
    }
  }
  return null;
}

export function normalizeEvents(events, projects, overrides, range) {
  const results = [];
  const seen = new Set();
  for (const event of events) {
    if (event.status === 'cancelled' || !event.start?.dateTime || !event.end?.dateTime) continue;
    if (event.eventType === 'workingLocation' || event.eventType === 'birthday' || event.eventType === 'outOfOffice') continue;
    if (event.attendees?.some(a => a.self && a.responseStatus === 'declined')) continue;
    const from = new Date(event.start.dateTime).getTime();
    const to = new Date(event.end.dateTime).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
    const start = Math.max(from, range.start.getTime());
    const end = Math.min(to, range.end.getTime());
    if (end <= start) continue;
    const key = `${event.calendarId}::${event.id}`;
    const dedupe = `${event.iCalUID || key}::${event.originalStartTime?.dateTime || event.start.dateTime}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const title = event.summary || '(Untitled)';
    const projectId = Object.prototype.hasOwnProperty.call(overrides, key)
      ? overrides[key] : matchingProject(title, projects);
    results.push({ key, title, start, end, minutes: (end - start) / 60000,
      projectId, originalStart: from, calendarId: event.calendarId, link: event.htmlLink || '' });
  }
  return results.sort((a, b) => b.start - a.start);
}

export function summarize(events, sessions, projects, range) {
  const totals = new Map(projects.map(p => [p.id, { id: p.id, name: p.name, color: p.color, minutes: 0, entries: 0 }]));
  let unassignedMinutes = 0, assignedEvents = 0;
  for (const event of events) {
    const project = totals.get(event.projectId);
    if (!project) { unassignedMinutes += event.minutes; continue; }
    project.minutes += event.minutes;
    project.entries += 1;
    assignedEvents++;
  }
  const timerTotals = new Map(projects.map(p => [p.id, 0]));
  for (const session of sessions) {
    if (!timerTotals.has(session.projectId)) continue;
    const min = Math.max(new Date(session.start).getTime(), range.start.getTime());
    const max = Math.min(new Date(session.end).getTime(), range.end.getTime());
    if (max > min) timerTotals.set(session.projectId, timerTotals.get(session.projectId) + (max - min) / 60000);
  }
  const rows = [...totals.values()].sort((a, b) => b.minutes - a.minutes);
  return { rows, calendarMinutes: rows.reduce((acc, r) => acc + r.minutes, 0), unassignedMinutes,
    assignedEvents, totalEvents: events.length, timerMinutes: [...timerTotals.values()].reduce((a, b) => a + b, 0), timerTotals };
}

export function dailyTotals(events, range, maxDays = 14) {
  const today = new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate());
  const earliest = Math.max(range.start.getTime(), new Date(today.getFullYear(), today.getMonth(), today.getDate() - maxDays + 1).getTime());
  const days = [];
  for (let cursor = new Date(earliest); cursor.getTime() <= today.getTime(); cursor.setDate(cursor.getDate() + 1)) {
    const begin = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()).getTime();
    const finish = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1).getTime();
    const minutes = events.filter(e => e.projectId).reduce((sum, e) => {
      const overlap = Math.max(0, Math.min(e.end, finish) - Math.max(e.start, begin));
      return sum + overlap / 60000;
    }, 0);
    days.push({ date: new Date(begin), minutes });
  }
  return days;
}

export const displayHours = minutes => `${(minutes / 60).toFixed(1)}h`;
export const clockFormat = ms => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map(n => String(n).padStart(2, '0')).join(':');
};
