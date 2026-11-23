# Arctic Engines · Voice AI site

Static marketing site for Arctic Engines' Voice AI offering: a voice library, telephony samples with a transcript viewer, and a rate card.

The layout implements **Voice AI Site v8** from the "Arctic Engines Voice Redesign" Claude Design project. Its colours, spacing and motion come from the Arctic Engines design-system tokens, copied into the top of `styles.css`.

Plain HTML/CSS/JS, no build step. Hosted on GitHub Pages from `main` / root.

```
index.html            page shell (hero, marquees, capabilities, process, reach, section headings, footer, player bar, drawer)
styles.css            all styling (design-system tokens at the top in :root)
app.js                renders library, telephony and rates from data/*.json, draws the hero glyph iceberg and marquees; one shared audio engine for every play button
reach-map.html        the animated globe embedded in the Reach section (d3 + world-atlas from CDNs)
data/pricing.json     the three rate-card tabs and their tables
data/languages.json   tiers, tier prices, per-language voice counts, tags and native-script names
data/voice-samples.json      one entry per voice sample (F / M / F1 / F2 buttons)
data/global-voices.json  the six "Global voices" cards (language, region, native name, code, sample URL)
data/telephony-samples.json  telephony lede, specs and the 12 domains
data/transcripts/     mirrored transcript JSON (fallback while GCS has no CORS)
scripts/sync-transcripts.mjs refreshes data/transcripts/ from GCS
assets/               logos and favicon
scripts/check-links.mjs      HEAD-checks every sample URL
```

## Preview locally

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

(Opening `index.html` straight from disk won't work, because the browser blocks `fetch()` of the JSON files from `file://`.)

## Edit prices

All prices are strings, so they render exactly as written (`"$8–10"`, `"Quote"`, `"$25+"`).

- **Voice cloning tab:** `data/pricing.json → voice_cloning.tiers[]` (`in_stock`, `custom`). The estimator reads the same numbers.
- **Evals tab:** `data/pricing.json → evals.groups[].rows[]`. Each row is `[role, tier1, tier2, tier3]`.
- **ASR & telephony tab:** `data/pricing.json → asr.rows[]` and `asr.stock[]` (the dotted-leader lines).
- **Tier prices above each voice-library column:** `data/languages.json → tier_prices`.
- **Telephony spec block:** `data/telephony-samples.json → specs`.

When a price changes, update it in every place it appears (for example, `$110` appears in both `pricing.json` and `languages.json`).

## Add or change samples

**Voice sample:** add an object to `data/voice-samples.json`:

```json
{ "language": "Hindi", "gender": "Female", "url": "https://storage.googleapis.com/arctic-engine-public/Hindi_Female_2.wav", "type": "audio/wav" }
```

- `language` must match a `language` in `data/languages.json`. The sample appears as a button on that language's row.
- `type` is `audio/wav`, `audio/mpeg` (mp3), `audio/mp4` (m4a) or `audio/ogg; codecs=opus`. If the browser can't play it, the player bar offers a download link instead.
- Several samples with the same language and gender get buttons F1, F2 and so on automatically.

**New language or voice counts:** edit `data/languages.json → languages[]`. `native` is the name shown in the language's own script.

**Telephony domain:** add an object to `data/telephony-samples.json → domains[]` with `hindi`/`english` → `audio` (.ogg) and `transcript` (.json).

Audio stays on Google Cloud Storage; don't commit audio files to the repo.

## Transcript viewer and CORS

The "Transcript ↗" drawer loads the copy in `data/transcripts/` first, then falls back to GCS. The GCS bucket `arctic-public` sends no CORS headers yet, so browsers can't load transcripts from it directly. Refresh the copies with:

```sh
node scripts/sync-transcripts.mjs   # re-run after adding or changing telephony samples, then commit
```

To make the GCS fallback work too, set CORS on the bucket:

```sh
cat > cors.json <<'EOF'
[{ "origin": ["https://vedankbhr.github.io"], "method": ["GET", "HEAD"], "responseHeader": ["Content-Type", "Range"], "maxAgeSeconds": 3600 }]
EOF
gcloud storage buckets update gs://arctic-public --cors-file=cors.json
# (or: gsutil cors set cors.json gs://arctic-public)
```

Add your custom domain to `origin` if you set one up.

## Check links

```sh
node scripts/check-links.mjs                                   # every sample URL
node scripts/check-links.mjs --cors https://vedankbhr.github.io  # also check transcript CORS
```

Requires Node 18+. Exits non-zero if any URL fails.

## Redeploy

Pages deploys from `main` automatically:

```sh
git add -A && git commit -m "Update prices" && git push
```

The live site updates about a minute later. Check progress under the repo's **Actions** tab ("pages build and deployment").
