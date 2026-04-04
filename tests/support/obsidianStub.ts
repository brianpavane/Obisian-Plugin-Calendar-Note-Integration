export class TFile {
  path: string;
  name: string;
  content?: string;

  constructor(path: string) {
    this.path = path;
    this.name = path.split("/").pop() ?? path;
  }
}

export class TFolder {
  path: string;

  constructor(path: string) {
    this.path = path;
  }
}

type RequestUrlResponse = {
  status: number;
  text: string;
  json?: unknown;
};

type RequestUrlOptions = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  throw?: boolean;
};

let requestUrlMock: (options: RequestUrlOptions) => Promise<RequestUrlResponse> =
  async () => ({
    status: 200,
    text: "",
    json: {},
  });

const notices: Array<{ message: string; timeout?: number }> = [];

export function setRequestUrlMock(
  mock: (options: RequestUrlOptions) => Promise<RequestUrlResponse>
): void {
  requestUrlMock = mock;
}

export async function requestUrl(
  options: RequestUrlOptions
): Promise<RequestUrlResponse> {
  return requestUrlMock(options);
}

export function resetObsidianTestState(): void {
  notices.length = 0;
  requestUrlMock = async () => ({
    status: 200,
    text: "",
    json: {},
  });
}

export function getNotices(): Array<{ message: string; timeout?: number }> {
  return [...notices];
}

export class Notice {
  message: string;
  timeout?: number;
  hidden = false;

  constructor(message: string, timeout?: number) {
    this.message = message;
    this.timeout = timeout;
    notices.push({ message, timeout });
  }

  hide(): void {
    this.hidden = true;
  }
}

export class Plugin {
  app: App;
  manifest: { version: string };
  private storedData: unknown;

  constructor(app?: App, manifest?: { version?: string }) {
    this.app = app ?? ({} as App);
    this.manifest = { version: manifest?.version ?? "test" };
    this.storedData = {};
  }

  addRibbonIcon(): void {}
  addCommand(): void {}
  addSettingTab(): void {}
  registerInterval(): void {}

  async loadData(): Promise<unknown> {
    return this.storedData;
  }

  async saveData(data: unknown): Promise<void> {
    this.storedData = data;
  }
}

export class Modal {
  app: App;
  contentEl = createFakeEl();

  constructor(app: App) {
    this.app = app;
  }

  open(): void {}
  close(): void {}
}

export class PluginSettingTab {
  app: App;
  plugin: Plugin;
  containerEl = createFakeEl();

  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
  }
}

export class AbstractInputSuggest<T> {
  app: App;
  inputEl: HTMLInputElement;

  constructor(app: App, inputEl: HTMLInputElement) {
    this.app = app;
    this.inputEl = inputEl;
  }

  setValue(value: string): void {
    this.inputEl.value = value;
  }

  close(): void {}
}

export class ToggleComponent {}

export class Setting {
  constructor(public containerEl: unknown) {}

  setName(): this { return this; }
  setDesc(): this { return this; }
  addDropdown(cb: (dropdown: FakeDropdown) => void): this {
    cb(new FakeDropdown());
    return this;
  }
  addText(cb: (text: FakeTextComponent) => void): this {
    cb(new FakeTextComponent());
    return this;
  }
  addButton(cb: (button: FakeButtonComponent) => void): this {
    cb(new FakeButtonComponent());
    return this;
  }
  addToggle(cb: (toggle: FakeToggleComponent) => void): this {
    cb(new FakeToggleComponent());
    return this;
  }
}

export class FuzzySuggestModal<T> extends Modal {
  setPlaceholder(): void {}
  setInstructions(): void {}
  getItems(): T[] { return []; }
  getItemText(): string { return ""; }
  onChooseItem(): void {}
  renderSuggestion(): void {}
}

export interface App {
  vault: {
    getAllLoadedFiles?: () => Array<TFile | TFolder>;
    getAbstractFileByPath: (path: string) => unknown;
    createFolder: (path: string) => Promise<void>;
    create: (path: string, content: string) => Promise<TFile>;
  };
  workspace: {
    getLeaf: (newLeaf?: boolean) => { openFile: (file: TFile) => Promise<void> };
  };
}

export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/(^|\/)\.\//g, "$1")
    .replace(/\/$/, "");
}

class FakeDropdown {
  addOption(): this { return this; }
  setValue(): this { return this; }
  onChange(): this { return this; }
}

class FakeTextComponent {
  inputEl = { type: "text", style: {}, value: "", dispatchEvent() {} } as unknown as HTMLInputElement;
  setPlaceholder(): this { return this; }
  setValue(): this { return this; }
  onChange(): this { return this; }
}

class FakeButtonComponent {
  setButtonText(): this { return this; }
  setCta(): this { return this; }
  setWarning(): this { return this; }
  setDisabled(): this { return this; }
  onClick(): this { return this; }
}

class FakeToggleComponent {
  setValue(): this { return this; }
  onChange(): this { return this; }
}

function createFakeEl() {
  return {
    style: {},
    empty() {},
    setText() {},
    createEl() { return createFakeEl(); },
    createDiv() { return createFakeEl(); },
    createSpan() { return createFakeEl(); },
  };
}
