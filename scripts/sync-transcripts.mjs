#!/usr/bin/env node
// Mirrors every telephony transcript JSON from GCS into data/transcripts/.
// The site loads transcripts from GCS first and falls back to these copies
// (GCS blocks in-browser fetches until CORS is set on the bucket).
// Re-run after adding or changing telephony samples:  node scripts/sync-transcripts.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "data", "transcripts");
await mkdir(outDir, { recursive: true });
const tel = JSON.parse(await readFile(path.join(root, "data", "telephony-samples.json"), "utf8"));
const urls = tel.domains.flatMap((d) => [d.hindi.transcript, d.english.transcript]);
let failed = 0;
for (const url of urls) {
  const name = url.split("/").pop();
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    await writeFile(path.join(outDir, name), JSON.stringify(json));
    console.log(" ok ", name);
  } catch (e) {
    failed++;
    console.log("FAIL", name, e.message);
  }
}
console.log(`\n${urls.length - failed}/${urls.length} transcripts mirrored to data/transcripts/`);
process.exit(failed ? 1 : 0);
