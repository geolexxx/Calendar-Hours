# Calendar Hours — Free Google Calendar Time Tracking Extension for Chrome

**This is an installable personal MVP. It is not published on the Chrome Web Store and has not been tested end to end with a real Google account.**

Open Chrome’s native side panel alongside Google Calendar to view and manage:

- Historical calendar hours by project, project breakdowns, and daily activity
- The last 7 / 30 / 90 / 365 days, or any start date through today
- Automatic classification by event title keywords, with preset projects for pai Development, Job Search, SQL Learning, and NFL / BDB; projects and keywords are editable
- Manual project assignments or exclusions for individual events, saved locally in Chrome
- A separate timer for actual work, which keeps running when the panel is closed until you stop it
- CSV report exports and a choice of Google calendars to include
- Demo mode: **preview the interface without configuring Google OAuth**

## 1. Install the extension (no subscription required)

1. Extract `calendar-hours-extension.zip` and keep the folder in a permanent location, such as `~/Documents/calendar-hours-extension`. If you cloned this repository, use the repository folder instead.
2. Enter `chrome://extensions` in Chrome’s address bar.
3. Enable **Developer mode** in the upper-right corner.
4. Click **Load unpacked** and select the folder containing `manifest.json`.
5. Copy the extension’s **ID** (32 letters) from its card. Keep the folder in the same location, because moving it may change the extension ID.
6. Open [Google Calendar](https://calendar.google.com/) and click the Calendar Hours extension icon in Chrome’s toolbar. The panel opens on the right.
7. Click **Try demo data** to explore the interface without Google authorization.

> Chrome’s native side panel sits alongside the page and does not cover calendar events.

After updating the extension files, click **Reload** on its card at `chrome://extensions`, then close and reopen the side panel to load the changes.

## 2. Configure your Google OAuth client before connecting (one-time setup)

Google requires your authorization before an extension can read your private calendars. To sync real calendar data, configure your own Google Cloud OAuth client:

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project, such as `Calendar Hours Personal`.
2. Go to **APIs & Services → Library**, find **Google Calendar API**, and enable it.
3. Go to **Google Auth Platform / OAuth consent screen** and enter the application name and support email. For a personal Gmail account, select **External**, keep the app in **Testing**, and add the Gmail account you use for Google Calendar to **Test users**. Follow the prompts to configure only this scope: `https://www.googleapis.com/auth/calendar.readonly`.
4. Go to **Clients / Credentials → Create OAuth client ID**, select **Chrome Extension** as the application type, and enter the 32-letter **Extension ID** from section 1 in the extension ID / Item ID field.
5. Copy the OAuth **Client ID**, which looks like `12345-abc.apps.googleusercontent.com`.
6. Open `manifest.json` in a text editor and replace the entire `REPLACE_ME.apps.googleusercontent.com` placeholder with your Client ID. Do not include a Client Secret in the extension; Chrome extension clients do not need one.
7. Return to `chrome://extensions` and click **Reload** on the extension’s card.
8. Open Google Calendar, click the extension icon, and click **Connect Google Calendar**. Sign in through Google’s authorization page and grant read-only access.

Google’s console interface and review process may change. If you see an “unverified app” message, confirm that this is your own project and that your account is listed under Test users before deciding whether to proceed. Only authorize apps from sources you trust.

**Note:** You must configure your own OAuth client. The extension does not include a shared OAuth key or account credentials, and it does not require a hosted server.

## 3. Usage tips

- Event titles such as `pai - coding`, `career - resume`, and `SQL learning` are classified automatically by keyword.
- Edit rules under **Settings → Projects and keywords**. For example: `pai, camera agent, decouple`. Separate keywords with commas; projects are matched from top to bottom.
- Select calendars under **Settings → Calendars to sync** to avoid counting shared events more than once.
- Assign a project to an event on the **Events** tab to override automatic matching. This does not change the original Google Calendar event.
- Select **From a date to today** in the date range selector, for example `2026-10-19`, to see cumulative calendar hours since a project began.
- Use the **Timer** tab’s start and stop buttons to measure actual work. Calendar hours and timer hours are reported separately and should not be added together.

## 4. Calculation rules and limitations

- **Calendar hours** use elapsed event start and end times, clipped to the selected date range and the current time. **They do not confirm that the scheduled work was completed.**
- All-day events are excluded, as are canceled events, declined invitations, working locations, birthdays, and out-of-office events.
- Recurring events are expanded into individual occurrences.
- Events spanning multiple days are supported and split by day in the activity chart.
- Events with the same iCalendar UID and start time across calendars are deduplicated where possible. Duplicate bookings with different identifiers and overlapping events can still inflate totals.
- Only events matched by project keywords or assigned manually count toward total project hours. Unassigned events are reported separately.
- Project settings, manual assignments, and timer sessions are stored in `chrome.storage.local`. They do not sync automatically across browsers or devices.
- You can select up to 15 calendars, read up to 20,000 events per calendar, and request up to 10 years at a time. Large ranges may take longer to load.
- Google Calendar access uses read-only OAuth permissions. The extension does not create, edit, or delete Google Calendar events and does not use a custom server.
- **End-to-end testing with a real Google OAuth account is still pending.** The source includes analytics unit tests that run offline.

## 5. Run unit tests (optional)

Install Node.js 22+ and run this command in the extension folder:

```bash
node --test tests/analytics.test.mjs
```

## 6. Developer notes

- `manifest.json`: Manifest V3, Chrome sidePanel configuration, and read-only OAuth scope
- `background.js`: Google Calendar API authorization, calendar listing, and paginated event retrieval
- `analytics.mjs`: Keyword matching, date range clipping, time totals, and daily activity
- `panel.html` / `style.css` / `panel.mjs`: Side panel interface, project settings, timer, and CSV export

The only third-party API requests go to `https://www.googleapis.com/calendar/v3/`. There is no analytics tracking or telemetry. Publishing the extension for other users requires additional work, including Google OAuth review and a privacy policy.

## 7. Cost

The extension itself is free to use. It does not use Toggl or require Render, Vercel, or a paid database. Consult [Google Calendar API usage limits](https://developers.google.com/workspace/calendar/api/guides/quota) for the applicable quotas and billing rules; do not assume unlimited API usage is always free. The extension requests data only when the panel syncs or you refresh manually, and does not poll continuously.
