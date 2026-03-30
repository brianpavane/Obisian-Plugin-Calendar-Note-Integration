/**
 * @file settings.ts
 * @description Plugin settings interface, defaults, and the Obsidian settings
 * tab UI for Google Calendar Note Integration.
 *
 * Supports two authentication modes:
 *   - "ical"  — iCal secret URL, no account required (personal calendars)
 *   - "oauth" — Google OAuth 2.0 via REST API (organization/work calendars)
 */

import { AbstractInputSuggest, App, Notice, PluginSettingTab, Setting, TFolder } from "obsidian";
import type GoogleCalendarPlugin from "./main";
import { IcalCalendarApi, GoogleCalendarApi } from "./calendarApi";
import { GoogleAuth } from "./googleAuth";
import { encrypt, decrypt } from "./secureStorage";

// ---------------------------------------------------------------------------
// Settings interface & defaults
// ---------------------------------------------------------------------------

/**
 * All persisted configuration for the plugin.
 *
 * Stored by Obsidian in:
 * `.obsidian/plugins/obsidian-google-calendar-notes/data.json`
 */
export interface GoogleCalendarSettings {
  // -- Auth mode ------------------------------------------------------------

  /** Which connection method is active. */
  authMode: "ical" | "oauth";

  // -- iCal connection (authMode === "ical") ---------------------------------

  /**
   * Google Calendar "Secret address in iCal format".
   * Found in Google Calendar → Settings → [calendar] → Integrate calendar.
   */
  icalUrl: string;

  // -- OAuth connection (authMode === "oauth") --------------------------------

  /** OAuth 2.0 Client ID from Google Cloud Console. */
  clientId: string;

  /** OAuth 2.0 Client Secret from Google Cloud Console. */
  clientSecret: string;

  /** Encrypted OAuth access token (short-lived). */
  accessToken: string;

  /** Encrypted OAuth refresh token (long-lived). */
  refreshToken: string;

  /** Unix timestamp (ms) when the access token expires. */
  tokenExpiry: number;

  /**
   * Which Google Calendar to fetch events from.
   * Use "primary" for the user's default calendar, or paste a calendar ID
   * from Google Calendar → Settings → [calendar] → Integrate calendar.
   */
  calendarId: string;

  // -- Personal identity -----------------------------------------------------

  /**
   * The user's own Google account email address (lowercase).
   * When set, the matching attendee entry is hidden from generated notes.
   */
  selfEmail: string;

  // -- Note options ----------------------------------------------------------

  /** Vault-relative folder where new notes are created. Empty = vault root. */
  noteFolder: string;

  /** Hours before an event starts to auto-create its note. Range: 1–48. */
  hoursInAdvance: number;

  /** Poll interval in minutes. Range: 5–120. Takes effect after restart. */
  pollIntervalMinutes: number;

  // -- Event picker options --------------------------------------------------

  /** Days ahead to search in the event picker. Range: 1–30. */
  daysAhead: number;

  /** Max events shown in the picker. Range: 1–50. */
  maxEvents: number;
}

/**
 * Default values applied on first install or when a key is absent after upgrade.
 */
export const DEFAULT_SETTINGS: GoogleCalendarSettings = {
  authMode: "ical",
  icalUrl: "",
  clientId: "",
  clientSecret: "",
  accessToken: "",
  refreshToken: "",
  tokenExpiry: 0,
  calendarId: "primary",
  selfEmail: "",
  noteFolder: "Meeting Notes",
  hoursInAdvance: 12,
  pollIntervalMinutes: 30,
  daysAhead: 7,
  maxEvents: 20,
};

// ---------------------------------------------------------------------------
// Folder suggest
// ---------------------------------------------------------------------------

class FolderSuggest extends AbstractInputSuggest<TFolder> {
  private el: HTMLInputElement;

  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.el = inputEl;
  }

  getSuggestions(query: string): TFolder[] {
    return this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder)
      .filter((f) => f.path.toLowerCase().includes(query.toLowerCase()));
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path);
  }

  selectSuggestion(folder: TFolder): void {
    this.setValue(folder.path);
    // Fire the DOM input event so TextComponent.onChange() picks up the value.
    this.el.dispatchEvent(new Event("input"));
    this.close();
  }
}

// ---------------------------------------------------------------------------
// Settings tab UI
// ---------------------------------------------------------------------------

/**
 * Renders the plugin settings page inside Obsidian's Settings modal.
 *
 * Sections:
 *   1. Google Calendar Connection — iCal URL, test button
 *   2. Personal Settings          — self email
 *   3. Note Settings              — folder, hours in advance, poll interval
 *   4. Calendar View              — days ahead, max events
 *   5. Manual Refresh             — immediate poll trigger
 */
