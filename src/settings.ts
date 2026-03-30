/**
 * @file settings.ts
 * @description Plugin settings interface, defaults, and the Obsidian settings
 * tab UI for Google Calendar Note Integration (iCal mode).
 *
 * This version replaces the previous OAuth-based settings (clientId,
 * clientSecret, tokens) with a single iCal URL — the "Secret address in
 * iCal format" from Google Calendar. No Google Cloud Console project or
 * API credentials are required.
 */

import { AbstractInputSuggest, App, Notice, PluginSettingTab, Setting, TFolder } from "obsidian";
import type GoogleCalendarPlugin from "./main";
import { IcalCalendarApi } from "./calendarApi";

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
  // -- Calendar connection ---------------------------------------------------

  /**
   * Google Calendar "Secret address in iCal format".
   * Found in Google Calendar → Settings → [calendar] → Integrate calendar.
   * Treat this URL as a password: it grants read access to your calendar
   * without requiring sign-in. It is stored in plaintext in data.json but
   * only provides read-only access.
   */
  icalUrl: string;

  // -- Personal identity -----------------------------------------------------

  /**
   * The user's own Google account email address (lowercase).
   * When set, the matching attendee entry is hidden from the generated
   * attendees table so you don't appear as a participant in your own notes.
   * Optional — leave blank to show all attendees including yourself.
   */
  selfEmail: string;

  // -- Note options ----------------------------------------------------------

  /**
   * Vault-relative folder where new notes are created.
   * Pass `""` to create notes in the vault root.
   */
  noteFolder: string;

  /**
   * How many hours before an event starts to automatically create its note.
   * The same window is used at startup and during polling.
   * Range: 1–48.
   */
  hoursInAdvance: number;

  /**
   * How often (in minutes) the plugin polls for events that need a note.
   * Changing this setting takes effect after the next Obsidian restart.
   * Range: 5–120.
   */
  pollIntervalMinutes: number;

  // -- Event picker options --------------------------------------------------

  /**
   * How many days ahead to search when showing the event picker.
   * Range: 1–30.
   */
  daysAhead: number;

  /**
   * Maximum number of events to display in the picker.
   * Range: 1–50.
   */
  maxEvents: number;
}

/**
 * Default values applied when the plugin is first installed or when a setting
 * key is absent (e.g. after an upgrade that adds a new setting).
 */
export const DEFAULT_SETTINGS: GoogleCalendarSettings = {
  icalUrl: "",
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
  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
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

    // ----- Google Calendar Connection ---------------------------------------
    containerEl.createEl("h3", { text: "Google Calendar Connection" });

    const helpDiv = containerEl.createEl("div", { cls: "gcal-instructions" });
    helpDiv.createEl("p", {
      text: "Connect using your Google Calendar's private iCal URL — no API keys or Google Cloud setup required.",
    });
    const ol = helpDiv.createEl("ol");
    ol.createEl("li", { text: "Open Google Calendar in your browser (calendar.google.com)." });
    ol.createEl("li", {
      text: 'In the left sidebar, click the three-dot menu (⋮) next to the calendar you want to use.',
    });
    ol.createEl("li", { text: 'Select "Settings and sharing".' });
    ol.createEl("li", { text: 'Scroll down to the "Integrate calendar" section.' });
    ol.createEl("li", { text: 'Copy the "Secret address in iCal format" URL (ends in .ics).' });
    ol.createEl("li", { text: "Paste it into the field below and click Test." });

    // Connection status indicator
    const isConnected = !!this.plugin.settings.icalUrl;
    const statusEl = containerEl.createEl("div", { cls: "gcal-auth-status" });
    statusEl.createEl("p", {
      text: isConnected ? "✓ iCal URL configured" : "✗ No iCal URL configured",
      cls: isConnected ? "gcal-status-ok" : "gcal-status-error",
    });

    new Setting(containerEl)
      .setName("iCal URL")
      .setDesc(
        'The "Secret address in iCal format" from Google Calendar → Settings → Integrate calendar. ' +
          "Treat this URL as a password — anyone with it can read your calendar."
      )
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
      .setDesc(
        "Verify the iCal URL is reachable and returns valid calendar data. " +
          "Reports the number of events found in the feed."
      )
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
              new Notice(
                `✓ Connected! Found ${events.length} event${events.length !== 1 ? "s" : ""} in the feed.`
              );
              this.display(); // refresh to update the status indicator
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              new Notice(
                `Connection failed: ${msg.replace(/[\r\n]+/g, " ").slice(0, 200)}`
              );
            } finally {
              button.setButtonText("Test").setDisabled(false);
            }
          })
      );

    // ----- Personal Settings ------------------------------------------------
    containerEl.createEl("h3", { text: "Personal Settings" });

    new Setting(containerEl)
      .setName("Your email address")
      .setDesc(
        "Your Google account email. When set, your own entry is hidden from the attendees " +
          "table in generated notes so you do not appear as a participant in your own meeting notes. " +
          "Leave blank to show all attendees."
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
      .setDesc(
        "Vault folder where meeting notes are created. " +
          "Leave empty to create notes in the vault root."
      )
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
      .setDesc(
        "How many hours before an event starts to automatically create its note. " +
          "Notes are also created at startup for events already within this window. (1–48 hours)"
      )
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
      .setDesc(
        "How often the plugin checks for events that need a note. " +
          "Takes effect after the next Obsidian restart. (5–120 minutes)"
      )
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
      .setDesc(
        "How many days ahead to look when showing the event picker. (1–30)"
      )
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
      .setDesc(
        "Maximum number of events displayed in the event picker. (1–50)"
      )
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
        `Immediately fetch events starting within the next ` +
          `${this.plugin.settings.hoursInAdvance} hour${this.plugin.settings.hoursInAdvance !== 1 ? "s" : ""} ` +
          "and create any missing notes. Equivalent to waiting for the next scheduled poll."
      )
      .addButton((button) =>
        button
          .setButtonText("Refresh")
          .setCta()
          .onClick(async () => {
            if (!this.plugin.settings.icalUrl) {
              new Notice(
                "Google Calendar: Please configure your iCal URL first."
              );
              return;
            }
            button.setButtonText("Refreshing…").setDisabled(true);
            await this.plugin.autoCreateUpcomingNotes(true);
            button.setButtonText("Refresh").setDisabled(false);
          })
      );
  }
}
