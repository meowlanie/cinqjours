import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const { version } = JSON.parse(readFileSync(resolve(root, "extension/manifest.json"), "utf8"));
const zipPath = resolve(root, `public/cinqjours-extension-${version}.zip`);

rmSync(zipPath, { force: true });
execFileSync(
  "zip",
  ["-r", zipPath, "extension", "-x", "*.DS_Store", "-x", "extension/.DS_Store"],
  { cwd: root, stdio: "inherit" }
);

console.log(`Packed extension v${version} → public/cinqjours-extension-${version}.zip`);
