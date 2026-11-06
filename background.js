'use strict';

// Native Chrome side panel: click the extension icon while Google Calendar is open.
function enableSidePanel() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
}
chrome.runtime.onInstalled.addListener(enableSidePanel);
chrome.runtime.onStartup.addListener(enableSidePanel);
enableSidePanel();

async function getToken(interactive = false) {
  const response = await chrome.identity.getAuthToken({ interactive });
  const token = typeof response === 'string' ? response : response?.token;
  if (!token) throw new Error('No Google authorization token was received. Try connecting again.');
  return token;
}

async function requestGoogle(url, interactive = false) {
  let token = await getToken(interactive);
  let response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401) {
    await chrome.identity.removeCachedAuthToken({ token });
    token = await getToken(interactive);
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }
  if (!response.ok) {
    let details = '';
    try { details = (await response.json())?.error?.message || ''; } catch { /* no JSON */ }
    throw new Error(`Google Calendar API ${response.status}: ${details || response.statusText}`);
  }
  return response.json();
}

async function fetchPages(path, query, interactive = false, maxItems = 20000) {
  const items = [];
  let nextPageToken;
  let pageCount = 0;
  do {
    const url = new URL(`https://www.googleapis.com/calendar/v3/${path}`);
    Object.entries(query).forEach(([name, value]) => url.searchParams.set(name, String(value)));
    if (nextPageToken) url.searchParams.set('pageToken', nextPageToken);
    const data = await requestGoogle(url.toString(), interactive && pageCount === 0);
    items.push(...(data.items || []));
    nextPageToken = data.nextPageToken;
    pageCount += 1;
    if (items.length >= maxItems && nextPageToken) {
      return { items, truncated: true };
    }
  } while (nextPageToken);
  return { items, truncated: false };
}

async function loadCalendars(interactive) {
  return fetchPages('users/me/calendarList', { maxResults: 250 }, interactive, 2000);
}

async function loadEvents({ calendarIds, startISO, endISO }) {
  if (!Array.isArray(calendarIds) || !calendarIds.length) return { items: [], truncated: false };
  if (calendarIds.length > 15) throw new Error('Select up to 15 calendars at a time to limit API requests.');
  const start = new Date(startISO), end = new Date(endISO);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start >= end) throw new Error('Invalid date range.');
  if (end - start > 1000 * 60 * 60 * 24 * 365 * 10) throw new Error('You can read up to 10 years of calendar data at a time.');
  const sets = await Promise.all(calendarIds.map(async id => {
    const data = await fetchPages(`calendars/${encodeURIComponent(id)}/events`, {
      maxResults: 2500,
      singleEvents: true,
      orderBy: 'startTime',
      showDeleted: false,
      timeMin: startISO,
      timeMax: endISO
    });
    return { ...data, items: data.items.map(item => ({ ...item, calendarId: id })) };
  }));
  return {
    items: sets.flatMap(set => set.items),
    truncated: sets.some(set => set.truncated)
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !['connect', 'calendarList', 'events'].includes(message.type)) return false;
  (async () => {
    switch (message.type) {
      case 'connect': return loadCalendars(true);
      case 'calendarList': return loadCalendars(false);
      case 'events': return loadEvents(message.payload);
      default: throw new Error('Unsupported request.');
    }
  })().then(data => sendResponse({ ok: true, data }))
    .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});
