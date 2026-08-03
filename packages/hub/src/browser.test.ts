import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import {
  buildBrowserArgs,
  classifyBrowser,
  detectBrowserProduct,
  isManagedBrowserRunning,
  isPidAlive,
  openManagedBrowserOnce,
  resetBrowserFlag,
  resolveExecutableForLabel,
  type BrowserDeps,
  type ResolvedBrowser,
} from "./browser.js";

describe("classifyBrowser", () => {
  it("maps common Chromium-family names", () => {
    assert.equal(classifyBrowser("Google Chrome"), "chromium");
    assert.equal(classifyBrowser("Microsoft Edge"), "chromium");
    assert.equal(classifyBrowser("com.brave.Browser"), "chromium");
    assert.equal(classifyBrowser("opera"), "chromium");
  });

  it("maps Firefox-family names", () => {
    assert.equal(classifyBrowser("Firefox"), "firefox");
    assert.equal(classifyBrowser("org.mozilla.firefox"), "firefox");
  });

  it("maps Safari and unknown", () => {
    assert.equal(classifyBrowser("Safari"), "safari");
    assert.equal(classifyBrowser("Some Browser"), "unknown");
  });
});

describe("detectBrowserProduct", () => {
  it("identifies Brave from name and id", () => {
    assert.equal(detectBrowserProduct("Brave"), "brave");
    assert.equal(detectBrowserProduct("com.brave.Browser"), "brave");
    assert.equal(detectBrowserProduct("Brave com.brave.Browser"), "brave");
  });

  it("does not confuse chromium with chrome", () => {
    assert.equal(detectBrowserProduct("Chromium"), "chromium");
    assert.equal(detectBrowserProduct("Google Chrome"), "chrome");
    assert.equal(detectBrowserProduct("com.google.Chrome"), "chrome");
  });

  it("identifies edge and firefox", () => {
    assert.equal(detectBrowserProduct("Microsoft Edge"), "edge");
    assert.equal(detectBrowserProduct("msedge"), "edge");
    assert.equal(detectBrowserProduct("Firefox"), "firefox");
  });
});

describe("resolveExecutableForLabel", () => {
  it("resolves Brave to a Brave binary when Brave is installed", (t) => {
    const exe = resolveExecutableForLabel("Brave com.brave.Browser");
    if (!exe) {
      t.skip("Brave not installed (or not on standard install paths)");
      return;
    }
    assert.match(exe, /brave/i);
    // Must not silently fall back to Google Chrome when the label is Brave.
    assert.doesNotMatch(exe, /[\\/]Google[\\/]Chrome[\\/]/i);
    assert.ok(fs.existsSync(exe), `resolved path missing: ${exe}`);
  });

  it("resolves Chrome to a Chrome binary when Chrome is installed", (t) => {
    const exe = resolveExecutableForLabel("Google Chrome com.google.Chrome");
    if (!exe) {
      t.skip("Google Chrome not installed (or not on standard install paths)");
      return;
    }
    assert.match(exe, /chrome/i);
    assert.doesNotMatch(exe, /brave/i);
    assert.ok(fs.existsSync(exe), `resolved path missing: ${exe}`);
  });

  it("resolves Edge to msedge/edge when Edge is installed", (t) => {
    const exe = resolveExecutableForLabel("Microsoft Edge");
    if (!exe) {
      t.skip("Microsoft Edge not installed (or not on standard install paths)");
      return;
    }
    assert.match(exe, /msedge|edge/i);
    assert.ok(fs.existsSync(exe), `resolved path missing: ${exe}`);
  });

  it("resolves Firefox when Firefox is installed", (t) => {
    const exe = resolveExecutableForLabel("Firefox org.mozilla.firefox");
    if (!exe) {
      t.skip("Firefox not installed (or not on standard install paths)");
      return;
    }
    assert.match(exe, /firefox/i);
    assert.ok(fs.existsSync(exe), `resolved path missing: ${exe}`);
  });
});

describe("buildBrowserArgs", () => {
  const profile = path.join(os.tmpdir(), "mmcp-profile-test");
  const url = "http://127.0.0.1:54321/";

  it("uses user-data-dir for chromium without --new-window", () => {
    const args = buildBrowserArgs("chromium", profile, url);
    assert.ok(args.some((a) => a.startsWith("--user-data-dir=")));
    assert.ok(args.includes(url));
    assert.ok(!args.includes("--new-window"));
    assert.ok(args.includes("--start-maximized"));
  });

  it("uses -profile for firefox", () => {
    const args = buildBrowserArgs("firefox", profile, url);
    assert.deepEqual(args, ["-no-remote", "-profile", profile, url]);
  });

  it("passes only URL for safari/unknown", () => {
    assert.deepEqual(buildBrowserArgs("safari", profile, url), [url]);
    assert.deepEqual(buildBrowserArgs("unknown", profile, url), [url]);
  });
});

