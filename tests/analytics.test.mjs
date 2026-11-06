import assert from 'node:assert/strict';
import { DEFAULT_PROJECTS, migrateProjectNamesToEnglish, getRange, matchingProject, normalizeEvents, summarize, dailyTotals, clockFormat } from '../analytics.mjs';

const savedProjects = [
  { ...DEFAULT_PROJECTS[0], name: 'pai \u5f00\u53d1', color: '#123456', keywords: 'custom keyword' },
  { ...DEFAULT_PROJECTS[1], name: '\u6c42\u804c' },
  { ...DEFAULT_PROJECTS[2], name: 'SQL \u5b66\u4e60' },
  { ...DEFAULT_PROJECTS[0], name: 'My custom project' },
  { id: 'custom', name: '\u81ea\u5b9a\u4e49', keywords: 'custom' }
];
const migratedProjects = migrateProjectNamesToEnglish(savedProjects);
assert.deepEqual(migratedProjects.slice(0, 3).map(p => p.name), ['pai Development', 'Job Search', 'SQL Learning']);
assert.equal(migratedProjects[0].id, savedProjects[0].id);
assert.equal(migratedProjects[0].color, '#123456');
assert.equal(migratedProjects[0].keywords, 'custom keyword');
assert.equal(savedProjects[0].name, 'pai \u5f00\u53d1', 'migration must not mutate saved data');
assert.equal(migratedProjects[3], savedProjects[3], 'keep renamed presets');
assert.equal(migratedProjects[4], savedProjects[4], 'keep user-created projects');
assert.deepEqual(migrateProjectNamesToEnglish(migratedProjects), migratedProjects, 'migration is idempotent');

const now = new Date(2026, 10, 6, 10, 0, 0);
const range = getRange('7', '', now);
assert.equal(range.start.getDate(), 31);
assert.equal(range.start.getMonth(), 9);
assert.equal(range.end.getDate(), 6);
assert.equal(matchingProject('Pai - decouple', DEFAULT_PROJECTS), 'pai');
assert.equal(matchingProject('paid service', DEFAULT_PROJECTS), null);
assert.equal(matchingProject('career - resume', DEFAULT_PROJECTS), 'career');
assert.equal(matchingProject('SQL Learning', DEFAULT_PROJECTS), 'sql');
assert.equal(matchingProject('BDB research', DEFAULT_PROJECTS), 'nfl');

function ev(id, title, start, end, extra = {}) {
  return { calendarId: 'primary', id, iCalUID: `${id}@example.com`, summary: title,
    start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() }, ...extra };
}
const a = ev('one', 'pai - coding', new Date(2026,10,5,9), new Date(2026,10,5,11));
const b = ev('two', 'personal groceries', new Date(2026,10,5,12), new Date(2026,10,5,13));
const c = ev('three', 'SQL practice', new Date(2026,10,6,9), new Date(2026,10,6,12));
const allday = { calendarId: 'primary', id: 'all-day', summary: 'pai vacation', start: {date:'2026-11-05'}, end:{date:'2026-11-06'} };
const duplicate = { ...a, calendarId: 'another' };
const declined = ev('declined', 'pai - declined', new Date(2026,10,5,9), new Date(2026,10,5,10),
  { attendees:[{self:true,responseStatus:'declined'}] });
const events = normalizeEvents([a,b,c,allday,duplicate,declined], DEFAULT_PROJECTS, {}, range);
assert.equal(events.length, 3, 'should remove all-day, duplicate, declined');
assert.equal(events.find(e => e.title === 'SQL practice').minutes, 60, 'clip event at now');
const totals = summarize(events, [], DEFAULT_PROJECTS, range);
assert.equal(totals.calendarMinutes, 180);
assert.equal(totals.unassignedMinutes, 60);
assert.equal(totals.assignedEvents, 2);

const override = normalizeEvents([a], DEFAULT_PROJECTS, {'primary::one':null}, range);
assert.equal(override[0].projectId, null);
const full = summarize(events, [{start:new Date(2026,10,5,8),end:new Date(2026,10,5,10),projectId:'pai'}], DEFAULT_PROJECTS, range);
assert.equal(full.timerMinutes, 120);
assert.equal(full.calendarMinutes, 180);
assert.equal(dailyTotals(events, range).at(-1).minutes, 60);
assert.equal(clockFormat(3_661_000), '01:01:01');
assert.throws(() => getRange('custom', '2026-11-31', now));
assert.throws(() => getRange('custom', '2026-12-01', now));
console.log('PASS: analytics logic, classification, calendar clipping, deduplication, manual overrides, timer totals.');