export class GoogleCalendarSettingTab extends PluginSettingTab {
  plugin: GoogleCalendarPlugin;

  constructor(app: App, plugin: GoogleCalendarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Google Calendar Note Integration" });

    // ----- Connection Method ------------------------------------------------
    containerEl.createEl("h3", { text: "Connection Method" });

    new Setting(containerEl)
      .setName("Authentication mode")
      .setDesc(
        "iCal URL works for personal calendars with no setup. " +
          "Google Account is required for organization/work calendars that block external iCal access."
      )
      .addDropdown((drop) => {
        drop.addOption("ical", "iCal URL (personal / public calendars)");
        drop.addOption("oauth", "Google Account (organization / work calendars)");
        drop.setValue(this.plugin.settings.authMode);
        drop.onChange(async (value: string) => {
          this.plugin.settings.authMode = value as "ical" | "oauth";
          await this.plugin.saveSettings();
          this.display();
        });
      });

    // ----- iCal Section (authMode === "ical") --------------------------------
    if (this.plugin.settings.authMode === "ical") {
      containerEl.createEl("h3", { text: "iCal Connection" });

      const helpDiv = containerEl.createEl("div");
      helpDiv.createEl("p", {
        text: "Use the private iCal URL from Google Calendar — no API keys or Google Cloud setup required.",
      });
      const ol = helpDiv.createEl("ol");
      ol.createEl("li", { text: "Open Google Calendar → Settings." });
      ol.createEl("li", { text: "Click the calendar name in the left sidebar." });
      ol.createEl("li", { text: 'Scroll to "Integrate calendar".' });
      ol.createEl("li", { text: 'Copy the "Secret address in iCal format" URL (ends in .ics).' });
      ol.createEl("li", { text: "Paste it below and click Test." });

      const isConnected = !!this.plugin.settings.icalUrl;
      const statusEl = containerEl.createEl("p", {
        text: isConnected ? "✓ iCal URL configured" : "✗ No iCal URL configured",
      });
      statusEl.style.fontWeight = "bold";
      statusEl.style.color = isConnected ? "var(--color-green)" : "var(--color-red)";

      new Setting(containerEl)
        .setName("iCal URL")
        .setDesc('The "Secret address in iCal format". Treat this as a password.')
        .addText((text) => {
          text.inputEl.type = "password";
          text.inputEl.style.width = "100%";
          text
            .setPlaceholder("https://calendar.google.com/calendar/ical/…/basic.ics")
            .setValue(this.plugin.settings.icalUrl)
            .onChange(async (value) => {
              this.plugin.settings.icalUrl = value.trim();
              await this.plugin.saveSettings();
            });
        });

      new Setting(containerEl)
        .setName("Test connection")
        .setDesc("Verify the iCal URL returns valid calendar data.")
        .addButton((button) =>
          button
            .setButtonText("Test")
            .setCta()
            .onClick(async () => {
              if (!this.plugin.settings.icalUrl) {
                new Notice("Please enter an iCal URL first.");
                return;
              }
              button.setButtonText("Testing…").setDisabled(true);
              try {
                const api = new IcalCalendarApi(this.plugin.settings.icalUrl);
                const events = await api.fetchAllEvents();
                const msg =
                  events.length === 0
                    ? "✓ Connected — feed is valid but contains 0 events. Open developer console (Ctrl+Shift+I) for details."
                    : `✓ Connected! Found ${events.length} event${events.length !== 1 ? "s" : ""} in the feed.`;
                new Notice(msg, events.length === 0 ? 8000 : 4000);
                this.display();
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                new Notice(`Connection failed: ${msg.replace(/[\r\n]+/g, " ").slice(0, 300)}`, 10000);
              } finally {
                button.setButtonText("Test").setDisabled(false);
              }
            })
        );
    }

    // ----- OAuth Section (authMode === "oauth") ------------------------------
    if (this.plugin.settings.authMode === "oauth") {
      containerEl.createEl("h3", { text: "Google Account" });

      const isAuthenticated = !!decrypt(this.plugin.settings.refreshToken);

      const helpDiv = containerEl.createEl("div");
      if (!isAuthenticated) {
        helpDiv.createEl("p", {
          text: "One-time setup: create OAuth credentials in Google Cloud Console.",
        });
        const ol = helpDiv.createEl("ol");
        ol.createEl("li", { text: "Go to console.cloud.google.com and create (or open) a project." });
        ol.createEl("li", { text: 'Enable the "Google Calendar API" for the project.' });
        ol.createEl("li", { text: 'Go to APIs & Services → Credentials → Create Credentials → OAuth client ID.' });
        ol.createEl("li", { text: 'Set Application type to "Desktop app" and click Create.' });
        ol.createEl("li", { text: "Copy the Client ID and Client Secret into the fields below." });
        ol.createEl("li", { text: 'Click "Sign in with Google" to authorize the plugin.' });
      }

      // Auth status
      const statusEl = containerEl.createEl("p", {
        text: isAuthenticated ? "✓ Authenticated with Google" : "✗ Not authenticated",
      });
      statusEl.style.fontWeight = "bold";
      statusEl.style.color = isAuthenticated ? "var(--color-green)" : "var(--color-red)";

      new Setting(containerEl)
        .setName("Client ID")
        .setDesc("OAuth 2.0 Client ID from Google Cloud Console.")
        .addText((text) => {
          text.inputEl.style.width = "100%";
          text
            .setPlaceholder("xxxxxxxxxxxx-xxxxxxxxxxxxxxxx.apps.googleusercontent.com")
            .setValue(this.plugin.settings.clientId)
            .onChange(async (value) => {
              this.plugin.settings.clientId = value.trim();
              await this.plugin.saveSettings();
            });
        });

      new Setting(containerEl)
        .setName("Client Secret")
        .setDesc("OAuth 2.0 Client Secret from Google Cloud Console.")
        .addText((text) => {
          text.inputEl.type = "password";
          text.inputEl.style.width = "100%";
          text
            .setPlaceholder("GOCSPX-…")
            .setValue(this.plugin.settings.clientSecret)
            .onChange(async (value) => {
              this.plugin.settings.clientSecret = value.trim();
              await this.plugin.saveSettings();
            });
        });

      if (!isAuthenticated) {
        new Setting(containerEl)
          .setName("Sign in with Google")
          .setDesc(
            "Opens your browser to the Google authorization page. " +
              "Enter Client ID and Client Secret first."
          )
          .addButton((button) =>
            button
              .setButtonText("Sign in with Google")
              .setCta()
              .onClick(async () => {
                if (!this.plugin.settings.clientId || !this.plugin.settings.clientSecret) {
                  new Notice("Please enter your Client ID and Client Secret first.");
                  return;
                }
                button.setButtonText("Waiting for browser…").setDisabled(true);
                try {
                  const auth = new GoogleAuth(
                    this.plugin.settings.clientId,
                    this.plugin.settings.clientSecret
                  );
                  const tokens = await auth.authorize();
                  this.plugin.settings.accessToken = encrypt(tokens.access_token);
                  this.plugin.settings.refreshToken = encrypt(tokens.refresh_token);
                  this.plugin.settings.tokenExpiry = tokens.expiry_date;
                  await this.plugin.saveSettings();
                  new Notice("✓ Google Calendar authenticated successfully!", 5000);
                  this.display();
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  new Notice(`Authentication failed: ${msg.replace(/[\r\n]+/g, " ").slice(0, 200)}`, 8000);
                  button.setButtonText("Sign in with Google").setDisabled(false);
                }
              })
          );
      } else {
        new Setting(containerEl)
          .setName("Disconnect")
          .setDesc("Revoke authorization and clear stored credentials.")
          .addButton((button) =>
            button
              .setButtonText("Disconnect")
              .setWarning()
              .onClick(async () => {
                try {
                  const auth = new GoogleAuth(
                    this.plugin.settings.clientId,
                    this.plugin.settings.clientSecret
                  );
                  const token =
                    decrypt(this.plugin.settings.accessToken) ||
                    decrypt(this.plugin.settings.refreshToken);
                  if (token) await auth.revokeToken(token);
                } catch {
                  // revocation failure is non-fatal
                }
                this.plugin.settings.accessToken = "";
                this.plugin.settings.refreshToken = "";
                this.plugin.settings.tokenExpiry = 0;
                await this.plugin.saveSettings();
                new Notice("Disconnected from Google Calendar.");
                this.display();
              })
          );

        new Setting(containerEl)
          .setName("Calendar ID")
          .setDesc(
            'Which calendar to fetch events from. Use "primary" for your main calendar, ' +
              "or paste a specific calendar ID from Google Calendar → Settings → Integrate calendar."
          )
          .addText((text) => {
            text.inputEl.style.width = "100%";
            text
              .setPlaceholder("primary")
              .setValue(this.plugin.settings.calendarId)
              .onChange(async (value) => {
                this.plugin.settings.calendarId = value.trim() || "primary";
                await this.plugin.saveSettings();
              });
          });

        new Setting(containerEl)
          .setName("Test connection")
          .setDesc("Verify the OAuth token is valid and the calendar is accessible.")
          .addButton((button) =>
            button
              .setButtonText("Test")
              .setCta()
              .onClick(async () => {
                button.setButtonText("Testing…").setDisabled(true);
                try {
                  const accessToken = await this.plugin.getValidAccessToken();
                  const api = new GoogleCalendarApi(accessToken);
                  const calendarId = this.plugin.settings.calendarId || "primary";
                  const events = await api.listUpcomingEvents(calendarId, 50, 30);
                  new Notice(
                    `✓ Connected! Found ${events.length} event${events.length !== 1 ? "s" : ""} in the next 30 days.`,
                    5000
                  );
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  new Notice(`Connection failed: ${msg.replace(/[\r\n]+/g, " ").slice(0, 300)}`, 10000);
                } finally {
                  button.setButtonText("Test").setDisabled(false);
                }
              })
          );
      }
    }

    // ----- Personal Settings ------------------------------------------------
    containerEl.createEl("h3", { text: "Personal Settings" });

    new Setting(containerEl)
      .setName("Your email address")
      .setDesc(
        "Your Google account email. When set, your own entry is hidden from the attendees " +
          "table in generated notes. Leave blank to show all attendees."
      )
      .addText((text) =>
        text
          .setPlaceholder("you@example.com")
          .setValue(this.plugin.settings.selfEmail)
          .onChange(async (value) => {
            this.plugin.settings.selfEmail = value.trim().toLowerCase();
            await this.plugin.saveSettings();
          })
      );

    // ----- Note Settings ----------------------------------------------------
    containerEl.createEl("h3", { text: "Note Settings" });

    new Setting(containerEl)
      .setName("Note folder")
      .setDesc("Vault folder where meeting notes are created. Leave empty for vault root.")
      .addText((text) => {
        new FolderSuggest(this.app, text.inputEl);
        text
          .setPlaceholder("Meeting Notes")
          .setValue(this.plugin.settings.noteFolder)
          .onChange(async (value) => {
            this.plugin.settings.noteFolder = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Hours in advance")
      .setDesc("Hours before an event starts to auto-create its note. (1–48)")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.max = "48";
        text.inputEl.step = "1";
        text.inputEl.style.width = "80px";
        text
          .setValue(String(this.plugin.settings.hoursInAdvance))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num >= 1 && num <= 48) {
              this.plugin.settings.hoursInAdvance = num;
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(containerEl)
      .setName("Poll interval (minutes)")
      .setDesc("How often the plugin checks for new events. Takes effect after restart. (5–120)")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "5";
        text.inputEl.max = "120";
        text.inputEl.step = "5";
        text.inputEl.style.width = "80px";
        text
          .setValue(String(this.plugin.settings.pollIntervalMinutes))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num >= 5 && num <= 120) {
              this.plugin.settings.pollIntervalMinutes = num;
              await this.plugin.saveSettings();
            }
          });
      });

