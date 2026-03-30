/**
 * @file settings.ts
 * @description Plugin settings interface, defaults, and the Obsidian settings
 * tab UI for Google Calendar Note Integration.
 *
 * Supports three authentication modes:
 *   - "ical"  — iCal secret URL, no account required (personal calendars)
 *   - "oauth" — Google OAuth 2.0 via REST API (organization/work calendars)
 *   - "apple" — Apple Calendar on macOS via JXA (no auth required)
 */

import {
  AbstractInputSuggest,
  App,
  Modal,
  Notice,
  PluginSettingTab,
  Setting,
  TFolder,
  ToggleComponent,
} from "obsidian";
import type GoogleCalendarPlugin from "./main";
import { IcalCalendarApi, GoogleCalendarApi } from "./calendarApi";
import { GoogleAuth } from "./googleAuth";
import { encrypt, decrypt } from "./secureStorage";
import { listAppleCalendars, runAppleCalendarDiagnostic } from "./appleCalendarApi";

// ---------------------------------------------------------------------------
// Settings interface & defaults
// ---------------------------------------------------------------------------

export interface GoogleCalendarSettings {
  authMode: "ical" | "oauth" | "apple";
  icalUrl: string;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number;
  calendarId: string;
  appleCalendars: string;
  selfEmail: string;
  noteFolder: string;
  hoursInAdvance: number;
  pollIntervalMinutes: number;
  includePastEvents: boolean;
  daysBack: number;
  includeEventNotes: boolean;
  includeConferenceLinks: boolean;
  datePosition: "before" | "after";
  daysAhead: number;
  maxEvents: number;
}

export const DEFAULT_SETTINGS: GoogleCalendarSettings = {
  authMode: "ical",
  icalUrl: "",
  clientId: "",
  clientSecret: "",
  accessToken: "",
  refreshToken: "",
  tokenExpiry: 0,
  calendarId: "primary",
  appleCalendars: "",
  selfEmail: "",
  noteFolder: "Meeting Notes",
  hoursInAdvance: 12,
  pollIntervalMinutes: 30,
  includePastEvents: false,
  daysBack: 1,
  includeEventNotes: true,
  includeConferenceLinks: false,
  datePosition: "before",
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
    this.el.dispatchEvent(new Event("input"));
    this.close();
  }
}

