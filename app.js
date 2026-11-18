/* Arctic Engines · Voice AI site (v5 design)
 * Plain JS, no build step. All content comes from data/*.json.
 * One shared <audio> engine drives every play button, the "now playing" bar
 * and the transcript drawer, so only one recording ever plays at a time.
 */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** h("div.cls", {attr}, ...children) */
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
        else if (k === "style") el.style.cssText = v;
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

  const money = (s) => Number(String(s).replace(/[^0-9.]/g, ""));
  const fmt = (s) => { if (!isFinite(s) || s < 0) s = 0; const m = Math.floor(s / 60), x = Math.floor(s % 60); return m + ":" + String(x).padStart(2, "0"); };
  const ts = (str) => { const p = String(str).split(":").map(Number); return p.length === 4 && !p.some(isNaN) ? p[0] * 3600 + p[1] * 60 + p[2] + p[3] / 1000 : 0; };
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const ICON = (n) =>
    `<svg class="i-play" width="${n}" height="${n}" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>` +
    `<svg class="i-pause" width="${n}" height="${n}" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4h4v16h-4zM13.5 4h4v16h-4z" fill="currentColor"/></svg>` +
    `<svg class="i-spin" width="${n}" height="${n}" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="34 50" stroke-linecap="round"/></svg>`;

  /* =====================================================================
   * Audio engine
   * ===================================================================== */
  const ITEMS = {};            // key -> { url, type, label, native, title, sub }
  const audio = new Audio();
  audio.preload = "none";
  const probe = document.createElement("audio");
  const st = { cur: null, err: null, waiting: false };

  function play(key, at) {
    const it = ITEMS[key];
    if (!it) return;
    if (st.cur !== key) {
      st.cur = key; st.err = null; st.waiting = true;
      if (it.type && probe.canPlayType(it.type) === "") { audio.pause(); audio.removeAttribute("src"); st.err = key; st.waiting = false; sync(); return; }
      audio.src = it.url;
    }
    if (at != null) {
      if (audio.readyState >= 1) audio.currentTime = at;
      else audio.addEventListener("loadedmetadata", () => { audio.currentTime = at; }, { once: true });
    }
    if (st.err === key) { sync(); return; }
    st.waiting = audio.readyState < 3;
    const p = audio.play();
    if (p && p.catch) p.catch((e) => { if (e && e.name === "NotSupportedError") { st.err = key; } st.waiting = false; sync(); });
    sync();
  }
  function toggle(key) {
    if (st.cur === key && !audio.paused) audio.pause();
    else play(key);
  }
  function seekTo(key, frac) {
    frac = Math.min(1, Math.max(0, frac));
    if (st.cur === key && audio.duration) {
      audio.currentTime = frac * audio.duration;
      if (audio.paused) play(key);
    } else {
      play(key);
      audio.addEventListener("loadedmetadata", () => { audio.currentTime = frac * audio.duration; }, { once: true });
    }
  }
  function nudge(key, secs) {
    if (st.cur === key && audio.duration) audio.currentTime = Math.min(audio.duration, Math.max(0, audio.currentTime + secs));
    else play(key);
  }
  function stop() {
    audio.pause(); audio.removeAttribute("src"); audio.load();
    st.cur = null; st.err = null; st.waiting = false;
    sync();
  }
  ["play", "pause", "ended", "loadedmetadata", "durationchange"].forEach((ev) => audio.addEventListener(ev, sync));
  audio.addEventListener("waiting", () => { st.waiting = true; sync(); });
  audio.addEventListener("playing", () => { st.waiting = false; sync(); });
  audio.addEventListener("timeupdate", syncProgress);
  audio.addEventListener("error", () => {
    // Ignore aborts and late errors from a source we've already switched away from.
    const it = st.cur && ITEMS[st.cur];
    const code = audio.error ? audio.error.code : 0;
    if (!it || code === 1 /* MEDIA_ERR_ABORTED */ || audio.getAttribute("src") !== it.url) return;
    st.err = st.cur; st.waiting = false; sync();
  });

  const isOn = (k) => st.cur === k;
  const isPlaying = (k) => st.cur === k && !audio.paused && st.err !== k;
  const pct = (k) => (isOn(k) && audio.duration ? (audio.currentTime / audio.duration) * 100 : 0);
  const timeOf = (k) => {
    if (!isOn(k)) return "0:00";
    if (st.err === k) return "Can't play here";
    if (!audio.paused && st.waiting && audio.currentTime === 0) return "Loading…";
    return fmt(audio.currentTime) + " / " + fmt(audio.duration);
  };

  /** Re-render every control bound to a key (cheap: a few dozen nodes). */
  function sync() {
    for (const el of $$("[data-key]")) {
      const k = el.dataset.key;
      const on = isOn(k), pl = isPlaying(k), ld = pl && st.waiting;
      el.classList.toggle("on", on);
      const ico = el.classList.contains("ico") ? el : el.querySelector(".ico");
      if (ico) { ico.classList.toggle("is-playing", pl && !ld); ico.classList.toggle("is-loading", ld); }
      if (el.dataset.label) el.setAttribute("aria-label", `${pl ? "Pause" : "Play"} ${el.dataset.label}`);
    }
    for (const row of $$("[data-keys]")) row.classList.toggle("on", !!st.cur && row.dataset.keys.split(" ").includes(st.cur));
    syncBar();
    syncProgress();
  }

  function syncProgress() {
    progAny();
    for (const el of $$("[data-prog]")) el.style.width = pct(el.dataset.prog).toFixed(2) + "%";
    for (const el of $$('[role="slider"][data-seek]')) el.setAttribute("aria-valuenow", Math.round(pct(el.dataset.seek)));
    // now-playing waveform + time
    if (st.cur) {
      const p = pct(st.cur) / 100;
      const bars = npWave.children;
      for (let i = 0; i < bars.length; i++) bars[i].classList.toggle("p", (i + 0.5) / bars.length <= p);
      if (st.err !== st.cur) npTime.textContent = timeOf(st.cur);
    }
    // drawer
    if (dr) {
      $("#dr-time").textContent = timeOf(dr.key);
      highlightSegment();
    }
  }

  /* ---------------- seekable elements (click + keyboard) ---------------- */
  function bindSeek(el, getKey) {
    el.addEventListener("click", (e) => {
      const k = getKey(); if (!k) return;
      const r = el.getBoundingClientRect();
      seekTo(k, (e.clientX - r.left) / r.width);
    });
    el.addEventListener("keydown", (e) => {
      const k = getKey(); if (!k) return;
      if (e.key === "ArrowRight") { e.preventDefault(); nudge(k, 5); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); nudge(k, -5); }
      else if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(k); }
    });
  }

  /* =====================================================================
   * Now-playing bar
   * ===================================================================== */
  const np = $("#np"), npWave = $("#np-wave"), npTime = $("#np-time"), npToggle = $("#np-toggle");
  npToggle.classList.add("ico");
  npToggle.innerHTML = ICON(16);
  let npKey = null;

  function hash(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
  function bars(seed, n) {
    let x = hash(seed); const out = [];
    for (let i = 0; i < n; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      const r = x / 4294967296, env = 0.4 + 0.6 * Math.sin(((i + 0.5) / n) * Math.PI);
      out.push(Math.round((0.14 + 0.86 * (0.3 + 0.7 * r) * env) * 100));
    }
    return out;
  }

  function syncBar() {
    const k = st.cur;
    const show = !!k;
    np.classList.toggle("show", show);
    np.setAttribute("aria-hidden", show ? "false" : "true");
    $$("button, [role=slider]", np).forEach((b) => (b.tabIndex = show ? 0 : -1));
    if (!k) { npKey = null; return; }
    const it = ITEMS[k];
    if (npKey !== k) {
      npKey = k;
      $("#np-native").textContent = it.native;
      $("#np-title").textContent = it.title;
      npWave.replaceChildren(...bars(k, 64).map((v) => h("span", { style: `height:${v}%` })));
      npToggle.dataset.key = k;
      npWave.dataset.seek = k;
      npToggle.dataset.label = it.label;
    }
    if (st.err === k) {
      $("#np-sub").textContent = "Can't play in this browser";
      npTime.replaceChildren(h("a", { href: it.url, download: "", target: "_blank", rel: "noopener", text: "Download ↓" }));
    } else {
      $("#np-sub").textContent = it.sub;
    }
    const pl = isPlaying(k), ld = pl && st.waiting;
    npToggle.classList.toggle("is-playing", pl && !ld);
    npToggle.classList.toggle("is-loading", ld);
    npToggle.setAttribute("aria-label", `${pl ? "Pause" : "Play"} ${it.label}`);
  }
  npToggle.addEventListener("click", () => st.cur && toggle(st.cur));
  $("#np-close").addEventListener("click", stop);
  bindSeek(npWave, () => st.cur);
  npWave.dataset.seek = "";

  /* =====================================================================
   * Overview: iceberg diagram intro + rate-card shortcuts
   * ===================================================================== */
  function initBerg() {
    const items = [...$$(".berg-above"), ...$$(".berg-below")];
    items.forEach((el, i) => (reduceMotion ? el.classList.add("in") : setTimeout(() => el.classList.add("in"), 250 + (i + 1) * 140)));
    $$(".berg-above").forEach((a) => a.addEventListener("click", () => selectTab(Number(a.dataset.tab))));
  }

  /* =====================================================================
   * 01 Voice library
   * ===================================================================== */
  function renderLibrary(samples, langData) {
    const extLabel = (url) => { const e = url.split(".").pop().toLowerCase(); return e === "mpeg" ? "MP3" : e.toUpperCase(); };
    // group samples per language, female first, number duplicates
    const byLang = {};
    for (const s of samples) (byLang[s.language] = byLang[s.language] || []).push(s);
    for (const list of Object.values(byLang)) {
      list.sort((a, b) => (a.gender === b.gender ? 0 : a.gender === "Female" ? -1 : 1));
      const count = {}, seen = {};
      list.forEach((s) => { count[s.gender] = (count[s.gender] || 0) + 1; });
      list.forEach((s) => {
        seen[s.gender] = (seen[s.gender] || 0) + 1;
        const multi = count[s.gender] > 1;
        s._label = multi ? `${s.gender} ${seen[s.gender]}` : s.gender;
        s._short = s.gender[0] + (multi ? seen[s.gender] : "");
        s._key = s.url.split("/").pop().replace(/\.[^.]+$/, "");
      });
    }

    const root = $("#lib");
    root.replaceChildren();
    for (const tier of [1, 2, 3]) {
      const tp = langData.tier_prices[tier];
      const langs = langData.languages.filter((l) => l.tier === tier);
      const col = h("div.tier", { role: "group", "aria-label": `Tier ${tier}` },
        h("div.tier-head", null,
          h("b", { text: `Tier ${tier}` }),
          h("span", { text: `${tp.in_stock} stock · ${tp.custom} custom · evals ${tp.evals_per_hr}${tp.evals_per_hr === "Quote" ? "" : "/hr"}` })));

      for (const l of langs) {
        const vs = byLang[l.language] || [];
        const meta = [`${l.voices} ${l.voices === 1 ? "voice" : "voices"}`, `${l.female}F ${l.male}M`]
          .concat(l.tags.includes("EVALS") ? ["evals"] : [], l.tags.includes("ASR") ? ["ASR"] : []).join(" · ");
        const row = h("div.lang", { id: `lang-${l.language.toLowerCase().replace(/[^a-z]+/g, "-")}`, dataset: { keys: vs.map((v) => v._key).join(" ") } },
          h("span.lang-native", { text: l.native || l.language, lang: l.language === "Indian English" ? "en" : null, "aria-hidden": "true" }),
          h("span.lang-name", null, h("b", { text: l.language + (l.note ? " " + l.note : "") }), h("span", { text: meta })),
          h("span.variants", null, vs.map((v) => {
            const label = `${l.language} ${v._label.toLowerCase()}`;
            ITEMS[v._key] = { url: v.url, type: v.type, label, native: l.native || l.language, title: `${l.language} · ${v._label}`, sub: `Voice sample · ${extLabel(v.url)}` };
            return h("button.var-btn", { type: "button", title: `Play ${label}`, "aria-label": `Play ${label}`, dataset: { key: v._key, label }, onclick: () => toggle(v._key) },
              h("span.ico", { html: ICON(9) }), h("span", { text: v._short }));
          })),
          h("span.lang-prog", { dataset: { prog: vs[0] ? vs[0]._key : "" } }));
        // progress bar follows whichever variant of this language is active
        if (vs.length > 1) row.querySelector(".lang-prog").dataset.progAny = row.dataset.keys;
        col.append(row);
      }
      root.append(col);
    }
  }
  // .lang-prog with several variants: point it at the active one
  function progAny() {
    for (const el of $$("[data-prog-any]")) {
      const keys = el.dataset.progAny.split(" ");
      el.dataset.prog = st.cur && keys.includes(st.cur) ? st.cur : keys[0];
    }
  }

  /* =====================================================================
   * 02 Telephony
   * ===================================================================== */
  function renderTelephony(t) {
    $("#tel-lede").textContent = t.lede || t.intro;
    $("#tel-sample").textContent = t.sample_set || "";
    $("#tel-specs").replaceChildren(...t.specs.map(([k, v]) => h("div", null, h("dt", { text: k }), h("dd", { text: v }))));

    const rows = $("#tel-rows");
    rows.replaceChildren();
    t.domains.forEach((d, i) => {
      const lane = (langName, short, s) => {
        const id = s.audio.split("/").pop().replace(/\.[^.]+$/, "");
        const key = "tel-" + id;
        const label = `${d.domain} ${langName} call`;
        ITEMS[key] = {
          url: s.audio, type: t.audio_type, label,
          native: langName === "Hindi" ? "हिन्दी" : "EN",
          title: d.domain, sub: `Telephony · ${langName} · dual-channel`,
          domain: d.domain, langName, transcript: s.transcript, id,
        };
        const seek = h("div.seek", { role: "slider", tabindex: "0", "aria-label": `Seek ${label}`, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0", dataset: { seek: key } },
          h("div.track", null, h("div.fill", { dataset: { prog: key } })));
        bindSeek(seek, () => key);
        return h("div.lane", null,
          h("span.lane-lang", { text: short, "aria-hidden": "true" }),
          h("button.lane-btn.ico", { type: "button", "aria-label": `Play ${label}`, dataset: { key, label }, onclick: () => toggle(key), html: ICON(10) }),
          seek,
          h("button.tx-btn", { type: "button", "aria-label": `Transcript: ${label}`, onclick: (e) => openTranscript(key, e.currentTarget), text: "Transcript ↗" }));
      };
      rows.append(h("div.tel-row", null,
        h("div.tel-domain", null,
          h("span.idx", { text: String(i + 1).padStart(2, "0") }),
          h("b", { text: d.domain }),
          h("span.calls", { text: `${d.hindi_calls} HI · ${d.english_calls} EN` })),
        lane("Hindi", "HI", d.hindi),
        lane("English", "EN", d.english)));
    });
  }

  /* =====================================================================
   * Transcript drawer
   * ===================================================================== */
  const drawer = $("#drawer"), scrim = $("#scrim"), drBody = $("#dr-body");
  let dr = null, segEls = [], activeSeg = null, opener = null;
  const drToggle = $("#dr-toggle");
  drToggle.classList.add("ico");
  drToggle.innerHTML = ICON(16);
  drToggle.addEventListener("click", () => dr && toggle(dr.key));
  bindSeek($("#dr-seek"), () => dr && dr.key);

  async function openTranscript(key, from) {
    const it = ITEMS[key];
    opener = from;
    dr = { key };
    $("#dr-kicker").textContent = `Telephony · ${it.langName}`;
    $("#dr-title").textContent = it.domain;
    $("#dr-meta").textContent = "";
    $("#dr-raw").href = it.transcript;
    drToggle.dataset.key = key; drToggle.dataset.label = it.label;
    $("#dr-seek").dataset.seek = key;
    $("#dr-fill").dataset.prog = key;
    drBody.replaceChildren(h("p.dr-state", { text: "Loading transcript…" }));
    segEls = []; activeSeg = null;

    drawer.hidden = false; scrim.hidden = false;
    document.body.classList.add("drawer-open");
    $("#dr-close").focus();
    sync();

    // local mirror first (GCS has no CORS yet), then GCS
    let data = null;
    for (const src of [`data/transcripts/${it.id}.json`, it.transcript]) {
      try { data = await loadJSON(src); break; } catch (e) { /* try next */ }
    }
    if (!dr || dr.key !== key) return;
    if (!data) {
      $("#dr-meta").textContent = "Transcript unavailable";
      drBody.replaceChildren(h("div.dr-state", null,
        h("span", { text: "This transcript couldn't be loaded inside the page." }),
        h("a.btn.btn-primary", { href: it.transcript, target: "_blank", rel: "noopener", text: "Open raw JSON ↗" })));
      return;
    }
    const segs = (data.segments || [])
      .map((g) => ({ ...g, s0: ts(g.start_time), s1: ts(g.end_time) }))
      .sort((a, b) => a.s0 - b.s0 || a.s1 - b.s1);
    const spk = new Set(segs.map((g) => g.speaker)).size;
    const last = segs.length ? Math.max(...segs.map((g) => g.s1)) : 0;
    $("#dr-meta").textContent = `${segs.length} segments · ${spk} ${spk === 1 ? "speaker" : "speakers"} · ${fmt(last)}`;
    const lang = it.langName === "Hindi" ? "hi" : "en-IN";
    segEls = segs.map((g) => {
      const b = h(`button.seg.s${g.speaker === 2 ? 2 : 1}`, { type: "button", title: "Play from here", onclick: () => play(key, g.s0) },
        h("span.seg-t", { text: fmt(g.s0) }),
        h("span.seg-c", null,
          h("span.seg-who", null, h("span", { text: `Speaker ${g.speaker}` }), g.interrupted ? h("span.overlap", { text: "overlap" }) : null),
          h("span.seg-x", { lang, text: g.transcript || "" })));
      b._s0 = g.s0; b._s1 = g.s1;
      return b;
    });
    drBody.replaceChildren(...segEls);
    highlightSegment();
  }

  function highlightSegment() {
    if (!dr || !segEls.length) return;
    const now = isOn(dr.key) ? audio.currentTime : -1;
    let hit = null;
    for (const el of segEls) { if (now >= el._s0 && now < el._s1 + 0.25) hit = el; if (el._s0 > now) break; }
    if (hit === activeSeg) return;
    if (activeSeg) activeSeg.classList.remove("on");
    activeSeg = hit;
    if (hit) {
      hit.classList.add("on");
      // scroll only the drawer body, never the page
      drBody.scrollTo({ top: hit.offsetTop - drBody.clientHeight / 3, behavior: reduceMotion ? "auto" : "smooth" });
    }
  }

  function closeDrawer() {
    if (!dr) return;
    dr = null;
    drawer.hidden = true; scrim.hidden = true;
    document.body.classList.remove("drawer-open");
    delete drToggle.dataset.key;
    if (opener) opener.focus();
  }
  $("#dr-close").addEventListener("click", closeDrawer);
  scrim.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (!dr) return;
    if (e.key === "Escape") { e.preventDefault(); closeDrawer(); }
    if (e.key === "Tab") {
      const f = $$('a[href], button:not([disabled]), [tabindex="0"]', drawer).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* =====================================================================
   * 03 Rate card
   * ===================================================================== */
  const tabs = $$('.tabs [role="tab"]');
  function selectTab(i, focus) {
    tabs.forEach((t, j) => {
      t.setAttribute("aria-selected", String(i === j));
      t.tabIndex = i === j ? 0 : -1;
      const p = document.getElementById(t.getAttribute("aria-controls"));
      if (p) p.hidden = i !== j;
    });
    if (focus) tabs[i].focus();
  }
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => selectTab(i));
    t.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { e.preventDefault(); selectTab((i + 1) % tabs.length, true); }
      if (e.key === "ArrowLeft") { e.preventDefault(); selectTab((i + tabs.length - 1) % tabs.length, true); }
    });
  });

  function renderRates(p) {
    const root = $("#rates-root");
    root.replaceChildren();
    const panel = (i, copy, data) => h("div.panel", { id: `panel-${i}`, role: "tabpanel", "aria-labelledby": `tab-${i}`, hidden: i !== 0 }, copy, data);
    const copy = (title, text, callouts) => h("div.panel-copy", null,
      h("h3", { text: title }), h("p", { text }),
      callouts.map((c, j) => h("p.callout", null, h(`span.callout-k${j > 0 ? ".muted" : ""}`, { text: `${c.label} · ` }), c.text)));

    /* Voice cloning */
    const vc = p.voice_cloning;
    const est = { tier: 1, mode: "in_stock", n: 10, ev: true };
    const total = h("span.est-total", { "aria-live": "polite" });
    const nOut = h("output");
    const segBtn = (label, pressed, onclick) => h("button", { type: "button", "aria-pressed": String(pressed), onclick, text: label });
    const tierCtl = h("div.segctl", { role: "group", "aria-label": "Tier" });
    const modeCtl = h("div.segctl", { role: "group", "aria-label": "Stock or custom" });
    const evalPrice = money(vc.audio_eval_per_voice);
    const recompute = () => {
      tierCtl.replaceChildren(...vc.tiers.map((t) => segBtn(`T${t.tier}`, est.tier === t.tier, () => { est.tier = t.tier; recompute(); })));
      modeCtl.replaceChildren(segBtn("Stock", est.mode === "in_stock", () => { est.mode = "in_stock"; recompute(); }), segBtn("Custom", est.mode === "custom", () => { est.mode = "custom"; recompute(); }));
      const t = vc.tiers.find((x) => x.tier === est.tier);
      const unit = money(t[est.mode]);
      total.textContent = "$" + (est.n * unit + (est.ev ? est.n * evalPrice : 0)).toLocaleString("en-US");
      nOut.textContent = `${est.n} ${est.n === 1 ? "voice" : "voices"}`;
    };
    const range = h("input", { type: "range", min: "1", max: "50", value: String(est.n), "aria-label": "Number of voices", oninput: (e) => { est.n = Number(e.target.value); recompute(); } });
    const evBox = h("input", { type: "checkbox", checked: true, onchange: (e) => { est.ev = e.target.checked; recompute(); } });
    recompute();

    root.append(panel(0,
      copy(vc.title + " " + vc.title_accent, vc.copy, vc.callouts),
      h("div.panel-data", null,
        h("div.rhead.vc-grid", { "aria-hidden": "true" }, h("span", { text: "Tier" }), h("span", { text: "Languages" }), h("span.r", { text: "In stock" }), h("span.r", { text: "Custom" })),
        vc.tiers.map((t) => h("div.vc-row", null,
          h("span.t", { text: `Tier ${t.tier}` }),
          h("span.l", { text: t.languages }),
          h("span.big", { "data-k": "In stock", "aria-label": `In stock ${t.in_stock} per voice-hour`, text: t.in_stock }),
          h("span.big.muted", { "data-k": "Custom", "aria-label": `Custom ${t.custom} per voice-hour`, text: t.custom }))),
        h("div.est", null,
          h("div.est-ctrls", null,
            h("span.est-k", { text: "Estimate" }), tierCtl, modeCtl,
            h("label.est-n", null, range, nOut),
            h("label.est-ev", null, evBox, h("span", { text: `+ ${vc.audio_eval_per_voice} audio eval` }))),
          total),
        h("p.fine.panel-note", { text: vc.note + " · indicative" }))));

    /* Evals */
    const ev = p.evals;
    root.append(panel(1,
      copy(ev.title + " " + ev.title_accent, ev.copy, ev.callouts),
      h("div.panel-data.ev-scroll", { tabindex: "0", role: "region", "aria-label": "Evals rates" },
        h("div.rhead.ev-grid", null, ev.columns.map((c, i) => h(`span${i ? ".r" : ""}`, { text: c }))),
        ev.groups.map((g) => [
          h("div.ev-group", { text: g.label }),
          g.rows.map((r) => h("div.ev-grid.ev-row", null,
            h("b", { text: r[0] }),
            r.slice(1).map((v, j) => h(`span.mono-md${j === 2 ? ".muted" : ""}`, { text: v })))),
        ]),
        h("p.fine.table-foot", { text: ev.note }))));

    /* ASR & telephony */
    const a = p.asr;
    root.append(panel(2,
      h("div.panel-copy", null,
        h("h3", { text: a.title + " " + a.title_accent }), h("p", { text: a.copy }),
        h("div.leaders", null, a.stock.map((k) => h("div.leader", null,
          h("b", { text: k.amount }), h("span.lbl", { text: k.label }), h("span.dots", { "aria-hidden": "true" }), h("b", { text: k.price }))))),
      h("div.panel-data", null,
        h("div.rhead.asr-grid", null, a.columns.map((c, i) => h(`span${i ? ".r" : ""}`, { text: c }))),
        a.rows.map((r) => h("div.asr-row", null,
          h("span.svc", null, r.sub ? h("i", { text: "↳", "aria-hidden": "true" }) : null, h("span", { text: r.service })),
          r.values.map((v) => h("span.mono-md", { text: v })))),
        h("div.fine.table-foot", null,
          h("span", { text: a.table_caption }),
          h("span", { text: `${a.footer[0]} · Tier 3 and exclusive licences quoted per project` })))));
  }

  /* =====================================================================
   * Old anchors from the previous site still land somewhere sensible
   * ===================================================================== */
  const ALIAS = { voices: "library", languages: "library", pricing: "rates", "pricing-voice-cloning": "rates", "pricing-evals": "rates", "pricing-asr": "rates", top: "overview" };
  function resolveHash() {
    const id = location.hash.slice(1);
    const to = ALIAS[id];
    if (to) {
      if (id === "pricing-evals") selectTab(1);
      if (id === "pricing-asr") selectTab(2);
      history.replaceState(null, "", "#" + to);
    }
    const el = document.getElementById(to || id);
    if (el && (to || id)) el.scrollIntoView();
  }
  $(".nav-brand").addEventListener("click", (e) => { e.preventDefault(); history.replaceState(null, "", location.pathname); window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" }); });

  /* =====================================================================
   * Boot
   * ===================================================================== */
  async function boot() {
    initBerg();
    const fail = (sel, what) => (err) => { console.error(err); const el = $(sel); if (el) el.replaceChildren(h("p.loading", { text: `Couldn't load ${what}. Please refresh.` })); };
    const [pricing, langs, voices, tel] = await Promise.allSettled([
      loadJSON("data/pricing.json"), loadJSON("data/languages.json"),
      loadJSON("data/voice-samples.json"), loadJSON("data/telephony-samples.json"),
    ]);
    if (langs.status === "fulfilled" && voices.status === "fulfilled") renderLibrary(voices.value, langs.value);
    else fail("#lib", "voices")(langs.reason || voices.reason);
    tel.status === "fulfilled" ? renderTelephony(tel.value) : fail("#tel-rows", "telephony samples")(tel.reason);
    pricing.status === "fulfilled" ? renderRates(pricing.value) : fail("#rates-root", "rates")(pricing.reason);
    sync();
    if (location.hash) resolveHash();
    window.addEventListener("hashchange", () => { if (ALIAS[location.hash.slice(1)]) resolveHash(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
