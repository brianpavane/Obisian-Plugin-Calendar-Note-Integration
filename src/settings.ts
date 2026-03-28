import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type GoogleCalendarPlugin from "./main";
import { GoogleAuth } from "./googleAuth";

export interface GoogleCalendarSettings {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number;
  calendarId: string;
  noteFolder: string;
  daysAhead: number;
  maxEvents: number;
  /** Hours before an event starts that a note is auto-created. Default: 12 */
  hoursInAdvance: number;
  /** How often (in minutes) the plugin polls for upcoming events. Default: 30 */
  pollIntervalMinutes: number;
}

export const DEFAULT_SETTINGS: GoogleCalendarSettings = {
  clientId: "",
  clientSecret: "",
  accessToken: "",
  refreshToken: "",
  tokenExpiry: 0,
  calendarId: "primary",
  noteFolder: "Meeting Notes",
  daysAhead: 7,
  maxEvents: 20,
  hoursInAdvance: 12,
  pollIntervalMinutes: 30,
};

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

    // Setup instructions
    const instructions = containerEl.createEl("div", {
      cls: "gcal-instructions",
    });
    instructions.createEl("p", {
      text: "To use this plugin, you need a Google Cloud Console project with the Google Calendar API enabled and OAuth 2.0 credentials.",
    });
    const ol = instructions.createEl("ol");
    ol.createEl("li", {
      text: 'Go to console.cloud.google.com and create a new project (or select an existing one)',
    });
    ol.createEl("li", { text: 'Enable the "Google Calendar API" for your project' });
    ol.createEl("li", {
      text: 'Under "Credentials", create an OAuth 2.0 Client ID — choose "Desktop app" as the application type',
    });
    ol.createEl("li", {
      text: "Copy the Client ID and Client Secret into the fields below, then click Authenticate",
    });

    containerEl.createEl("h3", { text: "Google API Credentials" });

    new Setting(containerEl)
      .setName("Client ID")
      .setDesc("OAuth 2.0 Client ID from Google Cloud Console")
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
      .setDesc("OAuth 2.0 Client Secret from Google Cloud Console")
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

    // Auth status
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
          ? "Re-authenticate to refresh your credentials"
          : "Connect your Google account to allow calendar access"
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
                "Please enter your Client ID and Client Secret first."
              );
              return;
            }

            button.setButtonText("Opening browser...").setDisabled(true);

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
              this.display();
            } catch (e) {
              new Notice(`Authentication failed: ${e.message}`);
              button.setButtonText("Authenticate").setDisabled(false);
            }
          })
      );

    if (isAuthenticated) {
      new Setting(containerEl)
        .setName("Disconnect Google account")
        .setDesc("Remove stored credentials and revoke access")
        .addButton((button) =>
          button
            .setButtonText("Disconnect")
            .setWarning()
            .onClick(async () => {
              this.plugin.settings.accessToken = "";
              this.plugin.settings.refreshToken = "";
              this.plugin.settings.tokenExpiry = 0;
              await this.plugin.saveSettings();
              new Notice("Disconnected from Google.");
              this.display();
            })
        );
    }

    containerEl.createEl("h3", { text: "Calendar Settings" });

    new Setting(containerEl)
      .setName("Calendar ID")
      .setDesc(
        'Calendar to fetch events from. Use "primary" for your main calendar, or enter a specific calendar email/ID.'
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
      .setDesc("How many days ahead to look for events (1–30)")
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
      .setDesc("Maximum number of events to display when picking (1–50)")
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

    containerEl.createEl("h3", { text: "Note Settings" });

    new Setting(containerEl)
      .setName("Note folder")
      .setDesc(
        "Folder where meeting notes will be created. Leave empty to use the vault root."
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
        "Notes are also created on startup for any events within this window. (1–48 hours)"
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
        "How often the plugin checks for events that need a note created. (5–120 minutes)"
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
