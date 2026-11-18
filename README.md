# Arctic Engines · Voice AI site

Static marketing site for Arctic Engines' Voice AI offering: pricing, languages, a voice-sample library and telephony samples with a transcript viewer.

Plain HTML/CSS/JS, no build step. Hosted on GitHub Pages from `main` / root.

```
index.html            page shell (hero copy, section headings, footer)
styles.css            all styling (brand tokens at the top in :root)
app.js                renders everything from data/*.json, audio players, filters, transcript drawer
data/pricing.json     the three service blocks and their price tables
data/languages.json   tiers, tier prices, per-language voice counts and tags
data/voice-samples.json      one entry per voice sample card
data/telephony-samples.json  telephony intro, stats, specs and the 12 domains
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

- **Voice cloning tier cards:** `data/pricing.json → voice_cloning.tiers[]` (`in_stock`, `custom`). The quick estimate reads the same numbers.
- **Evals table:** `data/pricing.json → evals.groups[].rows[]`. Each row is `[role, tier1, tier2, tier3]`.
- **ASR / telephony table:** `data/pricing.json → asr.rows[]` and `asr.stock[]` (the dotted-leader lines).
- **Tier prices in the Languages section:** `data/languages.json → tier_prices`.
- **Telephony spec block:** `data/telephony-samples.json → specs`.

When a price changes, update it in every place it appears (for example, `$110` appears in both `pricing.json` and `languages.json`).

## Add or change samples

**Voice sample:** add an object to `data/voice-samples.json`:

```json
{ "language": "Hindi", "gender": "Female", "url": "https://storage.googleapis.com/arctic-engine-public/Hindi_Female_2.wav", "type": "audio/wav" }
```

- `language` must match a `language` in `data/languages.json`. That's where the tier pill and voice count come from.
- `type` is `audio/wav`, `audio/mpeg` (mp3), `audio/mp4` (m4a) or `audio/ogg; codecs=opus`. If the browser can't play the type, the card shows a download link instead.
- Several samples with the same language and gender are labelled "Female 1", "Female 2" and so on automatically.

**New language or voice counts:** edit `data/languages.json → languages[]`. Totals, stats and tier counts are computed from it; `unique_speakers` is set by hand.

**Telephony domain:** add an object to `data/telephony-samples.json → domains[]` with `hindi`/`english` → `audio` (.ogg) and `transcript` (.json).

Audio stays on Google Cloud Storage; don't commit audio files to the repo.

## Transcript viewer and CORS

The "View transcript" drawer first `fetch()`es the transcript JSON from GCS. The browser only allows this if the bucket sends CORS headers, and `arctic-public` doesn't send them yet. So the site falls back to copies in `data/transcripts/`, which are mirrored by:

```sh
node scripts/sync-transcripts.mjs   # re-run after adding or changing telephony samples, then commit
```

(The browser console shows one CORS error per transcript opened. That's expected; the fallback copy then loads.)

To serve transcripts straight from GCS and stop needing the mirror, set CORS on the bucket:

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
