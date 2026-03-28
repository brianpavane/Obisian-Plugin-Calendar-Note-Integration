/**
 * @file settings.ts
 * @description Plugin settings interface, defaults, and the Obsidian settings
 * tab UI for Google Calendar Note Integration.
 */

import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type GoogleCalendarPlugin from "./main";
import { GoogleAuth } from "./googleAuth";

// ---------------------------------------------------------------------------
// Settings interface & defaults
// ---------------------------------------------------------------------------

/**
 * All persisted configuration for the plugin.
 *
 * Stored by Obsidian in `.obsidian/plugins/obsidian-google-calendar-notes/data.json`.
 * Token fields are stored in plaintext — this is standard practice for
 * Obsidian plugins and is acceptable because the file is only readable by
 * the local user account.
 */
export interface GoogleCalendarSettings {
  // -- Google API credentials ------------------------------------------------

  /** OAuth 2.0 Client ID from Google Cloud Console. */
  clientId: string;
  /** OAuth 2.0 Client Secret from Google Cloud Console. */
  clientSecret: string;

  // -- Token storage (managed by the plugin, not user-facing) ----------------

  /** Current short-lived access token. Refreshed automatically. */
  accessToken: string;
  /** Long-lived refresh token used to obtain new access tokens. */
  refreshToken: string;
  /** Unix timestamp (ms) at which `accessToken` expires. */
  tokenExpiry: number;

  // -- Calendar options ------------------------------------------------------

  /**
   * Calendar ID to fetch events from.
   * Use `"primary"` for the user's default calendar, or a specific
   * calendar email address / opaque ID.
   */
  calendarId: string;

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
}

/**
 * Default values applied when the plugin is first installed or when a setting
 * key is absent from the stored data (e.g. after a plugin update adds a new
 * setting).
 */
export const DEFAULT_SETTINGS: GoogleCalendarSettings = {
  clientId: "",
  clientSecret: "",
  accessToken: "",
  refreshToken: "",
  tokenExpiry: 0,
  calendarId: "primary",
  daysAhead: 7,
  maxEvents: 20,
  noteFolder: "Meeting Notes",
  hoursInAdvance: 12,
  pollIntervalMinutes: 30,
};

// ---------------------------------------------------------------------------
// Settings tab UI
// ---------------------------------------------------------------------------

/**
 * Renders the plugin settings page inside Obsidian's Settings modal.
 *
 * Sections:
 *   1. Google API Credentials — Client ID, Client Secret, Auth button
 *   2. Calendar Settings      — Calendar ID, days ahead, max events
 *   3. Note Settings          — Folder, hours in advance, poll interval
 */
export class GoogleCalendarSettingTab extends PluginSettingTab {
  plugin: GoogleCalendarPlugin;

