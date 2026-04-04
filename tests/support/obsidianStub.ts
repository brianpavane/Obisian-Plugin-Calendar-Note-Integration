export class TFile {
  path: string;
  name: string;

  constructor(path: string) {
    this.path = path;
    this.name = path.split("/").pop() ?? path;
  }
}

export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/(^|\/)\.\//g, "$1")
    .replace(/\/$/, "");
}
