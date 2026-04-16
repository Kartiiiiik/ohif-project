/**
 * copy-cornerstone-workers.mjs
 *
 * Copies the web worker + codec files that @cornerstonejs/dicom-image-loader
 * needs at runtime into public/ so Vite serves them as static assets.
 *
 * WHY: These files are loaded via `new Worker(url)` at runtime, not through
 * the module graph. Vite/Webpack never bundles them, so they must exist as
 * plain static files the browser can fetch by URL.
 *
 * USAGE: Runs automatically via "postinstall" in package.json.
 *        Can also be run manually:  node scripts/copy-cornerstone-workers.mjs
 */

import { copyFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const SOURCE_DIR = resolve(
  projectRoot,
  "node_modules",
  "@cornerstonejs",
  "dicom-image-loader",
  "dist",
  "dynamic-import"
);

const DEST_DIR = resolve(projectRoot, "public");

const FILES = [
  "cornerstoneWADOImageLoaderWebWorker.min.js",
  "cornerstoneWADOImageLoaderCodecs.min.js",
];

// Ensure public/ exists
mkdirSync(DEST_DIR, { recursive: true });

let copied = 0;

for (const file of FILES) {
  const src = resolve(SOURCE_DIR, file);
  const dest = resolve(DEST_DIR, file);

  if (!existsSync(src)) {
    console.warn(`⚠  Not found: ${src}`);
    console.warn(`   Web worker decoding will be unavailable for this codec.`);
    continue;
  }

  copyFileSync(src, dest);
  copied++;
  console.log(`✓  ${file} → public/`);
}

if (copied === FILES.length) {
  console.log(`\nDone — ${copied} worker files ready in public/`);
} else {
  console.warn(`\nPartial copy — ${copied}/${FILES.length} files found.`);
  console.warn("Check that @cornerstonejs/dicom-image-loader is installed.");
}