// ---------------------------------------------------------------------------
// Settings tab UI
// ---------------------------------------------------------------------------

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
          "Google Account is required for organization/work calendars that block external iCal access. " +
          "Apple Calendar reads directly from Calendar.app on macOS — no authentication required."
      )
      .addDropdown((drop) => {
        drop.addOption("ical", "iCal URL (personal / public calendars)");
        drop.addOption("oauth", "Google Account (organization / work calendars)");
        drop.addOption("apple", "Apple Calendar — macOS only (no auth required)");
        drop.setValue(this.plugin.settings.authMode);
        drop.onChange(async (value: string) => {
          this.plugin.settings.authMode = value as "ical" | "oauth" | "apple";
          await this.plugin.saveSettings();
          this.display();
        });
      });

    // ----- iCal Section -----------------------------------------------------
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

      const isConnected = !!decrypt(this.plugin.settings.icalUrl);
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
            .setValue(decrypt(this.plugin.settings.icalUrl))
            .onChange(async (value) => {
              this.plugin.settings.icalUrl = encrypt(value.trim());
              await this.plugin.saveSettings();
            });
        });

      new Setting(containerEl)
        .setName("Test connection")
        .setDesc("Verify the iCal URL returns valid calendar data.")
        .addButton((button) =>
          button.setButtonText("Test").setCta().onClick(async () => {
            const icalUrl = decrypt(this.plugin.settings.icalUrl);
            if (!icalUrl) {
              new Notice("Please enter an iCal URL first.");
              return;
            }
            button.setButtonText("Testing…").setDisabled(true);
            try {
              const api = new IcalCalendarApi(icalUrl);
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

    // ----- OAuth Section ----------------------------------------------------
    if (this.plugin.settings.authMode === "oauth") {
      containerEl.createEl("h3", { text: "Google Account" });

      const isAuthenticated = !!decrypt(this.plugin.settings.refreshToken);

      if (!isAuthenticated) {
        const helpDiv = containerEl.createEl("div");
        helpDiv.createEl("p", { text: "One-time setup: create OAuth credentials in Google Cloud Console." });
        const ol = helpDiv.createEl("ol");
        ol.createEl("li", { text: "Go to console.cloud.google.com and create (or open) a project." });
        ol.createEl("li", { text: 'Enable the "Google Calendar API" for the project.' });
        ol.createEl("li", { text: 'Go to APIs & Services → Credentials → Create Credentials → OAuth client ID.' });
        ol.createEl("li", { text: 'Set Application type to "Desktop app" and click Create.' });
        ol.createEl("li", { text: "Copy the Client ID and Client Secret into the fields below." });
        ol.createEl("li", { text: 'Click "Sign in with Google" to authorize the plugin.' });
      }

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
            .setValue(decrypt(this.plugin.settings.clientSecret))
            .onChange(async (value) => {
              this.plugin.settings.clientSecret = encrypt(value.trim());
              await this.plugin.saveSettings();
            });
        });

      if (!isAuthenticated) {
        new Setting(containerEl)
          .setName("Sign in with Google")
          .setDesc("Opens your browser to the Google authorization page. Enter Client ID and Client Secret first.")
          .addButton((button) =>
            button.setButtonText("Sign in with Google").setCta().onClick(async () => {
              if (!this.plugin.settings.clientId || !decrypt(this.plugin.settings.clientSecret)) {
                new Notice("Please enter your Client ID and Client Secret first.");
                return;
              }
              button.setButtonText("Waiting for browser…").setDisabled(true);
              try {
                const auth = new GoogleAuth(
                  this.plugin.settings.clientId,
                  decrypt(this.plugin.settings.clientSecret)
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
            button.setButtonText("Disconnect").setWarning().onClick(async () => {
              try {
                const auth = new GoogleAuth(
                  this.plugin.settings.clientId,
                  decrypt(this.plugin.settings.clientSecret)
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
            'Which calendar to fetch. Use "primary" for your main calendar, ' +
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
            button.setButtonText("Test").setCta().onClick(async () => {
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

    // ----- Apple Calendar Section -------------------------------------------
    if (this.plugin.settings.authMode === "apple") {
      containerEl.createEl("h3", { text: "Apple Calendar" });

      containerEl.createEl("p", {
        text: "Events are read directly from Calendar.app on this Mac. " +
          "All accounts already synced in Calendar.app (Google, iCloud, Exchange) " +
          "are available — no extra authentication needed.",
      });
      containerEl.createEl("p", {
        text: "Required permission: System Settings → Privacy & Security → Calendars → " +
          "set Obsidian to Full Calendar Access (not Add Only). " +
          "Add Only access cannot read events and will cause timeouts.",
      });

      containerEl.createEl("h4", { text: "Calendar Selection" });
      containerEl.createEl("p", {
        text: "Select which calendars to include. Uncheck all to include every calendar.",
      });

      const calContainer = containerEl.createDiv();
      const loadingEl = calContainer.createEl("p", { text: "Loading calendars from Calendar.app…" });
      loadingEl.style.fontStyle = "italic";

      listAppleCalendars()
        .then((calendars) => {
          loadingEl.remove();

          if (calendars.length === 0) {
            calContainer.createEl("p", {
              text: "No calendars found. Ensure Obsidian is set to Full Calendar Access " +
                "(not Add Only) in System Settings → Privacy & Security → Calendars.",
            });
            return;
          }

          const selectedSet = new Set(
            this.plugin.settings.appleCalendars
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          );
          const allSelected = selectedSet.size === 0;
          const toggleMap = new Map<string, ToggleComponent>();

          const saveSelection = async (): Promise<void> => {
            const checked = Array.from(toggleMap.entries())
              .filter(([, t]) => t.getValue())
              .map(([name]) => name);
            this.plugin.settings.appleCalendars =
              checked.length === calendars.length ? "" : checked.join(", ");
            await this.plugin.saveSettings();
          };

          for (const cal of calendars) {
            new Setting(calContainer).setName(cal.name).addToggle((toggle) => {
              toggleMap.set(cal.name, toggle);
              toggle
                .setValue(allSelected || selectedSet.has(cal.name))
                .onChange(() => saveSelection());
            });
          }
        })
        .catch((err) => {
          loadingEl.remove();
          const msg = err instanceof Error ? err.message : String(err);
          calContainer.createEl("p", { text: `Could not load calendars: ${msg.slice(0, 200)}` });
          new Setting(calContainer)
            .setName("Calendar filter (manual)")
            .setDesc("Comma-separated calendar names. Leave empty to include all.")
            .addText((text) => {
              text.inputEl.style.width = "100%";
              text
                .setPlaceholder("Work, Personal")
                .setValue(this.plugin.settings.appleCalendars)
                .onChange(async (value) => {
                  this.plugin.settings.appleCalendars = value;
                  await this.plugin.saveSettings();
                });
            });
        });

      new Setting(containerEl)
        .setName("Run diagnostics")
        .setDesc(
          "Three-step check: JXA execution → list calendars → short event fetch. " +
          "Results are shown here and also logged in detail to the developer console " +
          "(Ctrl+Shift+I → Console tab). Run this first if Test hangs."
        )
        .addButton((button) =>
          button.setButtonText("Run Diagnostics").onClick(async () => {
            button.setButtonText("Running…").setDisabled(true);
            try {
              const report = await runAppleCalendarDiagnostic();
              new DiagnosticModal(this.app, report).open();
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              new DiagnosticModal(this.app, `Diagnostic error:\n\n${msg}`).open();
            } finally {
              button.setButtonText("Run Diagnostics").setDisabled(false);
            }
          })
        );

      new Setting(containerEl)
        .setName("Test connection")
        .setDesc("Fetch upcoming events from Calendar.app to verify access is working.")
        .addButton((button) =>
          button.setButtonText("Test").setCta().onClick(async () => {
            button.setButtonText("Testing…").setDisabled(true);
            try {
              const svc = await this.plugin.getCalendarService();
              const events = await svc.fetchAllEvents();
              new Notice(
                `✓ Connected! Found ${events.length} upcoming event${events.length !== 1 ? "s" : ""} in Calendar.app.`,
                5000
              );
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              new Notice(`Connection failed: ${msg.slice(0, 300)}`, 10000);
            } finally {
              button.setButtonText("Test").setDisabled(false);
            }
          })
        );
    }

    // ----- Personal Settings ------------------------------------------------
    containerEl.createEl("h3", { text: "Personal Settings" });

    new Setting(containerEl)
      .setName("Your email address")
      .setDesc(
        "Your calendar account email. When set, your own entry is hidden from the attendees " +
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

    new Setting(containerEl)
      .setName("Include past events")
      .setDesc(
        "When enabled, also auto-creates notes for events that have already started " +
          "within the lookback window below."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includePastEvents)
          .onChange(async (value) => {
            this.plugin.settings.includePastEvents = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.includePastEvents) {
      new Setting(containerEl)
        .setName("Days back to look")
        .setDesc("How many days in the past to create notes for. (1–30)")
        .addText((text) => {
          text.inputEl.type = "number";
          text.inputEl.min = "1";
          text.inputEl.max = "30";
          text.inputEl.step = "1";
          text.inputEl.style.width = "80px";
          text
            .setValue(String(this.plugin.settings.daysBack))
            .onChange(async (value) => {
              const num = parseInt(value, 10);
              if (!isNaN(num) && num >= 1 && num <= 30) {
                this.plugin.settings.daysBack = num;
                await this.plugin.saveSettings();
              }
            });
        });
    }

    // ----- Note Contents ----------------------------------------------------
    containerEl.createEl("h3", { text: "Note Contents" });

    new Setting(containerEl)
      .setName("Include event notes / agenda")
      .setDesc(
        "When enabled, the event's description is included as the Agenda section in the generated note."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeEventNotes)
          .onChange(async (value) => {
            this.plugin.settings.includeEventNotes = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Include conference link")
      .setDesc(
        "When enabled, video conference links (Google Meet, Zoom, Microsoft Teams) are extracted " +
          "and included in the note."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeConferenceLinks)
          .onChange(async (value) => {
            this.plugin.settings.includeConferenceLinks = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Date position in filename")
      .setDesc("Where the date appears in the generated note's filename.")
      .addDropdown((drop) => {
        drop.addOption("before", "Before name — 2026-03-30 - Meeting Title");
        drop.addOption("after", "After name — Meeting Title - 2026-03-30");
        drop.setValue(this.plugin.settings.datePosition);
        drop.onChange(async (value: string) => {
          this.plugin.settings.datePosition = value as "before" | "after";
          await this.plugin.saveSettings();
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
      .setDesc("Immediately fetch events and create any missing notes.")
      .addButton((button) =>
        button.setButtonText("Refresh").setCta().onClick(async () => {
          button.setButtonText("Refreshing…").setDisabled(true);
          await this.plugin.autoCreateUpcomingNotes(true);
          button.setButtonText("Refresh").setDisabled(false);
        })
      );
  }
}

// ---------------------------------------------------------------------------
// Diagnostic result modal
// ---------------------------------------------------------------------------

class DiagnosticModal extends Modal {
  private report: string;

  constructor(app: App, report: string) {
    super(app);
    this.report = report;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Apple Calendar Diagnostic" });

    const pre = contentEl.createEl("pre");
    pre.setText(this.report);
    Object.assign(pre.style, {
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      maxHeight: "60vh",
      overflowY: "auto",
      fontFamily: "var(--font-monospace)",
      fontSize: "12px",
      lineHeight: "1.5",
      padding: "8px",
      background: "var(--background-secondary)",
      borderRadius: "4px",
      userSelect: "text",
    });

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("Copy to Clipboard").onClick(async () => {
          await navigator.clipboard.writeText(this.report);
          new Notice("Diagnostic report copied to clipboard.");
        })
      )
      .addButton((btn) =>
        btn.setButtonText("Close").setCta().onClick(() => this.close())
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
