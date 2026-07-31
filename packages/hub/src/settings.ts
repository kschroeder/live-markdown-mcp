import fs from "node:fs";
import type { AppSettings } from "@markdown-mcp/shared";
import { mergeSettings } from "@markdown-mcp/shared";
import { ensureAppDir, settingsPath } from "./paths.js";

export function loadSettings(): AppSettings {
  ensureAppDir();
  const file = settingsPath();
  if (!fs.existsSync(file)) {
    return mergeSettings(null);
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AppSettings>;
    return mergeSettings(raw);
  } catch {
    return mergeSettings(null);
  }
}

export function saveSettings(settings: AppSettings): AppSettings {
  ensureAppDir();
  const merged = mergeSettings(settings);
  fs.writeFileSync(settingsPath(), JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const current = loadSettings();
  return saveSettings({ ...current, ...partial });
}
