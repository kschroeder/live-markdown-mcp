import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "packages", "web", "dist");
const dest = path.join(root, "packages", "hub", "dist", "public");

if (!fs.existsSync(path.join(src, "index.html"))) {
  console.warn("[copy-web] web dist missing; hub will serve fallback HTML until web is built");
  process.exit(0);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.cpSync(src, dest, { recursive: true });
console.log("[copy-web] copied web dist → packages/hub/dist/public");
