/* Arctic Engines · Voice AI site
 * Plain JS, no build step. All content comes from data/*.json.
 */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** Tiny element helper: h("div.cls", {attr: v}, child, child...) */
  function h(tag, attrs, ...children) {
    const [name, ...classes] = tag.split(".");
    const el = document.createElement(name || "div");
    if (classes.length) el.className = classes.join(" ");
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === "text") el.textContent = v;
        else if (k === "html") el.innerHTML = v;
        else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
        else if (k === "dataset") Object.assign(el.dataset, v);
        else el.setAttribute(k, v === true ? "" : v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  async function loadJSON(path) {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  }

  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const money = (s) => Number(String(s).replace(/[^0-9.]/g, ""));

  /* ===================================================================
   * Audio player (one plays at a time)
   * =================================================================== */
  const ICONS = {
    play: '<svg class="i-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
    pause: '<svg class="i-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
    spin: '<svg class="i-spin" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="34 50" stroke-linecap="round"/></svg>',
  };

  let currentAudio = null;
  const probe = document.createElement("audio");

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return "--:--";
    const s = Math.floor(sec);
    const hrs = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = String(s % 60).padStart(2, "0");
    return hrs ? `${hrs}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
  }

  function fallbackLink(src, why) {
    return h("div.pl-fallback", null,
      h("span", { text: why }),
      h("a", { href: src, download: "", target: "_blank", rel: "noopener", text: "Download sample ↓" }));
  }

  /**
   * createPlayer({ src, type, label, onState })
   * Returns { el, audio, seek(sec), play() }.
   */
  function createPlayer({ src, type, label, onState }) {
    if (type && probe.canPlayType(type) === "") {
      const el = h("div.player.player-unsupported", null,
        fallbackLink(src, "This format can't play in your browser."));
      return { el, audio: null, seek() {}, play() {} };
    }

    const audio = h("audio", { preload: "none" });
    audio.append(h("source", { src, type }));

    const btn = h("button.pl-btn", { type: "button", "aria-label": `Play ${label}`, html: ICONS.play + ICONS.pause + ICONS.spin });
    const seekEl = h("input.pl-seek", { type: "range", min: "0", max: "1000", step: "1", value: "0", "aria-label": `Seek ${label}`, disabled: true });
    const time = h("span.pl-time", { text: "0:00 / --:--", "aria-hidden": "true" });
    const el = h("div.player", { dataset: { state: "idle" } }, btn, seekEl, time, audio);

    let dragging = false;
    let failed = false;

    const setState = (state) => {
      el.dataset.state = state;
      const playing = state === "playing" || state === "loading";
      btn.setAttribute("aria-label", `${playing ? "Pause" : "Play"} ${label}`);
      btn.setAttribute("aria-busy", state === "loading" ? "true" : "false");
      if (onState) onState(state);
    };
    const render = () => {
      const d = audio.duration;
      const t = audio.currentTime;
      if (!dragging && isFinite(d) && d > 0) {
        const p = (t / d) * 1000;
        seekEl.value = String(Math.round(p));
        seekEl.style.setProperty("--p", `${p / 10}%`);
      }
      time.textContent = `${fmtTime(t)} / ${fmtTime(d)}`;
    };
    const fail = () => {
      if (failed) return;
      failed = true;
      if (currentAudio === audio) currentAudio = null;
      el.replaceChildren(fallbackLink(src, "This sample can't play here."));
      el.className = "player player-unsupported";
      if (onState) onState("error");
    };

    btn.addEventListener("click", () => {
      if (audio.paused) {
        if (currentAudio && currentAudio !== audio) currentAudio.pause();
        currentAudio = audio;
        if (audio.readyState < 3) setState("loading");
        const p = audio.play();
        if (p && p.catch) p.catch((err) => {
          if (err && err.name === "NotSupportedError") fail();
          else setState("paused");
        });
      } else {
        audio.pause();
      }
    });

    audio.addEventListener("play", () => {
      if (currentAudio && currentAudio !== audio) currentAudio.pause();
      currentAudio = audio;
    });
    audio.addEventListener("waiting", () => { if (!audio.paused) setState("loading"); });
    audio.addEventListener("playing", () => setState("playing"));
    audio.addEventListener("pause", () => setState("paused"));
    audio.addEventListener("ended", () => { setState("paused"); });
    audio.addEventListener("loadedmetadata", () => { seekEl.disabled = false; render(); });
    audio.addEventListener("durationchange", render);
    audio.addEventListener("timeupdate", render);
    audio.addEventListener("error", fail);
    audio.querySelector("source").addEventListener("error", fail);

    seekEl.addEventListener("input", () => {
      dragging = true;
      const d = audio.duration;
      seekEl.style.setProperty("--p", `${seekEl.value / 10}%`);
      if (isFinite(d)) time.textContent = `${fmtTime((seekEl.value / 1000) * d)} / ${fmtTime(d)}`;
    });
    seekEl.addEventListener("change", () => {
      dragging = false;
      const d = audio.duration;
      if (isFinite(d)) audio.currentTime = (seekEl.value / 1000) * d;
    });

    return {
      el,
      audio,
      seek(sec) {
        if (failed) return;
        const go = () => { audio.currentTime = sec; };
        if (audio.readyState >= 1) go();
        else { audio.preload = "metadata"; audio.addEventListener("loadedmetadata", go, { once: true }); audio.load(); }
      },
      play() { if (!failed && audio.paused) btn.click(); },
    };
  }

  function headline(title, accent) {
    return [title + " ", h("span.accent", { text: accent })];
  }

  /* ===================================================================
   * Pricing
   * =================================================================== */
  function renderPricing(p) {
    const root = $("#pricing-root");
    root.replaceChildren();

    const left = (s) => h("div.svc-left", null,
      h("p.kicker", { text: s.kicker }),
      h("h3", null, headline(s.title, s.title_accent)),
      h("p.svc-copy", { text: s.copy }),
      (s.callouts || []).map((c) => h("p.callout", null, h("b", { text: c.label }), c.text)));

    /* 01 Voice cloning */
    const vc = p.voice_cloning;
    const cards = h("div.price-cards", null, vc.tiers.map((t) =>
      h(`article.price-card.t${t.tier}`, { "aria-label": `Tier ${t.tier} voice cloning prices` },
        h("div.price-card-head", { text: `Tier ${t.tier}` }),
        h("div.price-card-body", null,
          h("p.price-card-langs", { text: t.languages }),
          h("div.price-pair", null,
            h("div", null, h("span.price-label", { text: "In stock" }), h("span.price-val", { text: t.in_stock })),
            h("div", null, h("span.price-label", { text: "Custom" }), h("span.price-val", { text: t.custom })))))));

    // Small estimator using the same numbers
    const tierSel = h("select", { "aria-label": "Tier" }, vc.tiers.map((t) => h("option", { value: t.tier, text: `Tier ${t.tier}` })));
    const kindSel = h("select", { "aria-label": "Stock or custom" }, h("option", { value: "in_stock", text: "In stock" }), h("option", { value: "custom", text: "Custom" }));
    const nInput = h("input", { type: "number", min: "1", max: "999", value: "10", inputmode: "numeric", "aria-label": "Number of voices" });
    const evalBox = h("input", { type: "checkbox" });
    const total = h("output.estimator-total", { "aria-live": "polite" });
    const sub = h("span.estimator-sub");
    const recompute = () => {
      const t = vc.tiers.find((x) => String(x.tier) === tierSel.value);
      const n = Math.max(1, Math.min(999, parseInt(nInput.value, 10) || 1));
      const rate = money(t[kindSel.value]);
      const ev = evalBox.checked ? money(vc.audio_eval_per_voice) : 0;
      total.textContent = "$" + (n * (rate + ev)).toLocaleString("en-US");
      sub.textContent = `${n} voice-hr × $${rate}${ev ? ` + ${n} × $${ev} eval` : ""}`;
    };
    [tierSel, kindSel, nInput, evalBox].forEach((x) => x.addEventListener("input", recompute));
    const est = h("form.estimator", { onsubmit: (e) => e.preventDefault(), "aria-label": "Voice data estimate" },
      h("p.estimator-title", { text: "Quick estimate · 1 hr per voice" }),
      h("label", null, "Tier", tierSel),
      h("label", null, "Type", kindSel),
      h("label", null, "Voices", nInput),
      h("div.estimator-out", null, total, sub),
      h("label.check", null, evalBox, `Add audio evaluation (${vc.audio_eval_per_voice} per voice)`));
    recompute();

    root.append(h("article.svc", { id: vc.id }, left(vc),
      h("div.svc-right", null, cards, h("p.svc-note", { text: vc.note }), est)));

    /* 02 Evals */
    const ev = p.evals;
    const etable = h("table.ptable", null,
      h("caption", { text: ev.note }),
      h("thead", null, h("tr", null, ev.columns.map((c, i) => h(`th${i ? `.t${i}` : ""}`, { scope: "col", text: c })))),
      ev.groups.map((g) => h("tbody", null,
        h("tr.group", null, h("th", { colspan: ev.columns.length, scope: "colgroup", text: g.label })),
        g.rows.map((r) => h("tr", null, r.map((c, i) => i === 0
          ? h("th", { scope: "row", text: c, style: "font-weight:500" })
          : h(`td${c === "Quote" ? ".quote" : ""}`, { text: c })))))));
    root.append(h("article.svc", { id: ev.id }, left(ev),
      h("div.svc-right", null, h("div.table-scroll", { tabindex: "0", role: "region", "aria-label": "Evals pricing table" }, etable))));

    /* 03 ASR & telephony */
    const a = p.asr;
    const leaders = h("ul.leaders", null, a.stock.map((s) => h("li", null,
      h("span.amt", { text: s.amount }), h("span.lbl", { text: s.label }), h("span.dots", { "aria-hidden": "true" }), h("span.pr", { text: s.price }))));
    const atable = h("table.ptable", null,
      h("caption", { text: a.table_caption }),
      h("thead", null, h("tr", null, a.columns.map((c, i) => h(`th${i ? `.t${i}` : ""}`, { scope: "col", text: c })))),
      h("tbody", null, a.rows.map((r) => h(`tr${r.sub ? ".sub" : ""}`, null,
        h("td", { text: r.service }),
        r.span ? h("td.quote", { colspan: 2, text: r.span }) : r.values.map((v) => h("td", { text: v }))))));
    root.append(h("article.svc", { id: a.id },
      h("div.svc-left", null,
        h("p.kicker", { text: a.kicker }),
        h("h3", null, headline(a.title, a.title_accent)),
        h("p.svc-copy", { text: a.copy }),
        h("p.callout", null, h("a", { href: "#telephony", text: "Listen to telephony samples →" }))),
      h("div.svc-right", null, leaders,
        h("div.table-scroll", { tabindex: "0", role: "region", "aria-label": "ASR and telephony pricing table" }, atable),
        h("div.svc-foot", null, a.footer.map((f) => h("p", { text: f }))))));
  }

  /* ===================================================================
   * Languages (tier columns)
   * =================================================================== */
  function renderTiers(data) {
    const root = $("#tiers-root");
    root.replaceChildren();
    for (const tier of [1, 2, 3]) {
      const langs = data.languages.filter((l) => l.tier === tier);
      const tp = data.tier_prices[tier];
      const total = langs.reduce((s, l) => s + l.voices, 0);
      root.append(h(`article.tier.t${tier}`, { "aria-label": `Tier ${tier}` },
        h("div.tier-head", null, h("span", { text: `Tier ${tier}` }), h("span", { text: `${langs.length} languages` })),
        h("div.tier-prices", null,
          h("div", null, h("span.price-label", { text: "In stock" }), h("b", { text: tp.in_stock })),
          h("div", null, h("span.price-label", { text: "Custom" }), h("b", { text: tp.custom })),
          h("div", null, h("span.price-label", { text: "Evals / hr" }), h("b", { text: tp.evals_per_hr }))),
        h("div.count-head", { "aria-hidden": "true", text: "OTS voices" }),
        h("ul.tier-langs", null, langs.map((l) => h("li", null,
          h("a", { href: `#voices`, dataset: { lang: l.language }, "aria-label": `${l.language}: hear samples` , text: l.language }),
          l.note ? h("small", { text: l.note }) : null,
          l.tags.length ? h("span.tags", null, l.tags.map((t) => h(`span.tag.tag-${t.toLowerCase()}`, { text: t }))) : null,
          h("span.count", { text: l.voices, title: `${l.voices} off-the-shelf voices` })))),
        h("div.tier-total", null, h("span", { text: "Total" }), h("span", { text: total }))));
    }
  }

  /* ===================================================================
   * Voice library
   * =================================================================== */
  function renderVoices(samples, langData) {
    const byLang = Object.fromEntries(langData.languages.map((l) => [l.language, l]));
    const L = langData.languages;
    const sum = (k) => L.reduce((s, l) => s + l[k], 0);

    $("#voice-stats").replaceChildren(
      ...[
        [sum("voices"), "voices, 1 hr each"],
        [L.length, "languages"],
        [langData.unique_speakers, "unique speakers"],
        [`${sum("female")} / ${sum("male")}`, "female / male voices"],
      ].map(([v, l]) => h("div", null, h("dt", { text: l }), h("dd", { text: v }))));

    // number duplicates: "Female 1", "Female 2"
    const seen = {};
    const totals = {};
    samples.forEach((s) => { const k = s.language + s.gender; totals[k] = (totals[k] || 0) + 1; });

    const grid = $("#voice-grid");
    grid.replaceChildren();
    const cards = samples.map((s) => {
      const lang = byLang[s.language] || { tier: 0, voices: 0, female: 0, male: 0 };
      const k = s.language + s.gender;
      seen[k] = (seen[k] || 0) + 1;
      const gLabel = totals[k] > 1 ? `${s.gender} ${seen[k]}` : s.gender;
      const label = `${s.language} ${gLabel.toLowerCase()} voice sample`;
      let card;
      const player = createPlayer({
        src: s.url, type: s.type, label,
        onState: (st) => card && card.classList.toggle("is-playing", st === "playing" || st === "loading"),
      });
      card = h(`article.vcard.t${lang.tier}`, {
        id: `voice-${slug(s.language)}-${slug(gLabel)}`,
        dataset: { lang: s.language.toLowerCase(), tier: lang.tier, gender: s.gender },
      },
        h("div.vcard-top", null,
          h("div", null, h("h3", { text: s.language }), h("p.vcard-gender", { text: gLabel })),
          h("span.pill", { text: `Tier ${lang.tier}` })),
        h("p.vcard-meta", { text: `${lang.voices} voices · ${lang.female}F / ${lang.male}M` }),
        player.el);
      card._audio = player.audio;
      grid.append(card);
      return card;
    });

    const state = { tier: "all", gender: "all", q: "", exact: false };
    const apply = () => {
      const q = state.q.trim().toLowerCase();
      let shown = 0;
      for (const c of cards) {
        const ok = (state.tier === "all" || c.dataset.tier === state.tier)
          && (state.gender === "all" || c.dataset.gender === state.gender)
          && (!q || (state.exact ? c.dataset.lang === q : c.dataset.lang.includes(q)));
        c.hidden = !ok;
        if (!ok && c._audio && !c._audio.paused) c._audio.pause();
        if (ok) shown++;
      }
      $("#voice-count").textContent = `Showing ${shown} of ${cards.length} samples`;
      $("#voice-empty").hidden = shown > 0;
    };

    $$('input[name="tier"]').forEach((r) => r.addEventListener("change", () => { state.tier = r.value; apply(); }));
    $$('input[name="gender"]').forEach((r) => r.addEventListener("change", () => { state.gender = r.value; apply(); }));
    const search = $("#lang-search");
    search.addEventListener("input", () => { state.q = search.value; state.exact = false; apply(); });
    const reset = () => {
      state.tier = "all"; state.gender = "all"; state.q = ""; state.exact = false;
      search.value = "";
      $('input[name="tier"][value="all"]').checked = true;
      $('input[name="gender"][value="all"]').checked = true;
      apply();
    };
    $("#voice-reset").addEventListener("click", reset);

    // Language links in the tier table jump to that language's samples
    document.addEventListener("click", (e) => {
      const a = e.target.closest("a[data-lang]");
      if (!a) return;
      e.preventDefault();
      reset();
      state.q = a.dataset.lang; state.exact = true; search.value = a.dataset.lang;
      apply();
      const first = cards.find((c) => !c.hidden);
      const target = first || $("#voices");
      history.replaceState(null, "", "#voices");
      target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      if (first) {
        cards.filter((c) => !c.hidden).forEach((c) => { c.classList.remove("is-flash"); void c.offsetWidth; c.classList.add("is-flash"); });
        const b = first.querySelector(".pl-btn, a");
        if (b) setTimeout(() => b.focus({ preventScroll: true }), 400);
      }
    });

    apply();
  }

  /* ===================================================================
   * Telephony
   * =================================================================== */
  function renderTelephony(t) {
    $("#tel-intro").textContent = t.intro;
    $("#tel-stats").replaceChildren(...t.stats.map((s) => h("div", null, h("dt", { text: s.label }), h("dd", { text: s.value }))));
    $("#tel-specs").replaceChildren(...t.specs.map(([k, v]) => h("div", null, h("dt", { text: k }), h("dd", { text: v }))));

    const grid = $("#tel-grid");
    grid.replaceChildren();
    for (const d of t.domains) {
      const call = (langName, key, count) => {
        const s = d[key];
        const label = `${d.domain} ${langName} call`;
        const player = createPlayer({ src: s.audio, type: t.audio_type, label });
        return h("div.tcall", null,
          h("div.tcall-top", null,
            h("span.tcall-lang", null, langName, h("small", { text: `${count} calls` })),
            h("button.tx-btn", {
              type: "button",
              "aria-label": `View transcript: ${label}`,
              onclick: (e) => openTranscript({ domain: d.domain, langName, key, audio: s.audio, transcript: s.transcript, type: t.audio_type, opener: e.currentTarget }),
              html: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M5 5h14M5 10h14M5 15h9M5 20h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>View transcript',
            })),
          player.el);
      };
      grid.append(h("article.tcard", { "aria-label": d.domain },
        h("div.tcard-head", null, h("h3", { text: d.domain }), h("span.tcard-calls", { text: `${d.hindi_calls + d.english_calls} calls in sample set` })),
        call("Hindi", "hindi", d.hindi_calls),
        call("Indian English", "english", d.english_calls)));
    }
  }

  /* ===================================================================
   * Transcript drawer
   * =================================================================== */
  const drawer = $("#drawer");
  const backdrop = $("#drawer-backdrop");
  let drawerPlayer = null;
  let lastOpener = null;
  let segEls = [];
  const txCache = new Map();

  function parseTs(ts) {
    // "HH:MM:SS:mmm" -> ms
    const p = String(ts).split(":").map(Number);
    if (p.length !== 4 || p.some(isNaN)) return NaN;
    return ((p[0] * 60 + p[1]) * 60 + p[2]) * 1000 + p[3];
  }
  function fmtMs(ms) {
    if (!isFinite(ms)) return "--";
    const total = ms / 1000;
    const m = Math.floor(total / 60);
    const s = (total % 60).toFixed(1).padStart(4, "0");
    return `${String(m).padStart(2, "0")}:${s}`;
  }
  function fmtDur(ts) {
    const ms = parseTs(ts);
    if (!isFinite(ms)) return ts || "";
    return fmtTime(ms / 1000);
  }

  function closeDrawer() {
    if (drawer.hidden) return;
    if (drawerPlayer && drawerPlayer.audio) drawerPlayer.audio.pause();
    drawer.classList.remove("open");
    backdrop.classList.remove("open");
    document.body.classList.remove("drawer-open");
    const done = () => { drawer.hidden = true; backdrop.hidden = true; $("#drawer-player").replaceChildren(); };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) done(); else setTimeout(done, 250);
    if (lastOpener) lastOpener.focus();
  }

  async function openTranscript({ domain, langName, key, audio, transcript, type, opener }) {
    lastOpener = opener;
    $("#drawer-kicker").textContent = `Transcript · ${langName}`;
    $("#drawer-title").textContent = domain;
    $("#drawer-meta").textContent = "";
    $("#drawer-raw").href = transcript;

    if (currentAudio) currentAudio.pause();
    drawerPlayer = createPlayer({ src: audio, type, label: `${domain} ${langName} call` });
    $("#drawer-player").replaceChildren(drawerPlayer.el);

    const body = $("#drawer-body");
    body.replaceChildren(h("div.drawer-state.mono", { text: "Loading transcript…" }));
    segEls = [];

    drawer.hidden = false; backdrop.hidden = false;
    document.body.classList.add("drawer-open");
    requestAnimationFrame(() => { drawer.classList.add("open"); backdrop.classList.add("open"); });
    $("#drawer-close").focus();

    // GCS first (source of truth); fall back to the mirrored copy in
    // data/transcripts/ while the bucket has no CORS (see README).
    let data = txCache.get(transcript);
    if (!data) {
      try {
        data = await loadJSON(transcript);
      } catch (err) {
        try {
          data = await loadJSON(`data/transcripts/${transcript.split("/").pop()}`);
        } catch (err2) {
          console.warn("[transcript] could not fetch", transcript, err, err2);
        }
      }
      if (data) txCache.set(transcript, data);
    }
    if (!data) {
      body.replaceChildren(h("div.drawer-state", null,
        h("p", { text: "This transcript couldn't be loaded inside the page. You can open the raw JSON file directly." }),
        h("a.btn.btn-primary", { href: transcript, target: "_blank", rel: "noopener", text: "Open raw JSON ↗" })));
      return;
    }

    const md = data.metadata || {};
    const segs = (data.segments || [])
      .map((s) => ({ ...s, _start: parseTs(s.start_time), _end: parseTs(s.end_time) }))
      .sort((a, b) => (a._start - b._start) || (a._end - b._end));

    const meta = [];
    if (md.total_duration) meta.push(`Duration ${fmtDur(md.total_duration)}`);
    if (md.speaker_count) meta.push(`${md.speaker_count} speakers`);
    meta.push(`${segs.length} segments`);
    const interrupted = segs.filter((s) => s.interrupted).length;
    if (interrupted) meta.push(`${interrupted} interrupted`);
    if (md.annotation_date) {
      const d = new Date(md.annotation_date);
      if (!isNaN(d)) meta.push(`Annotated ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`);
    }
    $("#drawer-meta").textContent = meta.join(" · ");

    const lang = key === "hindi" ? "hi" : "en-IN";
    const list = h("ol.segs", { "aria-label": "Conversation segments" });
    segEls = segs.map((s) => {
      const spk = s.speaker === 2 ? 2 : 1;
      const li = h(`li.seg.s${spk}`, null,
        h("button", {
          type: "button",
          title: "Play from here",
          onclick: () => { drawerPlayer.seek(s._start / 1000); drawerPlayer.play(); },
        },
          h("span.seg-meta", null,
            h("span.spk", { text: `Speaker ${spk}` }),
            h("span", { text: `${fmtMs(s._start)}–${fmtMs(s._end)}` }),
            s.interrupted ? h("span.badge-int", { text: "interrupted" }) : null),
          h("span.seg-text", { lang, text: s.transcript || "" })));
      li._start = s._start; li._end = s._end;
      list.append(li);
      return li;
    });
    body.replaceChildren(list);

    // Highlight the segment under the playhead
    if (drawerPlayer.audio) {
      let active = null;
      drawerPlayer.audio.addEventListener("timeupdate", () => {
        const ms = drawerPlayer.audio.currentTime * 1000;
        let hit = null;
        for (const li of segEls) { if (li._start <= ms && ms < li._end) hit = li; if (li._start > ms) break; }
        if (hit !== active) {
          if (active) active.classList.remove("active");
          if (hit) { hit.classList.add("active"); hit.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
          active = hit;
        }
      });
    }
  }

  $("#drawer-close").addEventListener("click", closeDrawer);
  backdrop.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (drawer.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); closeDrawer(); }
    if (e.key === "Tab") {
      const f = $$('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])', drawer).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ===================================================================
   * Nav: highlight current section
   * =================================================================== */
  function initNav() {
    const links = $$(".subnav ul a");
    const map = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        links.forEach((a) => a.removeAttribute("aria-current"));
        const a = map.get(en.target.id);
        if (a) { a.setAttribute("aria-current", "true"); a.scrollIntoView({ block: "nearest", inline: "nearest" }); }
      }
    }, { rootMargin: "-45% 0px -50% 0px" });
    map.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
  }

  /* ===================================================================
   * Boot
   * =================================================================== */
  async function boot() {
    initNav();
    const fail = (sel, what) => (err) => {
      console.error(err);
      const el = $(sel);
      if (el) el.replaceChildren(h("p.loading.mono", { text: `Couldn't load ${what}. Please refresh.` }));
    };
    const [pricing, langs, voices, tel] = await Promise.allSettled([
      loadJSON("data/pricing.json"),
      loadJSON("data/languages.json"),
      loadJSON("data/voice-samples.json"),
      loadJSON("data/telephony-samples.json"),
    ]);
    pricing.status === "fulfilled" ? renderPricing(pricing.value) : fail("#pricing-root", "pricing")(pricing.reason);
    if (langs.status === "fulfilled") {
      renderTiers(langs.value);
      voices.status === "fulfilled" ? renderVoices(voices.value, langs.value) : fail("#voice-grid", "voice samples")(voices.reason);
    } else {
      fail("#tiers-root", "languages")(langs.reason);
      fail("#voice-grid", "voice samples")(langs.reason);
    }
    tel.status === "fulfilled" ? renderTelephony(tel.value) : fail("#tel-grid", "telephony samples")(tel.reason);

    // honour a deep link once content exists
    if (location.hash) {
      const t = document.getElementById(location.hash.slice(1));
      if (t) t.scrollIntoView();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
