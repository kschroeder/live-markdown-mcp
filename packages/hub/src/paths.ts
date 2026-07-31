import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP_DIR_NAME } from "@markdown-mcp/shared";

export function getAppDir(): string {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, APP_DIR_NAME);
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", APP_DIR_NAME);
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdg, APP_DIR_NAME);
}

export function ensureAppDir(): string {
  const dir = getAppDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function hubStatePath(): string {
  return path.join(getAppDir(), "hub.json");
}

export function hubLockPath(): string {
  return path.join(getAppDir(), "hub.lock");
}

export function settingsPath(): string {
  return path.join(getAppDir(), "settings.json");
}

/** Normalize for comparisons on Windows. */
export function normalizePath(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function displayName(filePath: string): string {
  return path.basename(filePath);
}

export function isPathAllowed(filePath: string, allowedRoots: string[]): boolean {
  if (!allowedRoots.length) return true;
  const target = normalizePath(filePath);
  return allowedRoots.some((root) => {
    const r = normalizePath(root);
    return target === r || target.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
  });
}
