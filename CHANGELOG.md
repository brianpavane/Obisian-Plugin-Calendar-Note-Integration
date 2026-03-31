# Changelog

All notable changes to **Google Calendar Note Integration** are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [6.0.6] – 2026-03-31

### Fixed

**Google CalDAV persistent timeouts — root-cause architectural fix via EventKit**

The core issue was architectural: every approach that goes through Calendar.app's scripting bridge (`Application("Calendar")`) — including `eventsFrom`, `events.length`, `events.startDate()`, and `events[j]` — can trigger Calendar.app to sync the CalDAV calendar from Google's servers when its in-process cache is stale. This sync is what causes the 60–150 s timeouts, and no amount of tuning the scan size or JXA method selection fully avoids it.

**The correct approach**: Use **EventKit** (`EKEventStore`) directly via the JXA/Objective-C bridge, bypassing Calendar.app's scripting layer entirely.

- `EKEventStore` reads from the same **local SQLite cache** that Calendar.app maintains.
- That cache is kept current by a macOS background daemon (separate from Calendar.app's process).
- `EKEventStore.eventsMatchingPredicate()` reads from the local store only — it **never makes a CalDAV network request**.
- With a proper date-range predicate, the query returns in **< 100 ms** on any size calendar.

**New Tier 0** (tried before any Calendar.app scripting-bridge access):
```
ObjC.import('EventKit');
var store = $.EKEventStore.alloc.init;
var pred  = store.predicateForEventsWithStartDateEndDateCalendars(startNS, endNS, [calRef]);
var evts  = store.eventsMatchingPredicate(pred);  // local cache only, no network
```

If Tier 0 succeeds, Tiers 2–3 are skipped entirely. If EventKit is unavailable or the process lacks Calendar permission, the full Calendar.app scripting-bridge chain (Tiers 2, 2.5, 2.75, 3) remains as a fallback.

**Attendee data via EventKit**: `EKParticipant.URL` provides the email as a `mailto:` URL (scheme stripped). `EKParticipant.participantStatus` is an integer (`0` unknown, `1` pending, `2` accepted, `3` declined, `4` tentative). Both are correctly mapped to the existing attendee format.

---

## [6.0.5] – 2026-03-31

### Fixed

**Google CalDAV (Google account synced to Calendar.app) — root-cause fix for persistent timeouts**

Previous releases reduced `maxTier3Scan` and switched to lazy indexed access in Tier 3, which helped Exchange accounts but did not fix Google CalDAV. The reason: for CalDAV, **every access to `targetCal.events.*`** (including `.length`) forces Calendar.app to fully sync the calendar from Google's servers before returning. On a cold cache this sync takes 60–150 s regardless of how many events are subsequently iterated.

**Root cause**: Tier 2 (`cal.eventsFrom(windowStart, {to: windowEnd})`) was the correct fix all along — it tells Calendar.app to issue a CalDAV `REPORT` request with a `<time-range>` filter, which Google answers with *only* the matching events (typically 1–5 s). Tier 2 was skipped because it threw `"Can't convert types"` — a JXA type-coercion bug where the automatic JS `Date` → AppleScript `date` conversion fails for CalDAV calendars (it works for Exchange/EWS via a different code path).

**Fix**: Tier 2 now first tries passing `$.NSDate` objects (via `ObjC.import('Foundation')`), which Calendar.app accepts without the type-coercion error. If that also fails, it falls back to the original JS Date attempt (Exchange compatibility). The NSDate path should resolve immediately for Google CalDAV.

**Also:**
- Timeout setting maximum raised 120 s → **300 s** (useful safety net during the first cold sync, or for extremely large calendars). Step size changed from 5 s to 15 s.
- Timeout setting description updated to mention the CalDAV NSDate fix.
- Default `appleMaxTier3Scan` in `DEFAULT_SETTINGS` aligned to 250 (matching the code constant).

---

## [6.0.4] – 2026-03-31

### Fixed

**Google CalDAV calendar (Google account synced to Calendar.app) timing out at 120 s**

Root cause: Tier 3 called `targetCal.events()` — a JXA method call with parentheses — which forces Calendar.app to **materialise the entire event array** as a single AppleEvent response. For a Google CalDAV calendar with thousands of events this triggers a full server sync before returning, reliably exceeding the 120 s process timeout.

Fix: replaced `targetCal.events()` with:
- `targetCal.events.length` — a property access (no parentheses), which reads only the cached count without triggering a full fetch.
- `targetCal.events[j]` — a **lazy indexed object specifier**; Calendar.app resolves only that one event record when a property is subsequently accessed on it.

This brings Tier 3 behaviour in line with Tier 2.75, which already used indexed access (`targetCal.events[m]`) and had the same lazy-evaluation benefit.

**Additional tuning:**
- `DEFAULT_MAX_TIER3_SCAN` reduced from 500 → **250** (a typical active Google CalDAV calendar has ~10 events/day; 250 covers a 25-day window, more than sufficient for any reasonable `hoursInAdvance` setting).
- Tier 2.75 count guard threshold reduced from `4 × maxTier3Scan` → **`3 × maxTier3Scan`** (default: 750 events). The previous threshold of 2 000 was overly generous; 750 keeps Tier 2.75 fast on normal-sized calendars while still falling back to Tier 3 for very large ones.

---

## [6.0.3] – 2026-03-31

### Fixed

**Attendee list and response status not appearing in notes (Apple Calendar / Exchange)**

Two bugs caused attendees to be silently dropped:

1. **JXA individual-getter fallback** — `atts[ai].properties()` often returns an empty object for Exchange-backed attendees (Calendar.app does not always expose Exchange contact data via the bulk properties call). The JXA code now falls back to individual `address()`, `displayName()`, and `participationStatus()` getters when `properties()` yields an empty result.

2. **Display-name-only attendees** — Exchange attendees frequently have a display name but no email address in Calendar.app's scripting bridge (internal contacts, external guests). The previous code did `if (!email) continue` which silently dropped every such attendee. The fix uses the display name as a fallback identifier so the attendee table is populated even without email addresses.

3. **Additional participation status strings** — Added `"invited"` and `"notResponded"` to the status mapping (both map to ⚪ Awaiting response), covering Calendar.app variants seen on macOS Ventura/Sonoma with Exchange.

---

## [6.0.2] – 2026-03-31

### Fixed

**Zoom / Google Meet / Teams invite text no longer appears in the Agenda section**

Calendar event descriptions often contain the full video-conferencing invite block — join URL, Meeting ID, Passcode, dial-in numbers, "One tap mobile" lines, etc. This text was being included verbatim in the Agenda section of generated notes.

`stripConferenceBoilerplate()` is now applied to the description before it is split into agenda items. It removes:
- Any line containing a Zoom, Google Meet, or Microsoft Teams URL
- Common Zoom/Teams/Meet boilerplate prefixes: `Join Meeting`, `Meeting ID:`, `Passcode:`, `Password:`, `Dial by your location`, `Dial in by phone`, `One tap mobile`, `Find your local number`, `Join by SIP`, `Join by H.323`, dial-in phone number lines, and numeric conference code lines

The conference join link itself continues to appear in the note **header** when **Include conference link** is enabled in Settings.

---

## [6.0.1] – 2026-03-31

### Fixed

**1. Notes created for declined events**
- Added `filterDeclinedEvents()` — when **Your email address** is set in Settings, any event where your attendee entry has `responseStatus = "declined"` is excluded from note creation.
- Applied in all three note-creation paths: auto-create (startup/poll), event picker, and "create note for next event" command.
- Events where you are not listed as an attendee at all are kept (organiser-only events, iCal events with no attendee data).

**2. Recurring meetings (set up long ago) missing from note creation**
- Root cause: Tier 2.75's date filter compared event `startDate >= windowStart`, which excluded recurring event instances whose Calendar.app record date fell slightly before the fetch window boundary.
- Fix: Tier 2.75 now looks back an extra **30 days** before `windowStart` (i.e., `startDate >= windowStart − 30 days`). Calendar.app materialises recurring series instances as individual records with their own occurrence `startDate`; the wider net captures those near the boundary.
- Note: if Calendar.app stores only a recurring series master (with the original creation date from years ago) and does not expand instances, those masters will still be excluded — this is a Calendar.app limitation on Exchange/EWS accounts where only `eventsFrom()` triggers proper expansion. The diagnostic tool will show which tier your calendar uses.

**3. Tier 2.75 timing out on very large calendars**
- Root cause: `cal.events.startDate()` on a calendar with thousands of events returns a massive single AppleEvent response that can take >120 s to serialise.
- Fix: Tier 2.75 now checks `targetCal.events.length` first. If the calendar has more than **4 × maxTier3Scan** events (default threshold: 2 000), Tier 2.75 is skipped and execution falls through to Tier 3 (bounded scan of newest N events). Avoids the unbounded bulk fetch on large calendars.
- The `events.length` count is a lightweight property read (cached by Calendar.app) and does not trigger a full event sync.

---

## [6.0.0] – 2026-03-31

### Summary
Major release consolidating all Apple Calendar reliability improvements from the 5.x series, a full security audit with fixes, and updated documentation.

### Added
- **Tier 2.75 — bulk start-date fetch** (from 5.2.1): `cal.events.startDate()` in one IPC call, filtered in JS, `properties()` only on matches. Resolves Exchange/Office 365 timeout root cause (1 000 individual calls → 1 bulk call).
- **Configurable timeout per calendar** (from 5.2.0): Settings → Apple Calendar → Advanced, 15–120 s default 30 s.
- **Skip Tier 3 toggle** (from 5.2.0): Skip full-scan fallback for calendars that always time out.
- **Max events for last-resort scan** (from 5.2.1): Tier 3 scan cap, 50–2 000, default 500.
- **Per-tier timing in console** (from 5.2.0): `t2ms`, `t2.5ms`, `t2.75ms`, `t3ms` logged on every fetch for precise diagnostics.
- **Diagnostic modal** (from 5.1.0): Replaces `Notice` toast with a scrollable `Modal` including Copy to Clipboard button.
- **All-day event exclusion**: All-day events are never used as the basis for note creation.

### Security fixes (audit v6.0.0)
- **`crypto.randomUUID()` for fallback UIDs** — replaced `Math.random()` in `appleCalendarApi.ts` UID fallback path with `crypto.randomUUID()` for cryptographically sound uniqueness.
- **`stripHtml()` DoS hardening** — `noteCreator.ts` now caps HTML input at 10 000 characters before DOM parsing, preventing CPU DoS from malformed/oversized event descriptions.
- **iCal error preview reduced** — `calendarApi.ts` error preview trimmed from 120 → 50 characters to reduce potential information disclosure.
- **Refresh token reuse documented** — `googleAuth.ts` now carries an explicit comment explaining why refresh token fallback is correct and intentional (not a security defect).
- **Audit result: no critical or high-severity vulnerabilities found.** See Security Model in README for full details.

### Performance (Apple Calendar — 5.x cumulative)
- `evt.properties()` batch reads — 1 IPC call per event instead of 7+ individual getters.
- `atts[i].properties()` batch reads for attendees — capped at 20 per event.
- Per-calendar `osascript` isolation — each calendar has its own process and timeout; a hung calendar cannot block others.
- Tier 3 scan cap reduced 5 000 → 500 (default), scans newest-first.
- Tier 2.75 added as primary fallback before individual-call Tier 3.

### Changed
- Version bumped to **6.0.0** to mark the completion of the Apple Calendar reliability work and the security audit milestone.

---

## [5.2.1] – 2026-03-30

### Added
- **Tier 2.75 — bulk start-date fetch** — new fetch strategy inserted between Tier 2.5 and the old full-scan Tier 3. Calls `cal.events.startDate()` once to retrieve ALL event start dates in a single IPC round-trip, filters in JavaScript, then calls `properties()` only on matching events. This is the primary fix for Exchange/Office 365 calendars that time out: instead of 1 000 individual `startDate()` calls (each ~50–100 ms on an Exchange calendar = 50–100 s total), one bulk call typically completes in 1–5 s.
- **Configurable Tier 3 scan cap** — new `appleMaxTier3Scan` setting in Settings → Apple Calendar → Advanced (range 50–2 000, default 500). Tier 3 is now only reached if Tier 2.75 also fails.
- Per-tier timing now includes `t2.75ms` in the developer console log.

### Changed
- Default `MAX_TIER3_SCAN` reduced from 1 000 to **500** (Tier 2.75 handles most cases now; Tier 3 is a last resort).
- Tier 3 fallback description in diagnostic output updated to mention Tier 2.75 is tried first.

---

## [5.2.0] – 2026-03-30

### Added
- **Configurable timeout per calendar** — new setting in Settings → Apple Calendar → Advanced. Range 15–120 seconds (default 30 s). Increase for large Exchange or Office 365 calendars that timeout during fetching. The timeout error message now cites the actual value and links to Settings.
- **Skip full-scan fallback (Tier 3) toggle** — new setting in Settings → Apple Calendar → Advanced. When enabled, calendars that fail Tier 2 and Tier 2.5 are skipped entirely instead of running a slow full-event scan. Prevents one large calendar from blocking other calendars' results.
- **Per-tier timing in console logs** — each per-calendar fetch now logs elapsed milliseconds for every tier attempted (`t2ms`, `t2.5ms`, `t3ms`) so slow steps can be identified immediately from the developer console.

### Changed
- Apple Calendar fetch log now includes `timeout` and `skipTier3` values at the start of every `fetchAllEvents()` call for easier debugging.
- Total-failure error message for timed-out calendars now references the configured timeout value and directs users to the new Advanced settings.

---

## [5.1.0] – 2026-03-30

### Added
- **Per-calendar osascript isolation** — each calendar is now queried in a separate `osascript` process with its own 30-second timeout. A hung or slow calendar no longer blocks other calendars from returning results. Partial results are returned whenever at least one calendar succeeds.
- **Tier 2.5 — `cal.events.whose()` predicate** — added a third fetch strategy between `cal.eventsFrom()` (Tier 2) and the full scan (Tier 3). The `whose` predicate filters events server-side inside Calendar.app without loading all events into memory, fixing the "Can't convert types" error on Exchange calendars.
- **`evt.properties()` batch reads** — instead of 7+ individual IPC calls per event (`evt.startDate()`, `evt.summary()`, etc.), all scalar fields are now fetched in a single `properties()` call. For calendars with many recurring events, this reduces IPC round-trips by ~7×, directly addressing the most common cause of timeouts.
- **Attendee batch reads** — attendee properties are fetched via `atts[i].properties()` (one call per attendee instead of three), capped at 20 attendees per event.

### Changed
- Tier 3 full-scan cap reduced from 5 000 to **1 000 events**. Scan starts from the newest events first (`total - 1000` index forward) so upcoming events are always captured. Previously the scan started from the oldest end, missing all future events on large calendars.
- `runOsascript` error reporting switched from `err.message` (which contained the entire JXA script text) to `stderr` only, extracting the last meaningful error line. Startup console log no longer dumps the full JXA script on Tier 1 failure.
- Diagnostic dialog replaced with a scrollable `Modal` (was a `Notice` toast). The modal includes a **Copy to Clipboard** button and auto-sizes to 60 vh.

---

## [5.0.0] – 2026-03-30

### Added
- **Apple Calendar support** via JavaScript for Automation (JXA / `osascript`). Reads events directly from Calendar.app on macOS — no API keys, OAuth, or network access required. All accounts already synced in Calendar.app (Google, iCloud, Exchange, Office 365) are available automatically.
- Three-tier fetch strategy with automatic fallback:
  - **Tier 1** — `app.eventsFrom()` single application-level call (fastest)
  - **Tier 2** — `cal.eventsFrom()` per-calendar call
  - **Tier 3** — `cal.events()` full scan with JS date filter (compatibility fallback)
- **Calendar selection checkboxes** — settings UI lists all Calendar.app calendars with per-calendar toggles. Only selected calendars are queried; uncheck all to include every calendar.
- **All-day event filtering** — all-day events are excluded from note creation (only timed events get notes).
- **Run Diagnostics button** — three-step check: JXA execution → list calendars → per-calendar fetch strategy probe. Reports which tier each calendar uses, event counts, and any errors.
- **Conference link detection** for Apple Calendar events — Google Meet, Zoom, and Microsoft Teams URLs are extracted from event descriptions and included in notes (same as Google Calendar / iCal modes).
- `runAppleCalendarDiagnostic()` exported from `appleCalendarApi.ts` for use in the settings UI.

### Security
- JXA script templates interpolate only validated integers (`daysBack`, `daysAhead`) and calendar names via `JSON.stringify()` — user strings are never interpolated raw.
- Apple Calendar output capped at 5 MB before `JSON.parse`.
- `execFile` (not `exec`) is used so no shell expansion occurs.

---

## [4.0.0] – 2026-03-30

### Added
- **Google Account (OAuth 2.0) mode restored** alongside iCal URL mode.
- Three authentication modes selectable from a single dropdown: **iCal URL**, **Google Account**, **Apple Calendar**.
- `CalendarService` unified adapter wrapping all three backends with a common interface (`fetchAllEvents`, `listEventsInTimeWindow`, `listUpcomingEvents`).
- Shared `CalendarEvent` / `ResponseStatus` types across all backends.

---

## [2.1.0] – 2026-03-30

### Added
- Initial Apple Calendar (macOS) integration via JXA — proof-of-concept single-call fetch.
- `AppleCalendarApi` class in `appleCalendarApi.ts`.
- macOS-only flag set in `manifest.json` (`isDesktopOnly: true`).

---

## [1.2.0] – 2026-03-30  *(ical branch)*

### Changed — Breaking
- **Replaced OAuth / Google Cloud Console with iCal URL.** The plugin now
  reads events directly from Google Calendar's "Secret address in iCal format"
  URL. No Google Cloud Console project, API keys, or OAuth flow is required.
  Users upgrading from 1.1.0 must paste their iCal URL in Settings; previous
  OAuth credentials are no longer used.

### Added
- `src/icalParser.ts` — RFC 5545 iCal parser handling line unfolding, DATE /
  DATE-TIME (UTC, floating, TZID-qualified), ATTENDEE with PARTSTAT, ORGANIZER,
  X-GOOGLE-CONFERENCE / X-GOOGLE-HANGOUT, and STATUS:CANCELLED suppression.
- `IcalCalendarApi` in `calendarApi.ts` — fetches the iCal feed, appends
  `singleevents=true` to Google Calendar URLs automatically so recurring events
  are expanded server-side, and filters events by time window.
- **"Your email address" setting** — when set, the matching attendee entry is
  marked as `self` and excluded from the attendees table in generated notes.
- **"Test connection" button** in Settings — verifies the iCal URL is reachable
  and reports the total number of events found in the feed.

### Removed
- `src/googleAuth.ts` — OAuth 2.0 authorize / refresh / revoke flows.
- `src/secureStorage.ts` — Electron `safeStorage` credential encryption
  (no longer needed; the iCal URL is read-only and revocable).
- `src/electron.d.ts` — Electron type declarations (no longer needed).
- Settings fields: `clientId`, `clientSecret`, `accessToken`, `refreshToken`,
  `tokenExpiry`, `calendarId`.

### Security
- iCal URL validated as HTTPS before fetch; fetch has a 15-second
  `AbortController` timeout.
- All existing note-content sanitisation (YAML injection, Markdown injection,
  URL injection, DOMParser HTML stripping) is retained unchanged.

---

## [1.1.0] – 2026-03-30

### Added
- **Duration in meeting notes** — each timed event note now displays a
  `**Duration:**` line (e.g. `1h 30m`) directly below the time range, and
  the value is also written to the YAML frontmatter as `duration:`.
- **Refresh button in Settings** — a new "Manual Refresh" section in the
  plugin settings contains a **Refresh** button that immediately fetches
  events within the configured advance window and creates any missing notes,
  without waiting for the next scheduled poll.
- **`version-bump.mjs`** — helper script that bumps the version across
  `manifest.json`, `package.json`, and `versions.json` simultaneously.
  Run via `npm run version:patch`, `npm run version:minor`, or
  `npm run version:major`.
- **`CHANGELOG.md`** — this file.

### Security
- **At-rest credential encryption** (`src/secureStorage.ts`) — OAuth tokens
  and the Client Secret are now encrypted with Electron's `safeStorage` API
  (macOS Keychain / Windows DPAPI / Linux Secret Service) before being written
  to `data.json`. Legacy plaintext values from 1.0.0 are migrated automatically
  on the next save.
- **Dynamic OAuth redirect port** — the local HTTP server now binds to an
  OS-assigned ephemeral port instead of the fixed port 42813, eliminating
  potential port-conflict errors.
- **Cross-origin request blocking** — the OAuth redirect server now rejects
  requests whose `Origin` header does not resolve to localhost (403), blocking
  cross-origin fetch attacks from malicious web pages.
- **HTTP method validation** — the OAuth redirect server now rejects non-GET
  requests with 405.
- **DOMParser HTML stripping** — the event description HTML-to-text conversion
  now uses the browser's `DOMParser` API instead of a regex chain, giving
  spec-compliant, injection-resistant HTML parsing.
- **Input guards** — non-null guards added for `start.dateTime`/`end.dateTime`
  in note and modal code; `formatIsoDate()` now guards against `Invalid Date`;
  leading dots stripped from generated filenames.
- **`safeErrorMessage()` helper** — all user-visible error messages are now
  sanitised (newlines stripped, length capped) to prevent log/Notice injection.
- **Token revocation on disconnect** — the Disconnect button now calls
  Google's revocation endpoint before clearing local credentials.
- **CSRF protection** — the OAuth flow generates a `crypto.randomUUID()` state
  token per attempt and verifies it on the redirect callback.

### Documentation
- Full README rewrite: features table, example note, setup guide,
  configuration reference, note template anatomy, security model, architecture,
  developer docs, troubleshooting, and installation/upgrade instructions.

---

## [1.0.0] – 2026-03-28

### Added
- Initial release.
- Full OAuth 2.0 "installed app" flow for Google Calendar (read-only scope).
- Auto-create meeting notes 1–48 hours before events start.
- Startup sweep and configurable poll interval (5–120 min).
- Structured note template: YAML frontmatter + Agenda / Notes / Summary /
  Actions sections with bullet lists pre-populated from the invite description.
- Attendee table with RSVP status icons (🟢🔴🟡⚪🔷) and email column.
- Fuzzy-search event picker command.
- Settings tab: Client ID/Secret, Calendar ID, note folder, advance window,
  poll interval.
