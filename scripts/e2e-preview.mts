/**
 * End-to-end smoke: hub serves UI, scoped file with mermaid + trailing text,
 * Playwright asserts trailing text is in the DOM (not swallowed by diagram errors).
 *
 * Requires: npm i (playwright browsers: npx playwright install chromium)
 * Run: npm run test:e2e -w @markdown-mcp/web
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hubCli = path.join(root, "packages", "hub", "dist", "cli.js");
const fixture = path.join(root, "packages", "web", "e2e-fixture.md");

async function main() {
  if (!fs.existsSync(hubCli)) {
    throw new Error("Build hub first: npm run build");
  }

  // Clear stale lock so we own a clean hub
  const appData =
    process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA || "", "markdown-mcp")
      : path.join(process.env.HOME || "", ".config", "markdown-mcp");
  for (const f of ["hub.lock", "hub.json"]) {
    try {
      fs.unlinkSync(path.join(appData, f));
    } catch {
      /* ignore */
    }
  }

  const hub = spawn(process.execPath, [hubCli], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  const url = await waitForHub(hub, 15_000);
  console.log("hub", url);

  const md = `# E2E fixture

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

### After mermaid

**FOLLOW_UP_MARKER** must stay visible even if mermaid misbehaves.
`;
  fs.writeFileSync(fixture, md, "utf8");

  const scope = await fetch(`${url}api/scope`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: fixture }),
  });
  if (!scope.ok) throw new Error(`scope failed ${scope.status}`);

  // Register a fake client so hub does not exit mid-test
  await fetch(`${url}api/clients/register`, { method: "POST" });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector(".prose", { timeout: 10_000 });

  // Wait for either mermaid SVG or error fallback, then check marker
  await page.waitForTimeout(800);
  const body = await page.locator(".prose").innerText();
  if (!body.includes("FOLLOW_UP_MARKER")) {
    throw new Error(`FOLLOW_UP_MARKER missing from prose.\nGot:\n${body.slice(0, 500)}`);
  }

  // Soft check: uncaught transform errors should not appear after our fix
  const bad = pageErrors.filter((e) => /translate\(undefined/i.test(e));
  if (bad.length) {
    console.warn("still saw transform errors (non-fatal if marker visible):", bad);
  }

  console.log("e2e ok — FOLLOW_UP_MARKER visible");
  await browser.close();
  hub.kill();
  try {
    fs.unlinkSync(fixture);
  } catch {
    /* ignore */
  }
  process.exit(0);
}

function waitForHub(proc: ChildProcess, ms: number): Promise<string> {
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
