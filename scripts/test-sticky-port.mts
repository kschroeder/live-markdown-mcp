/**
 * Integration: hub sticky preferredPort survives stop/start; collision updates settings.
 * Run: npx tsx scripts/test-sticky-port.mts
 */
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import {
  appDataDir,
  clearHubRuntime,
  seedSettings,
  startHub,
  stopHub,
  waitForHub,
} from "./e2e-lib.mts";
import { spawn, type ChildProcess } from "node:child_process";
import { hubCli, root } from "./e2e-lib.mts";

function settingsFile(): string {
  return path.join(appDataDir(), "settings.json");
}

function readPreferredPort(): number | null {
  const raw = JSON.parse(fs.readFileSync(settingsFile(), "utf8")) as {
    preferredPort?: number | null;
  };
  return raw.preferredPort ?? null;
}

function readHubPort(): number {
  const hub = JSON.parse(
    fs.readFileSync(path.join(appDataDir(), "hub.json"), "utf8")
  ) as { port: number };
  return hub.port;
}

async function startHubWithExistingSettings(): Promise<{
  proc: ChildProcess;
  url: string;
}> {
  if (!fs.existsSync(hubCli)) throw new Error("Build hub first: npm run build");
  // Do NOT clear settings — only lock/state for a clean singleton.
  for (const f of ["hub.lock", "hub.json"]) {
    try {
      fs.unlinkSync(path.join(appDataDir(), f));
    } catch {
      /* ignore */
    }
  }
  const proc = spawn(process.execPath, [hubCli], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
  const url = await waitForHub(proc, 15_000);
  return { proc, url };
}

async function main() {
  if (!fs.existsSync(hubCli)) {
    console.log("SKIP: hub CLI not built (run npm run build first)");
    process.exit(0);
  }

  // --- Case 1: first start picks high port and persists preferredPort
  seedSettings({
    firstRunCompleted: true,
    openBrowserOnFirstFileEvent: false,
    preferredPort: null,
  });
  clearHubRuntime();

  let { proc, waitUrl } = startHub();
  let url = await waitUrl;
  const port1 = new URL(url).port;
  console.log("start1", url, "preferred", readPreferredPort());
  if (readPreferredPort() !== Number(port1)) {
    throw new Error(
      `expected preferredPort ${port1} after first start, got ${readPreferredPort()}`
    );
  }
  if (Number(port1) < 49152) {
    console.warn(`warn: port ${port1} is below high band (last-resort ephemeral?)`);
  }
  stopHub(proc);
  await sleep(500);

  // --- Case 2: restart reuses sticky port
  ({ proc, url } = await startHubWithExistingSettings());
  const port2 = new URL(url).port;
  console.log("start2", url, "preferred", readPreferredPort());
  if (port2 !== port1) {
    throw new Error(`sticky port not reused: first=${port1} second=${port2}`);
  }
  if (readHubPort() !== Number(port1)) {
    throw new Error("hub.json port mismatch");
  }
  stopHub(proc);
  await sleep(500);

  // --- Case 3: collision falls back and updates preferredPort
  const sticky = Number(port1);
  const blocker = createServer((_q, r) => r.end("x"));
  await new Promise<void>((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(sticky, "127.0.0.1", () => resolve());
  });
  console.log("blocking", sticky);

  ({ proc, url } = await startHubWithExistingSettings());
  const port3 = Number(new URL(url).port);
  console.log("start3 (fallback)", url, "preferred", readPreferredPort());
  if (port3 === sticky) {
    throw new Error("expected fallback away from blocked sticky port");
  }
  if (readPreferredPort() !== port3) {
    throw new Error(
      `preferredPort should update to fallback ${port3}, got ${readPreferredPort()}`
    );
  }
  stopHub(proc);
  await new Promise<void>((r) => blocker.close(() => r()));

  console.log("sticky port integration OK");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
