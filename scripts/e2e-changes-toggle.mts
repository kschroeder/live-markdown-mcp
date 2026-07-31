/**
 * Playwright: Changes toolbar toggle persists across page reload via settings API.
 * Run: npm run test:e2e:changes -w @markdown-mcp/web
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import {
  getSettings,
  registerClient,
  root,
  scopeFile,
  seedSettings,
  startHub,
  stopHub,
} from "./e2e-lib.mts";

const fixture = path.join(root, "packages", "web", "e2e-changes-fixture.md");

async function main() {
  // Start with Changes ON so the test can turn it off and assert persistence.
  seedSettings({
    firstRunCompleted: true,
    openBrowserOnFirstFileEvent: false,
    showChangesByDefault: true,
  });

  const { proc, waitUrl } = startHub();
  const url = await waitUrl;
  console.log("hub", url);

  // Content present before scope so the first paint has the doc body
  fs.writeFileSync(
    fixture,
    "# Changes toggle fixture\n\nBody for the persistence test.\n\n**TOGGLE_DOC**\n",
    "utf8"
  );
  await registerClient(url);
  await scopeFile(url, fixture);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector(".prose", { timeout: 10_000 });
  await page.waitForSelector(".prose >> text=TOGGLE_DOC", { timeout: 10_000 });

  const changesBtn = page.locator("button.pill-toggle", { hasText: "Changes" });
  await changesBtn.waitFor({ state: "visible" });

  // Default: on
  if ((await changesBtn.getAttribute("aria-pressed")) !== "true") {
    throw new Error("expected Changes toggle ON after seed showChangesByDefault:true");
  }

  // Turn off — should persist to settings.json via API
  await changesBtn.click();
  await page.waitForTimeout(300);

  if ((await changesBtn.getAttribute("aria-pressed")) !== "false") {
    throw new Error("expected Changes toggle OFF after click");
  }

  const afterClick = await getSettings(url);
  if (afterClick.showChangesByDefault !== false) {
    throw new Error(
      `settings API still showChangesByDefault=${afterClick.showChangesByDefault} after toggle off`
    );
  }
  console.log("api ok — showChangesByDefault=false after toggle");

  // Hard reload: UI must restore from settings
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("button.pill-toggle", { timeout: 10_000 });
  const afterReload = page.locator("button.pill-toggle", { hasText: "Changes" });
  await afterReload.waitFor({ state: "visible" });
  await page.waitForTimeout(400);

  const pressed = await afterReload.getAttribute("aria-pressed");
  if (pressed !== "false") {
    throw new Error(`after reload expected aria-pressed=false, got ${pressed}`);
  }

  const afterReloadSettings = await getSettings(url);
  if (afterReloadSettings.showChangesByDefault !== false) {
    throw new Error("settings lost showChangesByDefault=false after reload");
  }

  // Toggle back on and confirm API
  await afterReload.click();
  await page.waitForTimeout(300);
  const onAgain = await getSettings(url);
  if (onAgain.showChangesByDefault !== true) {
    throw new Error("failed to persist toggle back to true");
  }
  if ((await afterReload.getAttribute("aria-pressed")) !== "true") {
    throw new Error("UI not ON after second toggle");
  }

  console.log("e2e ok — Changes toggle persists across reload");
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
