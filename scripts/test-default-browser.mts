/**
 * Live verification: resolved default browser executable matches OS default product.
 * Run: npx tsx scripts/test-default-browser.mts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  detectBrowserProduct,
  resolveDefaultBrowser,
  resolveExecutableForLabel,
} from "../packages/hub/src/browser.ts";

async function main() {
  const mod = await import("default-browser");
  const info = await mod.default();
  const label = `${info.name || ""} ${info.id || ""}`.trim();
  console.log("OS default-browser package:", info);

  const product = detectBrowserProduct(label);
  console.log("detected product:", product);

  const byLabel = resolveExecutableForLabel(label);
  console.log("executable for label:", byLabel);

  const resolved = await resolveDefaultBrowser();
  console.log("resolveDefaultBrowser:", resolved);

  assert.ok(product, "should detect a product from OS default");
  assert.ok(resolved.executable, "should resolve an executable path");
  assert.ok(fs.existsSync(resolved.executable!), `missing exe: ${resolved.executable}`);

  if (product === "brave") {
    assert.match(resolved.executable!, /brave(\.exe)?$/i, "Brave default must use brave binary");
    assert.doesNotMatch(
      resolved.executable!,
      /[\\/]Chrome[\\/].*chrome\.exe$/i,
      "must not use Google Chrome when default is Brave"
    );
  }
  if (product === "chrome") {
    assert.match(resolved.executable!, /chrome(\.exe)?$/i);
  }
  if (product === "edge") {
    assert.match(resolved.executable!, /msedge(\.exe)?$/i);
  }

  // Name should reflect the default product, not a random sibling
  if (product === "brave") {
    assert.match(resolved.name, /brave/i);
  }

  console.log("default browser resolution OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
