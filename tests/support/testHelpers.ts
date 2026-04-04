import { TFile, TFolder, type App } from "./obsidianStub";
import type { CalendarEvent } from "../../src/calendarApi";

export function buildEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    summary: "Team Sync",
    description: "Agenda item",
    start: { dateTime: "2026-04-03T10:00:00-04:00" },
    end: { dateTime: "2026-04-03T11:00:00-04:00" },
    attendees: [],
    ...overrides,
  };
}

export function createMemoryApp(initialFiles: Array<{ path: string; content?: string }> = []): App & {
  files: Map<string, TFile | TFolder>;
  createdPaths: string[];
  openedFiles: string[];
} {
  const files = new Map<string, TFile | TFolder>();
  const createdPaths: string[] = [];
  const openedFiles: string[] = [];

  for (const entry of initialFiles) {
    const file = new TFile(entry.path);
    file.content = entry.content ?? "";
    files.set(entry.path, file);
  }

  const app: App & {
    files: Map<string, TFile | TFolder>;
    createdPaths: string[];
    openedFiles: string[];
  } = {
    files,
    createdPaths,
    openedFiles,
    vault: {
      getAllLoadedFiles: () => Array.from(files.values()),
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      createFolder: async (path: string) => {
        files.set(path, new TFolder(path));
      },
      create: async (path: string, content: string) => {
        const file = new TFile(path);
        file.content = content;
        files.set(path, file);
        createdPaths.push(path);
        return file;
      },
    },
    workspace: {
      getLeaf: () => ({
        openFile: async (file: TFile) => {
          openedFiles.push(file.path);
        },
      }),
    },
  };

  return app;
}
