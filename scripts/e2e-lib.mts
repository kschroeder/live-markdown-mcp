import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const hubCli = path.join(root, "packages", "hub", "dist", "cli.js");

export function appDataDir(): string {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || "", "markdown-mcp");
  }
  if (process.platform === "darwin") {
    return path.join(process.env.HOME || "", "Library", "Application Support", "markdown-mcp");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || "", ".config"), "markdown-mcp");
}

export function clearHubRuntime(): void {
  const dir = appDataDir();
  for (const f of ["hub.lock", "hub.json"]) {
    try {
      fs.unlinkSync(path.join(dir, f));
    } catch {
      /* ignore */
    }
  }
}

/** Seed settings before hub start so the first-run wizard is skipped. */
export function seedSettings(partial: Record<string, unknown> = {}): void {
  const dir = appDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "settings.json");
  let base: Record<string, unknown> = {
    bindHost: "127.0.0.1",
    preferredPort: null,
    allowedRoots: [],
    theme: "light",
    openBrowserOnFirstFileEvent: false,
    preserveScroll: true,
    showChangesByDefault: true,
    historyLimit: 50,
    firstRunCompleted: true,
  };
  try {
    if (fs.existsSync(file)) {
      base = { ...base, ...JSON.parse(fs.readFileSync(file, "utf8")) };
    }
  } catch {
    /* ignore */
  }
  fs.writeFileSync(file, JSON.stringify({ ...base, ...partial }, null, 2), "utf8");
}

export function startHub(): { proc: ChildProcess; waitUrl: Promise<string> } {
  if (!fs.existsSync(hubCli)) {
    throw new Error("Build hub first: npm run build");
  }
  clearHubRuntime();
  const proc = spawn(process.execPath, [hubCli], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
  return { proc, waitUrl: waitForHub(proc, 15_000) };
}

export function waitForHub(proc: ChildProcess, ms: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("hub start timeout")), ms);
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const m = buf.match(/listening on (http:\/\/[^\s]+)/);
      if (m) {
        clearTimeout(t);
        proc.stdout?.off("data", onData);
        resolve(m[1]!.endsWith("/") ? m[1]! : m[1]! + "/");
      }
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("exit", (code) => {
      clearTimeout(t);
      reject(new Error(`hub exited ${code}: ${buf}`));
    });
  });
}

export async function registerClient(url: string): Promise<void> {
  const res = await fetch(`${url}api/clients/register`, { method: "POST" });
  if (!res.ok) throw new Error(`register failed ${res.status}`);
}

export async function scopeFile(url: string, filePath: string): Promise<void> {
  const res = await fetch(`${url}api/scope`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: filePath }),
  });
  if (!res.ok) throw new Error(`scope failed ${res.status}: ${await res.text()}`);
}

export async function getSettings(url: string): Promise<{ showChangesByDefault: boolean }> {
  const res = await fetch(`${url}api/settings`);
  if (!res.ok) throw new Error(`settings ${res.status}`);
  return res.json() as Promise<{ showChangesByDefault: boolean }>;
}

export function stopHub(proc: ChildProcess): void {
  try {
    proc.kill();
  } catch {
    /* ignore */
  }
}