  constructor(app: App, plugin: GoogleCalendarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * (Re-)render the settings tab.
   * Called by Obsidian when the tab is opened and by the plugin after
   * the authentication state changes (to update the auth status indicator).
   */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Google Calendar Note Integration" });

    // ----- Setup instructions -----------------------------------------------
    const instructions = containerEl.createEl("div", {
      cls: "gcal-instructions",
    });
    instructions.createEl("p", {
      text: "To connect this plugin to Google Calendar you need an OAuth 2.0 client credential from Google Cloud Console.",
    });
    const ol = instructions.createEl("ol");
    ol.createEl("li", {
      text: "Go to console.cloud.google.com and create or select a project.",
    });
    ol.createEl("li", {
      text: 'Enable the "Google Calendar API" for your project.',
    });
    ol.createEl("li", {
      text: 'Under "Credentials", create an OAuth 2.0 Client ID — choose "Desktop app" as the application type.',
    });
    ol.createEl("li", {
      text: "Paste the Client ID and Client Secret into the fields below, then click Authenticate.",
    });

    // ----- Google API Credentials -------------------------------------------
    containerEl.createEl("h3", { text: "Google API Credentials" });

    new Setting(containerEl)
      .setName("Client ID")
      .setDesc("OAuth 2.0 Client ID (ends in .apps.googleusercontent.com).")
      .addText((text) =>
        text
          .setPlaceholder("your-client-id.apps.googleusercontent.com")
          .setValue(this.plugin.settings.clientId)
          .onChange(async (value) => {
            this.plugin.settings.clientId = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Client Secret")
      .setDesc("OAuth 2.0 Client Secret — treated as a password.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("Client secret")
          .setValue(this.plugin.settings.clientSecret)
          .onChange(async (value) => {
            this.plugin.settings.clientSecret = value.trim();
            await this.plugin.saveSettings();
          });
      });

    // Authentication status indicator
    const isAuthenticated = !!this.plugin.settings.accessToken;
    const authStatus = containerEl.createEl("div", { cls: "gcal-auth-status" });
    authStatus.createEl("p", {
      text: isAuthenticated
        ? "✓ Authenticated with Google"
        : "✗ Not authenticated",
      cls: isAuthenticated ? "gcal-status-ok" : "gcal-status-error",
    });

    new Setting(containerEl)
      .setName("Authenticate with Google")
      .setDesc(
        isAuthenticated
          ? "Re-authenticate to renew your credentials (e.g. after changing Client ID/Secret)."
          : "Opens your browser to a Google sign-in page. Returns here automatically."
      )
      .addButton((button) =>
        button
          .setButtonText(isAuthenticated ? "Re-authenticate" : "Authenticate")
          .setCta()
          .onClick(async () => {
            if (
              !this.plugin.settings.clientId ||
              !this.plugin.settings.clientSecret
            ) {
              new Notice(
                "Please enter your Client ID and Client Secret before authenticating."
              );
              return;
            }

            button.setButtonText("Opening browser…").setDisabled(true);

            try {
              const auth = new GoogleAuth(
                this.plugin.settings.clientId,
                this.plugin.settings.clientSecret
              );
              const tokens = await auth.authorize();

              this.plugin.settings.accessToken = tokens.access_token;
              this.plugin.settings.refreshToken = tokens.refresh_token;
              this.plugin.settings.tokenExpiry = tokens.expiry_date;
              await this.plugin.saveSettings();

              new Notice("Successfully authenticated with Google!");
              this.display(); // refresh the tab to show the new auth status
            } catch (e) {
              new Notice(
                `Authentication failed: ${(e as Error).message}`
              );
              button.setButtonText("Authenticate").setDisabled(false);
            }
          })
      );

    if (isAuthenticated) {
      new Setting(containerEl)
        .setName("Disconnect Google account")
        .setDesc(
          "Revoke the plugin's Google Calendar access and remove stored tokens. " +
            "You will need to re-authenticate to use the plugin again."
        )
        .addButton((button) =>
          button
            .setButtonText("Disconnect")
            .setWarning()
            .onClick(async () => {
              button.setButtonText("Disconnecting…").setDisabled(true);

              // Revoke the refresh token at Google's endpoint first so the
              // authorisation is fully removed server-side, not just locally.
              if (this.plugin.settings.refreshToken) {
                const auth = new GoogleAuth(
                  this.plugin.settings.clientId,
                  this.plugin.settings.clientSecret
                );
                await auth.revokeToken(this.plugin.settings.refreshToken);
              }

              this.plugin.settings.accessToken = "";
              this.plugin.settings.refreshToken = "";
              this.plugin.settings.tokenExpiry = 0;
              await this.plugin.saveSettings();
              new Notice("Disconnected from Google.");
              this.display();
            })
        );
    }

    // ----- Calendar Settings ------------------------------------------------
    containerEl.createEl("h3", { text: "Calendar Settings" });

    new Setting(containerEl)
      .setName("Calendar ID")
      .setDesc(
        'Calendar to fetch events from. Use "primary" for your default calendar, ' +
          "or enter a specific calendar's email address / ID."
      )
      .addText((text) =>
        text
          .setPlaceholder("primary")
          .setValue(this.plugin.settings.calendarId)
          .onChange(async (value) => {
            this.plugin.settings.calendarId = value.trim() || "primary";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Days ahead to fetch")
      .setDesc(
        "How many days ahead to look when showing the event picker (1–30)."
      )
      .addSlider((slider) =>
        slider
          .setLimits(1, 30, 1)
          .setValue(this.plugin.settings.daysAhead)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.daysAhead = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Max events to show")
      .setDesc(
        "Maximum number of events displayed in the event picker (1–50)."
      )
      .addSlider((slider) =>
        slider
          .setLimits(1, 50, 1)
          .setValue(this.plugin.settings.maxEvents)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxEvents = value;
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
      .addText((text) =>
        text
          .setPlaceholder("Meeting Notes")
          .setValue(this.plugin.settings.noteFolder)
          .onChange(async (value) => {
            this.plugin.settings.noteFolder = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Hours in advance")
      .setDesc(
        "How many hours before an event starts to automatically create its note. " +
          "Notes are also created at startup for any events already within this window. (1–48 hours)"
      )
      .addSlider((slider) =>
        slider
          .setLimits(1, 48, 1)
          .setValue(this.plugin.settings.hoursInAdvance)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.hoursInAdvance = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Poll interval (minutes)")
      .setDesc(
        "How often the plugin checks for events that need a note created. " +
          "Takes effect after the next Obsidian restart. (5–120 minutes)"
      )
      .addSlider((slider) =>
        slider
          .setLimits(5, 120, 5)
          .setValue(this.plugin.settings.pollIntervalMinutes)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.pollIntervalMinutes = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
