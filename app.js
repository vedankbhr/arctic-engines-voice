/* Arctic Engines · Voice AI site (v8 design)
 * Plain JS, no build step. Content comes from data/*.json; the hero, marquees and
 * capability graphics are generated here.
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
    for (const c of children.flat(Infinity)) {
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

  /** Run fn every ms, but only while el is on screen. */
  function every(el, ms, fn) {
    let t = null;
    new IntersectionObserver((es) => {
      const on = es[0].isIntersecting;
      if (on && !t) t = setInterval(fn, ms);
      else if (!on && t) { clearInterval(t); t = null; }
    }).observe(el);
  }

  const ICON = (n) =>
    `<svg class="i-play" width="${n}" height="${n}" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>` +
    `<svg class="i-pause" width="${n}" height="${n}" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4h4v16h-4zM13.5 4h4v16h-4z" fill="currentColor"/></svg>` +
    `<svg class="i-spin" width="${n}" height="${n}" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="34 50" stroke-linecap="round"/></svg>`;

  /* deterministic pseudo-random bar heights (waveforms) */
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

  /* =====================================================================
   * Audio engine
   * ===================================================================== */
  const HERO_KEY = "Hindi_Female";
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

  const heroCap = $("#hero-cap");
  function syncProgress() {
    progAny();
    for (const el of $$("[data-prog]")) el.style.width = pct(el.dataset.prog).toFixed(2) + "%";
    for (const el of $$('[role="slider"][data-seek]')) el.setAttribute("aria-valuenow", Math.round(pct(el.dataset.seek)));
    for (const c of $$(".gcard")) {
      const k = c.dataset.key, on = isOn(k), p = pct(k) / 100, b = c.querySelector(".gcard-bars").children;
      for (let i = 0; i < b.length; i++) b[i].classList.toggle("p", on && (i + 0.5) / b.length <= p);
      c.querySelector(".gcard-time").textContent = on ? timeOf(k) : "Sample";
    }
    heroCap.textContent = "हिन्दी · Hindi, female · " + (isOn(HERO_KEY) ? timeOf(HERO_KEY) : "press play");
    // now-playing waveform + time
    if (st.cur) {
      const p = pct(st.cur) / 100;
      const b = npWave.children;
      for (let i = 0; i < b.length; i++) b[i].classList.toggle("p", (i + 0.5) / b.length <= p);
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
   * Hero: rotating word, play button, glyph iceberg
   * ===================================================================== */
  function initHero() {
    const heroBtn = $("#hero-play");
    heroBtn.querySelector(".ico").innerHTML = ICON(12);
    heroBtn.addEventListener("click", () => toggle(HERO_KEY));

    // "Voice data for TTS. / ASR. / agents. / evals. / cloning."
    const words = ["TTS.", "ASR.", "agents.", "evals.", "cloning."];
    if (!reduceMotion) {
      let i = 0, slot = $("#hero-word");
      setInterval(() => {
        if (document.hidden) return;
        i += 1;
        const next = h("span.hero-word.swap", null, h("span", { text: words[i % words.length] }));
        slot.replaceWith(next);
        slot = next;
      }, 2800);
    }
  }

  /** Iceberg drawn in Indic glyphs on a canvas (decorative). */
  function initGlyphs() {
    const cv = $("#glyphs"); if (!cv) return;
    const ctx = cv.getContext("2d");
    const G = ["कखगघचजटडतदनपबमयरलवसह", "অকগচজটতদনপবমরলস", "கசடதநபமயரலவ", "కగచజటడతదనపమరలవ", "ಕಗಚಜಟಡತದನಪಮರಲವ", "കഗചജടഡതദനപമരലവ", "કગચજટડતદનપમરલવ", "ਕਗਚਜਟਡਤਦਨਪਮਰਲਵ", "କଗଚଜଟଡତଦନପମରଲ"].join("").split("");
    let s = 11; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const nrm = (c) => c.map((p) => [(p[0] - 440) / 400, (395 - p[1]) / 400]);
    const UL = nrm([[93, 395], [107, 323], [198, 305], [290, 220], [305, 147], [395, 100], [412, 48], [490, 0]]);
    const UR = nrm([[490, 0], [675, 190], [695, 275], [787, 305], [762, 378], [780, 395]]);
    const DL = nrm([[93, 395], [93, 530], [240, 690], [315, 845], [385, 890], [478, 1020]]);
    const DR = nrm([[780, 395], [780, 510], [615, 720], [478, 1020]]);
    const at = (ch, y) => {
      for (let i = 0; i < ch.length - 1; i++) {
        const a = ch[i], b = ch[i + 1], lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]);
        if (y >= lo && y <= hi) return hi === lo ? Math.min(a[0], b[0]) : a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]);
      }
      return null;
    };
    const K = 6;
    const poly = (th) => { const seg = 2 * Math.PI / K, a = ((th % seg) + seg) % seg - seg / 2; return Math.cos(seg / 2) / Math.cos(a); };
    const fn = (th, tw, ax, bz) => {
      const seg = 2 * Math.PI / K, ph = (Math.floor((th + tw) / seg) + 0.5) * seg - tw;
      const nx = Math.cos(ph) / ax, nz = Math.sin(ph) / bz, m = Math.hypot(nx, nz) || 1;
      return [nx / m, nz / m];
    };
    const pts = []; const ST = 0.074;
    for (let y = 0.97; y > -1.55; y -= ST) {
      const l = at(y >= 0 ? UL : DL, y), r = at(y >= 0 ? UR : DR, y);
      if (l == null || r == null || r <= l) continue;
      const xc = (l + r) / 2, ax = (r - l) / 2, bz = ax * 0.62 + 0.04, tw = y * 1.3;
      const per = 2 * Math.PI * Math.sqrt((ax * ax + bz * bz) / 2), n = Math.max(1, Math.round(per / ST));
      for (let i = 0; i < n; i++) {
        if (rnd() < 0.3) continue;
        const th = i / n * 2 * Math.PI + rnd() * 0.04, pf = poly(th + tw);
        pts.push({ x: xc + ax * Math.cos(th) * pf, y: y + (rnd() - 0.5) * 0.02, z: bz * Math.sin(th) * pf, g: G[(rnd() * G.length) | 0], u: y < 0, ph: rnd() * 6.28, n: fn(th, tw, ax, bz) });
      }
    }
    const OUT = UL.concat(UR.slice(1), DR.slice().reverse().slice(1), DL.slice().reverse().slice(1, -1)).concat([UL[0]]);
    const edge = (a, b, gap) => {
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(d / gap));
      for (let i = 0; i < n; i++) { const t = i / n, y = a[1] + (b[1] - a[1]) * t; pts.push({ x: a[0] + (b[0] - a[0]) * t, y, z: 0, g: G[(rnd() * G.length) | 0], u: y < -0.001, ph: rnd() * 6.28, e: 1 }); }
    };
    for (let i = 0; i < OUT.length - 1; i++) edge(OUT[i], OUT[i + 1], ST * 0.62);
    edge(UL[0], UR[UR.length - 1], ST * 0.62);
    const mix = (a, b, t) => "rgb(" + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",") + ")";
    const PA = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => mix([14, 86, 112], [43, 184, 222], i / 7));
    const PB = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => mix([8, 32, 51], [20, 98, 130], i / 7));
    const water = [];
    [1.02, 1.22].forEach((R, k) => { const n = Math.round(R * 64); for (let i = 0; i < n; i++) { const th = i / n * 2 * Math.PI; water.push({ x: R * Math.cos(th), y: 0, z: R * 0.62 * Math.sin(th), k }); } });
    const FONT = "'Noto Sans Devanagari','Noto Sans Bengali','Noto Sans Tamil','Noto Sans Telugu','Noto Sans Kannada','Noto Sans Malayalam','Noto Sans Gujarati','Noto Sans Gurmukhi','Noto Sans Oriya',sans-serif";

    let W = 0, H = 0, dpr = 1, ang = 0, vis = true, last = performance.now(), pulse = 0;
    const tilt = 0.17, ct = Math.cos(tilt), stt = Math.sin(tilt);
    const draw = (now) => {
      const dt = Math.min(64, now - last); last = now; void dt;
      if (!reduceMotion) ang = Math.sin(now / 1000 * 0.2) * 0.85;
      pulse += ((st.cur && !audio.paused ? 1 : 0) - pulse) * 0.06;
      if (!reduceMotion) for (let i = 0; i < 5; i++) { const p = pts[(Math.random() * pts.length) | 0]; p.g = G[(Math.random() * G.length) | 0]; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const S = Math.min(W / 2.6, H / 2.85), cx = W * 0.5, cy = H * 0.5 - 0.29 * S;
      const ca = Math.cos(ang), sa = Math.sin(ang), tt = now / 1000;
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.globalAlpha = 1;
      const proj = (x, y, z) => { const x1 = x * ca - z * sa, z1 = x * sa + z * ca; const y1 = y * ct - z1 * stt, z2 = y * stt + z1 * ct; const pp = 2.7 / (2.7 + z2); return [cx + x1 * S * pp, cy - y1 * S * pp, z2, pp]; };
      ctx.font = "400 " + Math.round(S * 0.075) + "px Geist Mono, monospace";
      for (const w of water) { const q = proj(w.x, w.y, w.z); const a = (0.08 + 0.24 * (1 - (q[2] + 1.6) / 3.2)) * (w.k ? 0.55 : 1); ctx.fillStyle = "rgba(10,10,10," + a.toFixed(3) + ")"; ctx.fillText("–", q[0], q[1]); }
      const fs = Math.max(9, S * 0.058), eA = 0.9 * Math.pow(Math.abs(ca), 3);
      const B = [[], [], []];
      for (const p of pts) {
        const k = 1 + pulse * 0.07 * Math.sin(tt * 7 + p.ph);
        const q = proj(p.x * k, p.y, p.z * k);
        let a, col;
        if (p.e) { a = eA; col = p.u ? "#0B2E45" : "#1998C0"; }
        else {
          const nz1 = p.n[0] * sa + p.n[1] * ca, nx1 = p.n[0] * ca - p.n[1] * sa;
          a = 0.04 + 0.96 * Math.pow(Math.max(0, 1 - (q[2] + 0.85) / 1.7), 2.2);
          if (nz1 > 0.15) a *= 0.35;
          const lit = Math.max(0, Math.min(1, -0.62 * nx1 - 0.78 * nz1));
          col = (p.u ? PB : PA)[Math.round(lit * 7)];
          a *= p.u ? 0.8 : 1;
        }
        if (a < 0.04) continue;
        B[q[3] < 0.94 ? 0 : q[3] < 1.06 ? 1 : 2].push([p.g, q[0], q[1], a, col]);
      }
      [0.82, 1, 1.2].forEach((m, bi) => {
        ctx.font = "500 " + (fs * m).toFixed(1) + "px " + FONT;
        for (const g of B[bi]) { ctx.globalAlpha = g[3]; ctx.fillStyle = g[4]; ctx.fillText(g[0], g[1], g[2]); }
      });
      ctx.globalAlpha = 1;
    };
    const size = () => {
      const r = cv.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      if (reduceMotion && W) draw(0);
    };
    size();
    new ResizeObserver(size).observe(cv);
    if (reduceMotion) { document.fonts && document.fonts.ready.then(() => W && draw(0)); return; }
    new IntersectionObserver((es) => { vis = es[0].isIntersecting; }).observe(cv);
    const frame = (now) => { requestAnimationFrame(frame); if (vis && W && !document.hidden) draw(now); };
    requestAnimationFrame(frame);
  }

  /* =====================================================================
   * Marquees (languages + at a glance): repeat a group until half the track
   * is wider than the viewport, so the -50% loop is seamless at any width.
   * ===================================================================== */
  function fillTrack(track, make, pxPerSec) {
    const build = () => {
      track.replaceChildren(...make());
      const w = track.getBoundingClientRect().width;               // one group
      if (!w) return;
      const copies = Math.max(1, Math.ceil((window.innerWidth + 80) / w));
      const all = [];
      for (let i = 0; i < copies * 2; i++) {
        const g = i === 0 ? Array.from(track.childNodes) : make();
        if (i > 0) g.forEach((n) => n.setAttribute && n.setAttribute("aria-hidden", "true"));
        all.push(...g);
      }
      track.replaceChildren(...all);
      track.style.animationDuration = Math.max(20, (w * copies) / pxPerSec).toFixed(1) + "s";
    };
    build();
    let timer = null, lastW = window.innerWidth;
    window.addEventListener("resize", () => { if (window.innerWidth === lastW) return; lastW = window.innerWidth; clearTimeout(timer); timer = setTimeout(build, 200); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(build);
  }

  function initMarquees(langs, globals) {
    if (langs && langs.languages) {
      const chips = langs.languages.map((l) => ({ native: l.native || l.language, name: l.language }));
      const gl = (globals || []).map((g) => ({ native: g.native, name: g.language + (g.language === "French" ? ` (${g.region})` : ""), global: true }));
      const mk = (list) => () => list.map((c) => h("div.chip", null, h("b", { text: c.native }), h("span", { text: c.name }), c.global ? h("i", { text: "Global" }) : null));
      fillTrack($("#chips-a"), mk(chips.slice(0, 12)), 30);
      fillTrack($("#chips-b"), mk(chips.slice(12).concat(gl)), 30);
    }
    const tick = $("#ticker");
    const tpl = Array.from(tick.children);
    fillTrack(tick, () => tpl.map((n) => n.cloneNode(true)), 38);
  }

  /* =====================================================================
   * Capabilities graphics + process
   * ===================================================================== */
  function initCaps() {
    $("#cap-wave").replaceChildren(...bars("cap-wave", 36).map((v, i) => h("i", { style: `height:${v}%;animation-delay:${((i * 0.07) % 1.3).toFixed(2)}s` })));

    const rows = ["A", "B"].map((k) => h("div.pair-row", null,
      h("span.k", { text: k }),
      h("span.bars", null, bars("pair" + k, 26).map((v) => h("i", { style: `height:${v}%` }))),
      h("span.tag", { text: "Preferred" })));
    $("#cap-pair").replaceChildren(...rows);
    let r = 0;
    const setPref = () => rows.forEach((row, i) => row.classList.toggle("pref", r % 2 === i));
    setPref();
    if (!reduceMotion) every($("#cap-pair"), 1800, () => { r = (r + 1) % 4; setPref(); });

    const SEGS = [[0, 1.31, 1], [2.21, 2.4, 2], [5.28, 6.1, 1], [6.4, 8.08, 1], [8.78, 14.18, 1], [15.27, 16.17, 2], [22.53, 23.78, 2], [26.03, 27.68, 1], [27.98, 30.98, 1], [32.63, 36.56, 2]];
    $("#cap-lanes").replaceChildren(
      ...[1, 2].map((ch) => h(`div.lane-row.c${ch}`, null,
        h("span.k", { text: "CH" + ch }),
        h("div.rail", null, SEGS.filter((g) => g[2] === ch).map((g) => h("i", { style: `left:${(g[0] / 38 * 100).toFixed(2)}%;width:${((g[1] - g[0]) / 38 * 100).toFixed(2)}%` }))))),
      h("span.scan", null, h("i")));

    /* process steps: auto-advance until the visitor picks one */
    const steps = $$("#steps .step");
    let cur = 0, auto = !reduceMotion;
    const setStep = (i) => { cur = i; steps.forEach((b, j) => { b.classList.toggle("on", i === j); b.setAttribute("aria-pressed", String(i === j)); }); };
    steps.forEach((b, i) => b.addEventListener("click", () => { auto = false; setStep(i); }));
    if (auto) every($("#steps"), 3600, () => { if (auto) setStep((cur + 1) % steps.length); });

    /* process code window: types segments line by line */
    const SRC = ['{', '  "segment_id": 4,', '  "start_time": "00:00:06:400",', '  "end_time": "00:00:08:080",', '  "duration_ms": 1680,', '  "transcript": "मैं इशा हूं arctic engine से",', '  "speaker": 1,', '  "interrupted": false', '},', '{', '  "segment_id": 6,', '  "start_time": "00:00:15:274",', '  "transcript": "सीधा hospital जाकर",', '  "speaker": 2,', '  "interrupted": false', '}'];
    const lines = SRC.map((line, i) => {
      const m = line.match(/^(\s*)"([^"]+)": (.*?)(,?)$/);
      const parts = m
        ? [h("span.key", { text: m[1] + '"' + m[2] + '"' }), h("span.p", { text: ": " }), h(`span.${m[3][0] === '"' ? "str" : "val"}`, { text: m[3] }), h("span.p", { text: m[4] })]
        : [h("span.p", { text: line })];
      return h("div.code-ln", null, h("span.n", { text: String(i + 1) }), h("span", null, parts));
    });
    $("#code").replaceChildren(...lines);
    const status = $("#code-status");
    let n = 0;
    const paint = () => { lines.forEach((l, i) => l.classList.toggle("on", n > i)); status.textContent = n < SRC.length ? "Writing segments…" : "Two-level QC passed"; };
    if (reduceMotion) { n = SRC.length; paint(); }
    else every($("#code"), 150, () => { n = n >= SRC.length + 20 ? 0 : n + 1; paint(); });
  }

  /* =====================================================================
   * Voice library
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
   * Global voices (languages beyond India)
   * ===================================================================== */
  function renderGlobal(list) {
    $("#gcards").replaceChildren(...list.map((g) => {
      const key = "gl-" + g.url.split("/").pop().replace(/\.[^.]+$/, "");
      const label = `${g.language}, ${g.region} sample`;
      ITEMS[key] = { url: g.url, type: g.type, label, native: g.native, title: `${g.language} · ${g.region}`, sub: "Global voice sample · WAV" };
      return h("button.gcard", { type: "button", dataset: { key, label }, "aria-label": `Play ${label}`, onclick: () => toggle(key) },
        h("span.gcard-top", null, h("span.gcard-native", { text: g.native }), h("span.gcard-code", { text: g.code })),
        h("span.gcard-name", null, h("b", { text: g.language }), h("span", { text: g.region })),
        h("span.gcard-play", null,
          h("span.gcard-btn.ico", { html: ICON(10), "aria-hidden": "true" }),
          h("span.gcard-bars", { "aria-hidden": "true" }, bars(key, 28).map((v) => h("i", { style: `height:${v}%` }))),
          h("span.gcard-time", { text: "Sample" })));
    }));
  }

  /* =====================================================================
   * Telephony
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
          h("div.track-l", null, h("div.fill", { dataset: { prog: key } })));
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
        h("a.btn.btn-primary.btn-md", { href: it.transcript, target: "_blank", rel: "noopener", text: "Open raw JSON ↗" })));
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
   * Rate card
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
  // capability cards link into the matching tab
  $$(".cap-go[data-tab]").forEach((a) => a.addEventListener("click", () => selectTab(Number(a.dataset.tab))));

  function renderRates(p, langData) {
    const root = $("#rates-root");
    root.replaceChildren();
    const panel = (i, cls, ...kids) => h(`div.panel${cls ? "." + cls : ""}`, { id: `panel-${i}`, role: "tabpanel", "aria-labelledby": `tab-${i}`, hidden: i !== 0 }, kids);
    const copy = (title, text, callouts) => h("div.panel-copy", null,
      h("h3", { text: title }), h("p", { text }),
      callouts.map((c, j) => h("p.callout", null, h(`span.callout-k${j > 0 ? ".muted" : ""}`, { text: `${c.label} · ` }), c.text)));

    /* ---- 01 Voice cloning: mode toggle, tier cards, estimator ---- */
    const vc = p.voice_cloning;
    const est = { tier: 1, mode: "in_stock", n: 10, ev: true };
    const evalPrice = money(vc.audio_eval_per_voice);
    const tierLangs = (t) => (langData ? langData.languages.filter((l) => l.tier === t) : []);
    const evalsFor = (t) => {
      const e = langData && langData.tier_prices[t] ? langData.tier_prices[t].evals_per_hr : p.evals.groups[0].rows[0][t];
      return e === "Quote" ? "Quote" : e + "/hr";
    };

    // stock / custom radio
    const MODES = [["in_stock", "In stock"], ["custom", "Custom"]];
    const radios = MODES.map(([m, label]) => h("button", { type: "button", role: "radio", text: label, onclick: () => { est.mode = m; update(); }, onkeydown: (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); est.mode = m === "in_stock" ? "custom" : "in_stock"; update(); radios[est.mode === "in_stock" ? 0 : 1].focus(); }
    } }));
    const radioGroup = h("div.radios", { role: "radiogroup", "aria-label": "Stock or custom" }, radios);

    // tier cards (built once; prices update in place)
    const cards = vc.tiers.map((t) => {
      const ls = tierLangs(t.tier);
      const price = h("b");
      const lines = [];
      if (ls.length) lines.push(["Languages", String(ls.length)], ["Voices in stock", String(ls.reduce((a, l) => a + l.voices, 0))]);
      lines.push(["Native-speaker evals", evalsFor(t.tier)], ["Audio eval", `${vc.audio_eval_per_voice} / voice`]);
      const el = h(`div.tcard${t.tier === 1 ? ".hl" : ""}`, null,
        h("div.tcard-top", null,
          h("span", null, h("span.n", { text: "0" + t.tier }), h("b", { text: `Tier ${t.tier}` })),
          t.tier === 1 ? h("span.flag", { text: "Most in stock" }) : null),
        h("div.price", null, price, h("span", { text: "/ voice-hour" })),
        h("div.tlines", null, lines.map(([k, v]) => h("div.tline", null, h("span", { text: k }), h("span", { text: v })))),
        h("p", { text: ls.length ? ls.map((l) => l.language).join(", ") : t.languages }),
        h("a.btn.btn-primary.btn-md", { href: `mailto:vedank@arcticengines.ai?subject=Tier%20${t.tier}%20voices` }, "Request voices", h("span", { "aria-hidden": "true", text: "→" })));
      return { t, price, el };
    });
    const tiersEl = h("div.tiers", { dataset: { reveal: "" } }, cards.map((c) => c.el));

    // estimator
    const total = h("span.est-total", { "aria-live": "polite" });
    const nOut = h("output");
    const tierBtns = vc.tiers.map((t) => h("button", { type: "button", text: `T${t.tier}`, onclick: () => { est.tier = t.tier; update(); } }));
    const range = h("input", { type: "range", min: "1", max: "50", value: String(est.n), "aria-label": "Number of voices", oninput: (e) => { est.n = Number(e.target.value); update(); } });
    const evBox = h("input", { type: "checkbox", checked: true, onchange: (e) => { est.ev = e.target.checked; update(); } });
    const estEl = h("div.est", null,
      h("div.est-ctrls", null,
        h("span.est-k", { text: "Estimate" }),
        h("div.segctl", { role: "group", "aria-label": "Tier" }, tierBtns),
        h("label.est-n", null, range, nOut),
        h("label.est-ev", null, evBox, h("span", { text: `+ ${vc.audio_eval_per_voice} audio eval` }))),
      total);

    function update() {
      radios.forEach((b, i) => { const on = MODES[i][0] === est.mode; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; });
      cards.forEach((c) => { c.price.textContent = c.t[est.mode]; });
      tierBtns.forEach((b, i) => b.setAttribute("aria-pressed", String(vc.tiers[i].tier === est.tier)));
      const unit = money(vc.tiers.find((x) => x.tier === est.tier)[est.mode]);
      total.textContent = "$" + (est.n * unit + (est.ev ? est.n * evalPrice : 0)).toLocaleString("en-US");
      nOut.textContent = `${est.n} ${est.n === 1 ? "voice" : "voices"} · ${est.mode === "in_stock" ? "in stock" : "custom"}`;
    }
    update();

    root.append(panel(0, "col",
      h("div.vc-top", null, h("p", { text: vc.copy }), radioGroup),
      tiersEl, estEl,
      h("p.fine", { text: vc.note + " · indicative" })));

    /* ---- 02 Evals ---- */
    const ev = p.evals;
    root.append(panel(1, "",
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

    /* ---- 03 ASR & telephony ---- */
    const a = p.asr;
    root.append(panel(2, "",
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
   * Scroll reveal (progressive: only hides what is below the fold)
   * ===================================================================== */
  function initReveal() {
    if (reduceMotion || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.style.opacity = "1"; e.target.style.transform = "none";
      io.unobserve(e.target);
    }), { rootMargin: "0px 0px -8% 0px" });
    $$("section h2, [data-reveal]").forEach((el) => {
      if (el.getBoundingClientRect().top < window.innerHeight) return;
      el.style.transition = "opacity 1000ms var(--ease-out), transform 1000ms var(--ease-out)";
      el.style.opacity = "0"; el.style.transform = "translateY(32px)";
      io.observe(el);
    });
  }

  /* =====================================================================
   * Old anchors from the previous site still land somewhere sensible
   * ===================================================================== */
  const ALIAS = { voices: "library", pricing: "rates", "pricing-voice-cloning": "rates", "pricing-evals": "rates", "pricing-asr": "rates", top: "overview" };
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
    initHero();
    initGlyphs();
    initCaps();
    const fail = (sel, what) => (err) => { console.error(err); const el = $(sel); if (el) el.replaceChildren(h("p.loading", { text: `Couldn't load ${what}. Please refresh.` })); };
    const [pricing, langs, voices, tel, glob] = await Promise.allSettled([
      loadJSON("data/pricing.json"), loadJSON("data/languages.json"),
      loadJSON("data/voice-samples.json"), loadJSON("data/telephony-samples.json"),
      loadJSON("data/global-voices.json"),
    ]);
    const langData = langs.status === "fulfilled" ? langs.value : null;
    initMarquees(langData, glob.status === "fulfilled" ? glob.value : []);
    if (langData && voices.status === "fulfilled") renderLibrary(voices.value, langData);
    else fail("#lib", "voices")(langs.reason || voices.reason);
    glob.status === "fulfilled" ? renderGlobal(glob.value) : fail("#gcards", "global voices")(glob.reason);
    tel.status === "fulfilled" ? renderTelephony(tel.value) : fail("#tel-rows", "telephony samples")(tel.reason);
    pricing.status === "fulfilled" ? renderRates(pricing.value, langData) : fail("#rates-root", "rates")(pricing.reason);
    sync();
    initReveal();
    if (location.hash) resolveHash();
    window.addEventListener("hashchange", () => { if (ALIAS[location.hash.slice(1)]) resolveHash(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
