import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearStaleLock,
  isHubAlive,
  readHubState,
  getAppDir,
} from "@markdown-mcp/hub";
import type { ClientRegisterResponse, ScopeResponse } from "@markdown-mcp/shared";

const START_TIMEOUT_MS = 20_000;
const POLL_MS = 150;

let clientId: string | null = null;
let hubBase: string | null = null;
let heartbeat: NodeJS.Timeout | null = null;

export async function ensureHub(): Promise<string> {
  const existing = readHubState();
  if (await isHubAlive(existing)) {
    hubBase = stripSlash(existing!.url);
    return hubBase;
  }

  // Dead hub left lock/state behind (e.g. taskkill) — clear before spawn.
  clearStaleLock();

  spawnHub();
  const state = await waitForHub();
  hubBase = stripSlash(state.url);
  return hubBase;
}

export async function registerClient(): Promise<ClientRegisterResponse> {
  const base = await ensureHub();
  const res = await fetch(`${base}/api/clients/register`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`Failed to register MCP client: ${res.status}`);
  }
  const data = (await res.json()) as ClientRegisterResponse;
  clientId = data.clientId;
  hubBase = stripSlash(data.hubUrl || base);
  startHeartbeat();
  return data;
}

export async function unregisterClient(): Promise<void> {
  stopHeartbeat();
  if (!clientId || !hubBase) return;
  try {
    await fetch(`${hubBase}/api/clients/${clientId}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    /* hub may already be gone */
  }
  clientId = null;
}

export async function scopeMarkdown(
  filePath: string
): Promise<ScopeResponse | { error: string }> {
  const base = hubBase ?? (await ensureHub());
  const res = await fetch(`${base}/api/scope`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: filePath }),
  });
  const data = (await res.json()) as ScopeResponse & { error?: string };
  if (!res.ok) {
    return { error: data.error || `scope failed (${res.status})` };
  }
  return data;
}

function startHeartbeat(): void {
  stopHeartbeat();
  if (!clientId || !hubBase) return;
  const id = clientId;
  const base = hubBase;
  heartbeat = setInterval(() => {
    void fetch(`${base}/api/clients/${id}/heartbeat`, { method: "POST" }).catch(() => {
      /* ignore */
    });
  }, 10_000);
  heartbeat.unref?.();
}

function stopHeartbeat(): void {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

function spawnHub(): void {
  const hubCli = resolveHubCli();
  if (!fs.existsSync(hubCli)) {
    throw new Error(
      `Hub CLI not found at ${hubCli}. Build the monorepo with npm run build first.`
    );
  }

  // Capture hub logs for debugging failed starts
  let logFd: number | "ignore" = "ignore";
  try {
    const logPath = path.join(getAppDir(), "hub.log");
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    logFd = fs.openSync(logPath, "a");
  } catch {
    logFd = "ignore";
  }

  const child = spawn(process.execPath, [hubCli], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
    env: { ...process.env },
  });
  child.unref();
  if (typeof logFd === "number") {
    try {
      fs.closeSync(logFd);
    } catch {
      /* ignore */
    }
  }
}

function resolveHubCli(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "..", "..", "hub", "dist", "cli.js"),
    path.join(here, "..", "node_modules", "@markdown-mcp", "hub", "dist", "cli.js"),
    path.join(process.cwd(), "packages", "hub", "dist", "cli.js"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0]!;
}

async function waitForHub(): Promise<{ url: string; port: number; host: string }> {
  const start = Date.now();
  while (Date.now() - start < START_TIMEOUT_MS) {
    const state = readHubState();
    if (await isHubAlive(state)) {
      return state!;
    }
    await sleep(POLL_MS);
  }
  throw new Error(
    `Timed out waiting for MarkdownMCP hub to start (see ${path.join(getAppDir(), "hub.log")})`
  );
}

function stripSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
