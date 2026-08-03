/**
 * Live verification: resolved default browser executable matches OS default product.
 * Skips cleanly when default-browser cannot detect a product or the binary is not installed.
 * Run: npx tsx scripts/test-default-browser.mts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  detectBrowserProduct,
  resolveDefaultBrowser,
  resolveExecutableForLabel,
} from "../packages/hub/src/browser.ts";

function skip(reason: string): never {
  console.log(`SKIP: ${reason}`);
  process.exit(0);
}

async function main() {
  let info: { name?: string; id?: string };
  try {
    const mod = await import("default-browser");
    info = await mod.default();
  } catch (err) {
    skip(`default-browser detection failed: ${String(err)}`);
  }

  const label = `${info.name || ""} ${info.id || ""}`.trim();
  console.log("OS default-browser package:", info);

  if (!label) {
    skip("OS default browser name/id empty");
  }

  const product = detectBrowserProduct(label);
  console.log("detected product:", product);

  if (!product) {
    skip(
      `could not map default browser label to a known product (${label}); ` +
        "Safari/unknown defaults are outside product path resolution"
    );
  }

  const byLabel = resolveExecutableForLabel(label);
  console.log("executable for label:", byLabel);

  const resolved = await resolveDefaultBrowser();
  console.log("resolveDefaultBrowser:", resolved);

  if (!resolved.executable) {
    skip(
      `no executable found for default product "${product}" on this machine ` +
        "(browser may use a non-standard install path)"
    );
  }

  if (!fs.existsSync(resolved.executable)) {
    skip(`resolved executable path does not exist: ${resolved.executable}`);
  }

  // Product-specific checks only when that product is the OS default.
  if (product === "brave") {
    assert.match(resolved.executable, /brave/i, "Brave default must use a Brave binary");
    assert.doesNotMatch(
      resolved.executable,
      /[\\/]Google[\\/]Chrome[\\/]/i,
      "must not use Google Chrome when default is Brave"
    );
    assert.match(resolved.name, /brave/i);
  } else if (product === "chrome") {
    assert.match(resolved.executable, /chrome/i);
    assert.doesNotMatch(resolved.executable, /brave/i);
  } else if (product === "edge") {
    assert.match(resolved.executable, /msedge|edge/i);
  } else if (product === "firefox") {
    assert.match(resolved.executable, /firefox/i);
  }

  // Label resolver and full resolver should agree when both succeed.
  if (byLabel) {
    assert.equal(
      pathNorm(byLabel),
      pathNorm(resolved.executable),
      "resolveExecutableForLabel and resolveDefaultBrowser should agree"
    );
  }

  console.log("default browser resolution OK");
}

function pathNorm(p: string): string {
  return process.platform === "win32" ? p.toLowerCase() : p;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
