#!/usr/bin/env node
// HEAD-requests every sample URL in data/*.json and reports failures.
// Usage:  node scripts/check-links.mjs [--cors https://your-pages-origin]
// With --cors it also checks that transcript JSON returns Access-Control-Allow-Origin
// for that origin (needed for the in-page transcript viewer).
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = async (f) => JSON.parse(await readFile(path.join(root, "data", f), "utf8"));

const corsIdx = process.argv.indexOf("--cors");
const corsOrigin = corsIdx > -1 ? process.argv[corsIdx + 1] : null;

const voices = await read("voice-samples.json");
const tel = await read("telephony-samples.json");

const targets = [
  ...voices.map((v) => ({ url: v.url, label: `voice  ${v.language} ${v.gender}` })),
  ...tel.domains.flatMap((d) => [
    { url: d.hindi.audio, label: `tel    ${d.domain} Hindi audio` },
    { url: d.hindi.transcript, label: `tel    ${d.domain} Hindi transcript`, json: true },
    { url: d.english.audio, label: `tel    ${d.domain} English audio` },
    { url: d.english.transcript, label: `tel    ${d.domain} English transcript`, json: true },
  ]),
];

async function check(t) {
  const headers = corsOrigin && t.json ? { Origin: corsOrigin } : {};
  try {
    let res = await fetch(t.url, { method: "HEAD", headers, redirect: "follow" });
    if (res.status === 405 || res.status === 403) {
      res = await fetch(t.url, { method: "GET", headers: { ...headers, Range: "bytes=0-0" } });
    }
    const ok = res.ok || res.status === 206;
    let cors = null;
    if (corsOrigin && t.json) {
      const acao = res.headers.get("access-control-allow-origin");
      cors = acao === "*" || acao === corsOrigin;
    }
    return { ...t, ok, status: res.status, type: res.headers.get("content-type"), size: Number(res.headers.get("content-length")) || 0, cors };
  } catch (e) {
    return { ...t, ok: false, status: e.message };
  }
}

const results = [];
const queue = [...targets];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (queue.length) results.push(await check(queue.shift()));
}));
results.sort((a, b) => targets.indexOf(targets.find((t) => t.url === a.url)) - targets.indexOf(targets.find((t) => t.url === b.url)));

const mb = (n) => (n ? `${(n / 1048576).toFixed(1)} MB` : "");
let failures = 0, corsFail = 0;
for (const r of results) {
  if (!r.ok) failures++;
  if (r.cors === false) corsFail++;
  const flag = r.ok ? (r.cors === false ? "CORS" : " ok ") : "FAIL";
  console.log(`[${flag}] ${String(r.status).padEnd(4)} ${r.label.padEnd(44)} ${mb(r.size).padStart(9)}  ${r.ok ? "" : r.url}`);
}
console.log(`\n${results.length} URLs checked · ${failures} failed${corsOrigin ? ` · ${corsFail} transcript(s) missing CORS for ${corsOrigin}` : ""}`);
process.exit(failures || corsFail ? 1 : 0);
