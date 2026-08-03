import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { browserPidPath, browserProfileDir, ensureAppDir } from "./paths.js";

export type BrowserFamily = "chromium" | "firefox" | "safari" | "unknown";

export interface ResolvedBrowser {
  family: BrowserFamily;
  /** Executable path when known; null means use platform open fallback. */
  executable: string | null;
  name: string;
}

export interface BrowserLaunchResult {
  opened: boolean;
  reason:
    | "launched"
    | "already_running"
    | "disabled_skip"
    | "launch_failed"
    | "no_browser";
  family?: BrowserFamily;
  pid?: number;
}

export interface BrowserDeps {
  resolveDefaultBrowser: () => Promise<ResolvedBrowser>;
  isRunning: (profileDir: string, pidFile: string) => boolean;
  spawnBrowser: (
    executable: string | null,
    args: string[],
    env: NodeJS.ProcessEnv
  ) => ChildProcess | null;
  ensureProfileDir: () => string;
  writePid: (pid: number) => void;
  log: (msg: string, err?: unknown) => void;
}

let openedThisProcess = false;

export function resetBrowserFlag(): void {
  openedThisProcess = false;
}

export function hasOpenedBrowser(): boolean {
  return openedThisProcess;
}

export function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** True if a managed-profile browser appears to be running (pid file or engine locks). */
export function isManagedBrowserRunning(
  profileDir: string = browserProfileDir(),
  pidFile: string = browserPidPath()
): boolean {
  try {
    if (fs.existsSync(pidFile)) {
      const raw = fs.readFileSync(pidFile, "utf8").trim();
      const pid = Number(raw);
      if (isPidAlive(pid)) return true;
    }
  } catch {
    /* ignore */
  }

  // Chromium family lock / singleton markers while a session holds the profile.
  const chromiumMarkers = [
    "SingletonLock",
    "SingletonCookie",
    "SingletonSocket",
    "lockfile",
  ];
  for (const name of chromiumMarkers) {
    if (fs.existsSync(path.join(profileDir, name))) {
      // Stale lock files can remain after a crash; pair with a living Chrome-like process when possible.
      if (hasLivingBrowserProcess()) return true;
      // On Windows SingletonLock is often a symlink to "host-pid"; try parsing.
      if (chromiumSingletonLooksLive(path.join(profileDir, name))) return true;
    }
  }

  // Firefox profile locks
  for (const name of ["parent.lock", ".parentlock", "lock"]) {
    if (fs.existsSync(path.join(profileDir, name)) && hasLivingBrowserProcess()) {
      return true;
    }
  }

  return false;
}

