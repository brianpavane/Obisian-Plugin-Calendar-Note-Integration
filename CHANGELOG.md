# Changelog

All notable changes to **Google Calendar Note Integration** are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