    // ----- Calendar View ----------------------------------------------------
    containerEl.createEl("h3", { text: "Calendar View" });

    new Setting(containerEl)
      .setName("Days ahead to fetch")
      .setDesc("How many days ahead to look in the event picker. (1–30)")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.max = "30";
        text.inputEl.step = "1";
        text.inputEl.style.width = "80px";
        text
          .setValue(String(this.plugin.settings.daysAhead))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num >= 1 && num <= 30) {
              this.plugin.settings.daysAhead = num;
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(containerEl)
      .setName("Max events to show")
      .setDesc("Maximum events shown in the event picker. (1–50)")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.max = "50";
        text.inputEl.step = "1";
        text.inputEl.style.width = "80px";
        text
          .setValue(String(this.plugin.settings.maxEvents))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num >= 1 && num <= 50) {
              this.plugin.settings.maxEvents = num;
              await this.plugin.saveSettings();
            }
          });
      });

    // ----- Manual Refresh ---------------------------------------------------
    containerEl.createEl("h3", { text: "Manual Refresh" });

    new Setting(containerEl)
      .setName("Refresh now")
      .setDesc(
        `Immediately fetch events in the next ${this.plugin.settings.hoursInAdvance} hour` +
          `${this.plugin.settings.hoursInAdvance !== 1 ? "s" : ""} and create any missing notes.`
      )
      .addButton((button) =>
        button
          .setButtonText("Refresh")
          .setCta()
          .onClick(async () => {
            button.setButtonText("Refreshing…").setDisabled(true);
            await this.plugin.autoCreateUpcomingNotes(true);
            button.setButtonText("Refresh").setDisabled(false);
          })
      );
  }
}
