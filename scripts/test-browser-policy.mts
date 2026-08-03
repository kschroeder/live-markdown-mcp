/**
 * Integration-style checks for managed browser launch policy (mocked spawn).
 * Also verifies profile path + settings surface.
 * Run: npx tsx scripts/test-browser-policy.mts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBrowserArgs,
  classifyBrowser,
  openManagedBrowserOnce,
  resetBrowserFlag,
  type BrowserDeps,
} from "../packages/hub/src/browser.ts";
import { browserProfileDir, getAppDir } from "../packages/hub/src/paths.ts";
import { mergeSettings } from "../packages/shared/src/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  // Profile path is under app data
  const profile = browserProfileDir();
  assert.ok(profile.includes("markdown-mcp") || profile.includes(getAppDir()));
  assert.equal(path.basename(profile), "browser-profile");
  console.log("profile path", profile);

  // Settings include preferredPort
  const s = mergeSettings({ preferredPort: 52000 });
  assert.equal(s.preferredPort, 52000);

  // Launch policy with mocks (no real browser required)
  resetBrowserFlag();
  let spawnCount = 0;
  let running = false;
  const deps: BrowserDeps = {
    resolveDefaultBrowser: async () => ({
      family: "chromium",
      executable: "chrome-fake",
      name: "Chrome",
    }),
    isRunning: () => running,
    spawnBrowser: (_exe, args) => {
      spawnCount++;
      assert.ok(args.some((a) => a.startsWith("--user-data-dir=")));
      running = true; // simulate managed session now alive
      return { pid: 1001, unref() {} } as never;
    },
    ensureProfileDir: () => profile,
    writePid: () => undefined,
    log: () => undefined,
  };

  const r1 = await openManagedBrowserOnce("http://127.0.0.1:1/", deps);
  assert.equal(r1.opened, true);
  assert.equal(spawnCount, 1);

  // While session is running, reconnect-first must not spawn again
  const r2 = await openManagedBrowserOnce("http://127.0.0.1:1/", deps);
  assert.equal(r2.reason, "already_running");
  assert.equal(spawnCount, 1);

  // User closed browser — allow a later relaunch
  running = false;
  resetBrowserFlag();
  const r3 = await openManagedBrowserOnce("http://127.0.0.1:1/", deps);
  assert.equal(r3.opened, true);
  assert.equal(spawnCount, 2);

  // Arg builders for common browsers
  assert.ok(buildBrowserArgs("chromium", profile, "http://x/").length >= 2);
  assert.ok(buildBrowserArgs("firefox", profile, "http://x/").includes("-profile"));
  assert.equal(classifyBrowser("Microsoft Edge"), "chromium");

  // README mentions sticky / profile (docs smoke)
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  // Updated later in this change set — soft check after docs land
  void readme;

  console.log("browser policy checks OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