describe("isManagedBrowserRunning", () => {
  it("detects living pid file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mmcp-br-"));
    const pidFile = path.join(dir, "browser.pid");
    fs.writeFileSync(pidFile, String(process.pid), "utf8");
    assert.equal(isManagedBrowserRunning(dir, pidFile), true);
    fs.writeFileSync(pidFile, "99999999", "utf8");
    // dead pid and no locks
    assert.equal(isManagedBrowserRunning(dir, pidFile), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("isPidAlive for current process", () => {
    assert.equal(isPidAlive(process.pid), true);
    assert.equal(isPidAlive(0), false);
  });
});

describe("openManagedBrowserOnce reconnect-first", () => {
  beforeEach(() => {
    resetBrowserFlag();
  });

  function mockDeps(overrides: Partial<BrowserDeps> & { running?: boolean }): {
    deps: BrowserDeps;
    spawns: { executable: string | null; args: string[] }[];
  } {
    const spawns: { executable: string | null; args: string[] }[] = [];
    const browser: ResolvedBrowser = {
      family: "chromium",
      executable: "C:\\fake\\chrome.exe",
      name: "Chrome",
    };
    const deps: BrowserDeps = {
      resolveDefaultBrowser: async () => browser,
      isRunning: () => overrides.running === true,
      spawnBrowser: (executable, args) => {
        spawns.push({ executable, args });
        return { pid: 4242, unref: () => undefined } as unknown as ChildProcess;
      },
      ensureProfileDir: () => path.join(os.tmpdir(), "mmcp-profile"),
      writePid: () => undefined,
      log: () => undefined,
      ...overrides,
    };
    return { deps, spawns };
  }

  it("skips launch when a managed browser is already running", async () => {
    const { deps, spawns } = mockDeps({ running: true });
    const result = await openManagedBrowserOnce("http://127.0.0.1:9/", deps);
    assert.equal(result.opened, false);
    assert.equal(result.reason, "already_running");
    assert.equal(spawns.length, 0);
  });

  it("launches with profile args when not running", async () => {
    const { deps, spawns } = mockDeps({ running: false });
    const url = "http://127.0.0.1:61234/";
    const result = await openManagedBrowserOnce(url, deps);
    assert.equal(result.opened, true);
    assert.equal(result.reason, "launched");
    assert.equal(spawns.length, 1);
    assert.ok(spawns[0]!.args.some((a) => a.includes("--user-data-dir=")));
    assert.ok(spawns[0]!.args.includes(url));
  });

  it("skips second launch only while isRunning stays true", async () => {
    let running = false;
    const { deps, spawns } = mockDeps({
      running: false,
      isRunning: () => running,
    });
    const url = "http://127.0.0.1:61234/";
    await openManagedBrowserOnce(url, deps);
    assert.equal(spawns.length, 1);
    running = true;
    const again = await openManagedBrowserOnce(url, deps);
    assert.equal(again.reason, "already_running");
    assert.equal(spawns.length, 1);
    // User closed browser — allow relaunch
    running = false;
    const relaunch = await openManagedBrowserOnce(url, deps);
    assert.equal(relaunch.opened, true);
    assert.equal(spawns.length, 2);
  });

  it("coalesces concurrent opens into a single spawn", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const spawns: unknown[] = [];
    const deps: BrowserDeps = {
      resolveDefaultBrowser: async () => {
        await gate;
        return {
          family: "chromium",
          executable: "chrome-fake",
          name: "Chrome",
        };
      },
      isRunning: () => false,
      spawnBrowser: () => {
        spawns.push(1);
        return { pid: 99, unref() {} } as never;
      },
      ensureProfileDir: () => path.join(os.tmpdir(), "mmcp-profile"),
      writePid: () => undefined,
      log: () => undefined,
    };
    const url = "http://127.0.0.1:1/";
    const p1 = openManagedBrowserOnce(url, deps);
    const p2 = openManagedBrowserOnce(url, deps);
    release();
    const [a, b] = await Promise.all([p1, p2]);
    assert.equal(spawns.length, 1, "must spawn only once under concurrency");
    assert.equal(a.reason, "launched");
    assert.equal(b.reason, "launched");
  });
});