function chromiumSingletonLooksLive(lockPath: string): boolean {
  try {
    // Often "hostname-pid" or a symlink target containing a pid.
    let target = "";
    try {
      target = fs.readlinkSync(lockPath);
    } catch {
      target = fs.readFileSync(lockPath, "utf8");
    }
    const m = String(target).match(/(\d{2,})/);
    if (m) {
      const pid = Number(m[1]);
      if (isPidAlive(pid)) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function hasLivingBrowserProcess(): boolean {
  // Best-effort: if we recorded a pid, trust that. Otherwise do not assume lock ⇒ live.
  try {
    const pidFile = browserPidPath();
    if (!fs.existsSync(pidFile)) return false;
    const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
    return isPidAlive(pid);
  } catch {
    return false;
  }
}

export function ensureBrowserProfileDir(): string {
  const dir = browserProfileDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeBrowserPid(pid: number): void {
  ensureAppDir();
  fs.writeFileSync(browserPidPath(), String(pid), "utf8");
}

export function clearBrowserPid(): void {
  try {
    if (fs.existsSync(browserPidPath())) fs.unlinkSync(browserPidPath());
  } catch {
    /* ignore */
  }
}

/** Classify a browser name / id from default-browser or path heuristics. */
export function classifyBrowser(nameOrId: string): BrowserFamily {
  const s = nameOrId.toLowerCase();
  if (
    s.includes("chrome") ||
    s.includes("chromium") ||
    s.includes("edge") ||
    s.includes("msedge") ||
    s.includes("brave") ||
    s.includes("opera") ||
    s.includes("vivaldi") ||
    s.includes("arc")
  ) {
    return "chromium";
  }
  if (s.includes("firefox") || s.includes("waterfox") || s.includes("librewolf")) {
    return "firefox";
  }
  if (s.includes("safari")) return "safari";
  return "unknown";
}

/**
 * Build argv for a managed-profile launch (executable separate).
 * Safari / unknown: open URL only (limited isolation).
 */
export function buildBrowserArgs(
  family: BrowserFamily,
  profileDir: string,
  url: string
): string[] {
  switch (family) {
    case "chromium":
      // One URL only — no --new-window. A second spawn against the same
      // user-data-dir would open an extra tab; we prevent that with a launch mutex.
      return [
        `--user-data-dir=${profileDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--no-restore-state",
        "--disable-session-crashed-bubble",
        "--start-maximized",
        url,
      ];
    case "firefox":
      // -no-remote allows a second Firefox with a dedicated profile.
      return ["-no-remote", "-profile", profileDir, url];
    case "safari":
    case "unknown":
    default:
      return [url];
  }
}

/** Product-specific install paths. Order within a product is preference; product is chosen by default-browser id/name. */
const BROWSER_PATHS: Record<string, Record<string, string[]>> = {
  chrome: {
    win32: [
      path.join(
        process.env.PROGRAMFILES || "C:\\Program Files",
        "Google",
        "Chrome",
        "Application",
        "chrome.exe"
      ),
      path.join(
        process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
        "Google",
        "Chrome",
        "Application",
        "chrome.exe"
      ),
      path.join(
        process.env.LOCALAPPDATA || "",
        "Google",
        "Chrome",
        "Application",
        "chrome.exe"
      ),
    ],
    darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"],
  },
  edge: {
    win32: [
      path.join(
        process.env.PROGRAMFILES || "C:\\Program Files",
        "Microsoft",
        "Edge",
        "Application",
        "msedge.exe"
      ),
      path.join(
        process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
        "Microsoft",
        "Edge",
        "Application",
        "msedge.exe"
      ),
    ],
    darwin: ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
    linux: ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"],
  },
  brave: {
    win32: [
      path.join(
        process.env.PROGRAMFILES || "C:\\Program Files",
        "BraveSoftware",
        "Brave-Browser",
        "Application",
        "brave.exe"
      ),
      path.join(
        process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
        "BraveSoftware",
        "Brave-Browser",
        "Application",
        "brave.exe"
      ),
      path.join(
        process.env.LOCALAPPDATA || "",
        "BraveSoftware",
        "Brave-Browser",
        "Application",
        "brave.exe"
      ),
    ],
    darwin: ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
    linux: ["/usr/bin/brave-browser", "/usr/bin/brave-browser-stable"],
  },
  chromium: {
    win32: [
      path.join(
        process.env.LOCALAPPDATA || "",
        "Chromium",
        "Application",
        "chrome.exe"
      ),
    ],
    darwin: ["/Applications/Chromium.app/Contents/MacOS/Chromium"],
    linux: ["/usr/bin/chromium", "/usr/bin/chromium-browser"],
  },
  opera: {
    win32: [
      path.join(
        process.env.LOCALAPPDATA || "",
        "Programs",
        "Opera",
        "opera.exe"
      ),
    ],
    darwin: ["/Applications/Opera.app/Contents/MacOS/Opera"],
    linux: ["/usr/bin/opera"],
  },
  vivaldi: {
    win32: [
      path.join(
        process.env.LOCALAPPDATA || "",
        "Vivaldi",
        "Application",
        "vivaldi.exe"
      ),
    ],
    darwin: ["/Applications/Vivaldi.app/Contents/MacOS/Vivaldi"],
    linux: ["/usr/bin/vivaldi", "/usr/bin/vivaldi-stable"],
  },
  firefox: {
    win32: [
      path.join(
        process.env.PROGRAMFILES || "C:\\Program Files",
        "Mozilla Firefox",
        "firefox.exe"
      ),
      path.join(
        process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
        "Mozilla Firefox",
        "firefox.exe"
      ),
    ],
    darwin: ["/Applications/Firefox.app/Contents/MacOS/firefox"],
    linux: ["/usr/bin/firefox", "/usr/bin/firefox-esr"],
  },
};

function firstExisting(candidates: string[]): string | null {
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

function pathsForProduct(product: string): string[] {
  const entry = BROWSER_PATHS[product];
  if (!entry) return [];
  return entry[process.platform] || entry.linux || [];
}

/**
 * Map default-browser name/id to a product key (brave, chrome, edge, …).
 * Order matters: "chromium" must be checked before "chrome" (substring).
 */
export function detectBrowserProduct(nameOrId: string): string | null {
  const s = nameOrId.toLowerCase();
  if (!s.trim()) return null;
  if (s.includes("brave")) return "brave";
  if (s.includes("msedge") || /\bedge\b/.test(s) || s.includes("microsoft edge")) return "edge";
  if (s.includes("opera")) return "opera";
  if (s.includes("vivaldi")) return "vivaldi";
  if (s.includes("firefox") || s.includes("waterfox") || s.includes("librewolf")) return "firefox";
  // "chromium" contains the letters "chrome" — check chromium first.
  if (s.includes("chromium")) return "chromium";
  if (s.includes("chrome")) return "chrome";
  return null;
}

export function resolveExecutableForProduct(product: string): string | null {
  return firstExisting(pathsForProduct(product));
}

/**
 * Resolve executable for a default-browser label (name + id).
 * Picks the matching product binary (Brave → brave.exe), not an arbitrary Chromium sibling.
 */
export function resolveExecutableForLabel(nameOrId: string): string | null {
  const product = detectBrowserProduct(nameOrId);
  if (product) {
    const exe = resolveExecutableForProduct(product);
    if (exe) return exe;
  }
  const family = classifyBrowser(nameOrId);
  return resolveExecutableForFamily(family);
}

export function resolveExecutableForFamily(family: BrowserFamily): string | null {
  if (family === "firefox") {
    return resolveExecutableForProduct("firefox");
  }
  if (family === "chromium") {
    // Last-resort family fallback only — prefer common defaults in a stable order.
    for (const product of ["chrome", "edge", "brave", "chromium", "opera", "vivaldi"]) {
      const exe = resolveExecutableForProduct(product);
      if (exe) return exe;
    }
  }
  return null;
}

/**
 * Resolve the OS default browser via `default-browser` when available,
 * falling back to common install paths. Uses the specific default product binary.
 */
export async function resolveDefaultBrowser(): Promise<ResolvedBrowser> {
  try {
    const mod = await import("default-browser");
    const fn = (mod as { default?: () => Promise<{ name?: string; id?: string }> })
      .default;
    if (typeof fn === "function") {
      const info = await fn();
      const label = `${info?.name || ""} ${info?.id || ""}`.trim() || "default";
      const family = classifyBrowser(label);
      const product = detectBrowserProduct(label);
      const executable = resolveExecutableForLabel(label);
      const name = info?.name || product || label;
      return { family, executable, name };
    }
  } catch {
    /* package missing or detection failed */
  }

  const chromium = resolveExecutableForFamily("chromium");
  if (chromium) {
    return {
      family: "chromium",
      executable: chromium,
      name: path.basename(chromium),
    };
  }
  const firefox = resolveExecutableForFamily("firefox");
  if (firefox) {
    return { family: "firefox", executable: firefox, name: "firefox" };
  }
  return { family: "unknown", executable: null, name: "system-default" };
}

function defaultSpawn(
  executable: string | null,
  args: string[],
  env: NodeJS.ProcessEnv
): ChildProcess | null {
  if (!executable) {
    // Last resort: OS URL open without a dedicated profile (Safari / unknown).
    const platform = process.platform;
    if (platform === "win32") {
      // start "" url — use cmd so shell associations work
      return spawn("cmd", ["/c", "start", '""', ...args], {
        detached: true,
        stdio: "ignore",
        env,
        // Must stay false: windowsHide uses CREATE_NO_WINDOW and can leave
        // Chromium/Brave running with an invisible main window.
        windowsHide: false,
      });
    }
    if (platform === "darwin") {
      return spawn("open", args, { detached: true, stdio: "ignore", env });
    }
    return spawn("xdg-open", args, { detached: true, stdio: "ignore", env });
  }
  return spawn(executable, args, {
    detached: true,
    stdio: "ignore",
    env,
    windowsHide: false,
  });
}

/**
 * On Windows, Chromium sometimes ends up with a real HWND that is not visible
 * (especially when a personal browser instance is already open). Restore/focus
 * any top-level window whose title looks like our preview session.
 */
export function focusManagedBrowserWindows(profileHint = "MarkdownMCP"): void {
  if (process.platform !== "win32") return;
  try {
    const ps = `
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class MmcpWin {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
}
'@
\$hint = '${profileHint.replace(/'/g, "''")}'
[MmcpWin]::EnumWindows({
  param(\$h, \$l)
  \$sb = New-Object System.Text.StringBuilder 512
  [void][MmcpWin]::GetWindowText(\$h, \$sb, \$sb.Capacity)
  \$t = \$sb.ToString()
  if (\$t -like "*\$hint*" -or \$t -like "*markdown-mcp*") {
    [void][MmcpWin]::ShowWindow(\$h, 9)
    [void][MmcpWin]::ShowWindow(\$h, 5)
    [void][MmcpWin]::BringWindowToTop(\$h)
    [void][MmcpWin]::SetForegroundWindow(\$h)
  }
  return \$true
}, [IntPtr]::Zero) | Out-Null
`;
    spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      { detached: true, stdio: "ignore", windowsHide: true }
    ).unref?.();
  } catch {
    /* best-effort */
  }
}

function defaultDeps(): BrowserDeps {
  return {
    resolveDefaultBrowser,
    isRunning: isManagedBrowserRunning,
    spawnBrowser: defaultSpawn,
    ensureProfileDir: ensureBrowserProfileDir,
    writePid: writeBrowserPid,
    log: (msg, err) => {
      if (err !== undefined) console.error(`[markdown-mcp-hub] ${msg}`, err);
      else console.log(`[markdown-mcp-hub] ${msg}`);
    },
  };
}

/** Coalesce concurrent first-write events (chokidar add+change) into one spawn. */
let openInFlight: Promise<BrowserLaunchResult> | null = null;

/**
 * Open the hub URL in a managed browser profile, unless a session is already running.
 * Never kills the browser; safe to call across hub restarts (reconnect-first).
 * If the user closed the browser, a later file event may launch again.
 */
export async function openManagedBrowserOnce(
  url: string,
  deps: BrowserDeps = defaultDeps()
): Promise<BrowserLaunchResult> {
  if (openInFlight) return openInFlight;
  openInFlight = openManagedBrowserOnceImpl(url, deps).finally(() => {
    openInFlight = null;
  });
  return openInFlight;
}

async function openManagedBrowserOnceImpl(
  url: string,
  deps: BrowserDeps
): Promise<BrowserLaunchResult> {
  const profileDir = deps.ensureProfileDir();
  const pidFile = browserPidPath();

  if (deps.isRunning(profileDir, pidFile)) {
    openedThisProcess = true;
    deps.log("managed browser already running; skipping launch (reconnect-first)");
    // Still try to surface a hidden window rather than opening a second tab.
    if (process.platform === "win32") {
      focusManagedBrowserWindows("MarkdownMCP");
    }
    return { opened: false, reason: "already_running" };
  }

  // Stale pid from a closed window — drop so the next launch records a fresh one.
  try {
    if (fs.existsSync(pidFile)) {
      const raw = fs.readFileSync(pidFile, "utf8").trim();
      const pid = Number(raw);
      if (!isPidAlive(pid)) clearBrowserPid();
    }
  } catch {
    /* ignore */
  }

  const browser = await deps.resolveDefaultBrowser();
  const args = buildBrowserArgs(browser.family, profileDir, url);

  try {
    const child = deps.spawnBrowser(browser.executable, args, { ...process.env });
    if (!child) {
      return { opened: false, reason: "launch_failed", family: browser.family };
    }
    child.unref?.();
    if (child.pid && child.pid > 0) {
      deps.writePid(child.pid);
    }
    openedThisProcess = true;
    deps.log(
      `opened managed browser (${browser.name}, ${browser.family}) profile=${profileDir}`
    );
    // Give the browser a moment to create its HWND, then force-show on Windows.
    if (process.platform === "win32") {
      setTimeout(() => focusManagedBrowserWindows("MarkdownMCP"), 800);
      setTimeout(() => focusManagedBrowserWindows("MarkdownMCP"), 2500);
    }
    return {
      opened: true,
      reason: "launched",
      family: browser.family,
      pid: child.pid,
    };
  } catch (err) {
    deps.log("failed to open managed browser:", err);
    return { opened: false, reason: "launch_failed", family: browser.family };
  }
}

/** @deprecated Use openManagedBrowserOnce — kept name alias for older call sites. */
export async function openBrowserOnce(url: string): Promise<boolean> {
  const result = await openManagedBrowserOnce(url);
  return result.opened || result.reason === "already_running";
}
