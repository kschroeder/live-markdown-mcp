/**
 * End-to-end smoke: hub serves UI, scoped file with mermaid + trailing text.
 * Run: npm run test:e2e -w @markdown-mcp/web
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import {
  root,
  registerClient,
  scopeFile,
  seedSettings,
  startHub,
  stopHub,
} from "./e2e-lib.mts";

const fixture = path.join(root, "packages", "web", "e2e-fixture.md");

async function main() {
  seedSettings({ firstRunCompleted: true, openBrowserOnFirstFileEvent: false });
  const { proc, waitUrl } = startHub();
  const url = await waitUrl;
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

  await registerClient(url);
  await scopeFile(url, fixture);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector(".prose", { timeout: 10_000 });
  await page.waitForTimeout(500);

  const body = await page.locator(".prose").innerText();
  if (!body.includes("FOLLOW_UP_MARKER")) {
    throw new Error(`FOLLOW_UP_MARKER missing from prose.\nGot:\n${body.slice(0, 500)}`);
  }

  const bad = pageErrors.filter((e) => /translate\(undefined/i.test(e));
  if (bad.length) {
    console.warn("transform errors (non-fatal if marker visible):", bad);
  }

  console.log("e2e ok — FOLLOW_UP_MARKER visible");
  await browser.close();
  stopHub(proc);
  try {
    fs.unlinkSync(fixture);
  } catch {
    /* ignore */
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
