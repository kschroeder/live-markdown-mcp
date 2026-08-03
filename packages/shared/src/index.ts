/** Well-known config / state directory name under the user profile. */
export const APP_DIR_NAME = "markdown-mcp";

export const DEFAULT_SETTINGS: AppSettings = {
  bindHost: "127.0.0.1",
  /** null = pick a free high port on first hub start and persist it. */
  preferredPort: null,
  allowedRoots: [],
  theme: "system",
  openBrowserOnFirstFileEvent: true,
  preserveScroll: true,
  showChangesByDefault: true,
  historyLimit: 50,
  firstRunCompleted: false,
};

/** Inclusive high/ephemeral range used for sticky hub ports. */
export const PREFERRED_PORT_MIN = 49152;
export const PREFERRED_PORT_MAX = 65535;

export type ThemePreference = "light" | "dark" | "system";

export interface AppSettings {
  /** HTTP bind host. Default 127.0.0.1 */
  bindHost: string;
  /**
   * Sticky hub listen port in the high/unused range.
   * null = not chosen yet (hub picks a free high port and writes it back).
   * Change takes effect on next hub restart.
   */
  preferredPort: number | null;
  /** Absolute path prefixes that may be scoped. Empty = allow any absolute path. */
  allowedRoots: string[];
  theme: ThemePreference;
  openBrowserOnFirstFileEvent: boolean;
  preserveScroll: boolean;
  showChangesByDefault: boolean;
  /** Max snapshots retained per file. */
  historyLimit: number;
  firstRunCompleted: boolean;
}

export interface HubStateFile {
  port: number;
  host: string;
  pid: number;
  startedAt: string;
  url: string;
}

export interface DiffHunk {
  type: "add" | "del" | "mod" | "eq";
  /** 0-based line index in the new content (for add/mod/eq). */
  newStart: number;
  newLines: string[];
  /** 0-based line index in the old content (for del/mod/eq). */
  oldStart: number;
  oldLines: string[];
}

export interface SnapshotMeta {
  id: string;
  createdAt: string;
  /** Short label for UI. */
  label: string;
  byteLength: number;
  stats: { add: number; del: number; mod: number };
}

export interface ScopedFileState {
  path: string;
  /** Display name (basename). */
  name: string;
  exists: boolean;
  content: string;
  mtimeMs: number | null;
  snapshots: SnapshotMeta[];
  /** Id of the snapshot representing current disk content. */
  currentSnapshotId: string | null;
  /** Diff hunks vs previous snapshot (or empty). */
  hunks: DiffHunk[];
  updatedAt: string;
}

export interface HubPublicState {
  files: ScopedFileState[];
  clientCount: number;
  browserOpened: boolean;
  settings: AppSettings;
  hubUrl: string;
}

/** WebSocket / event payload types. */
export type HubEvent =
  | { type: "state"; payload: HubPublicState }
  | { type: "file:update"; payload: ScopedFileState }
  | { type: "file:removed"; payload: { path: string } }
  | { type: "settings"; payload: AppSettings }
  | { type: "clients"; payload: { count: number } };

export interface ScopeRequest {
  path: string;
}

export interface ScopeResponse {
  ok: true;
  path: string;
  alreadyScoped: boolean;
  file: ScopedFileState;
}

export interface ClientRegisterResponse {
  clientId: string;
  hubUrl: string;
  state: HubPublicState;
}

export function normalizePreferredPort(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const port = Math.trunc(n);
  if (port < 1 || port > 65535) return null;
  return port;
}

export function mergeSettings(
  partial: Partial<AppSettings> | null | undefined
): AppSettings {
  const preferredPort =
    partial && "preferredPort" in partial
      ? normalizePreferredPort(partial.preferredPort)
      : DEFAULT_SETTINGS.preferredPort;
  return {
    ...DEFAULT_SETTINGS,
    ...(partial ?? {}),
    allowedRoots: partial?.allowedRoots ?? DEFAULT_SETTINGS.allowedRoots,
    preferredPort,
  };
}
