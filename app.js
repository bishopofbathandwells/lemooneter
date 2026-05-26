// Lemooneter — moon phase tracker with a lemon option. Vanilla JS, no build.
// Astronomy lives in astro.js so the tests page can import it cleanly.

import {
  moonPhaseFraction,
  illumination,
  phaseName,
  daysUntilFractional,
  formatDuration,
  moonTimes,
  phaseEventOnDay,
} from "./astro.js";

// ───────────────────────────────────────────────────────── rendering
//
// Unified phase rendering for every subject (moon, fruits, custom photo):
//
//   1. Draw the subject into an offscreen canvas.
//   2. Compute a per-pixel Lambertian brightness map for an ellipsoid fitted
//      to the subject's silhouette bounding box. Pixels outside the ellipsoid
//      get brightness 1 (multiply identity) so the source is unchanged.
//   3. Multiply-blend the brightness map onto the subject.
//   4. Mask the result back to the subject's alpha (or, for custom photos,
//      to a circular disc).
//
// The Lambertian model treats the subject as a sphere lit by the sun from a
// direction determined by the phase. Result: natural soft terminator, limb
// darkening, no hand-tuned ellipse-shaped "shadow shape".

function drawImageContain(ctx, img, dx, dy, dw, dh) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.min(dw / iw, dh / ih);
  const w = iw * scale, h = ih * scale;
  const x = dx + (dw - w) / 2;
  const y = dy + (dh - h) / 2;
  ctx.drawImage(img, x, y, w, h);
  return { scale, drawX: x, drawY: y, drawW: w, drawH: h };
}

function drawImageCover(ctx, img, dx, dy, dw, dh, offsetX = 0.5, offsetY = 0.5, zoom = 1) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const baseScale = Math.max(dw / iw, dh / ih);
  const scale = baseScale * zoom;
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (iw - sw) * offsetX;
  const sy = (ih - sh) * offsetY;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

// Maximum zoom factor that keeps the disc rendered from at least 1:1 source
// pixels (no upsampling, no blur). The disc occupies 2r ≈ 962 px of a 1024 px
// canvas, so we cap zoom at min(iw, ih) / 962.
function maxZoomFor(img, discPx = 962) {
  if (!img) return 1;
  return Math.max(1, Math.min(img.naturalWidth, img.naturalHeight) / discPx);
}

// Per-pixel Lambertian brightness over the ellipsoid (cx,cy ; rx,ry). Output
// pixels are RGBA grayscale; the buffer is filled with opaque white first so
// pixels outside the brightness rectangle leave the multiplicand untouched.
//
// The rectangle is dilated a few pixels beyond the bbox (PAD_PX) so the
// shading covers the subject's anti-aliased alpha edge, not just the
// detected interior. For pixels outside the unit sphere we extrapolate the
// brightness to the sphere limb at the same direction — i.e. nz=0, b = sx·dx̂.
// Without this the bright lit limb leaked through the AA band as a halo.
function buildBrightness(w, h, cx, cy, rx, ry, phase) {
  const data = new Uint8ClampedArray(w * h * 4);
  data.fill(255); // white = identity for "multiply"

  // Sun direction in screen-aligned coords: at full moon sun is behind the
  // observer (sz=+1); at new moon, behind the moon (sz=-1); at first/last
  // quarter, off to the side (sx=±1).
  const phi = 2 * Math.PI * phase;
  let sx = Math.sin(phi);
  const sz = -Math.cos(phi);
  if (isSouthern()) sx = -sx;     // mirror the moon east-west for southern observers

  const PAD_PX = 4;
  const x0 = Math.max(0, Math.floor(cx - rx - PAD_PX));
  const x1 = Math.min(w, Math.ceil(cx + rx + PAD_PX) + 1);
  const y0 = Math.max(0, Math.floor(cy - ry - PAD_PX));
  const y1 = Math.min(h, Math.ceil(cy + ry + PAD_PX) + 1);

  for (let y = y0; y < y1; y++) {
    const dy = (y - cy) / ry;
    const dy2 = dy * dy;
    for (let x = x0; x < x1; x++) {
      const dx = (x - cx) / rx;
      const r2 = dx * dx + dy2;
      let b;
      if (r2 < 1) {
        const nz = Math.sqrt(1 - r2);
        b = dx * sx + nz * sz;
      } else {
        // Outside the unit sphere — project to the limb at the same angle so
        // the AA-feathered alpha edge gets the same shading as the limb it
        // borders, not the multiply-identity value of 255.
        const r = Math.sqrt(r2);
        b = (dx / r) * sx;
      }
      if (b < 0) b = 0;
      // sqrt softens the Lambertian falloff so the lit hemisphere reads
      // closer to uniformly bright (lunar surfaces aren't truly Lambertian).
      b = Math.sqrt(b);
      const v = (b * 255) | 0;
      const i = (y * w + x) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v;
    }
  }
  return new ImageData(data, w, h);
}

function renderSubject(mainCtx, w, h, cx, cy, r, image, bbox, fitMode, phase, coverOffsetX, coverOffsetY, coverZoom) {
  const oc = document.createElement("canvas");
  oc.width = w; oc.height = h;
  const o = oc.getContext("2d");
  o.imageSmoothingEnabled = true;
  o.imageSmoothingQuality = "high";

  // 1. Draw the subject.
  let place;
  if (fitMode === "cover") {
    drawImageCover(o, image, cx - r, cy - r, r * 2, r * 2, coverOffsetX, coverOffsetY, coverZoom);
    place = { drawX: cx - r, drawY: cy - r, scale: 1 };
  } else {
    place = drawImageContain(o, image, cx - r, cy - r, r * 2, r * 2);
  }

  // 2. Fit a sphere/ellipsoid to the subject's silhouette (or full disc for
  //    custom photos with no alpha bbox).
  let bcx, bcy, brx, bry;
  if (bbox) {
    bcx = place.drawX + (bbox.x + bbox.w / 2) * place.scale;
    bcy = place.drawY + (bbox.y + bbox.h / 2) * place.scale;
    brx = (bbox.w / 2) * place.scale;
    bry = (bbox.h / 2) * place.scale;
  } else {
    bcx = cx; bcy = cy; brx = r; bry = r;
  }

  // 3. Build brightness map and multiply-blend onto the subject.
  const bd = buildBrightness(w, h, bcx, bcy, brx, bry, phase);
  const bc = document.createElement("canvas");
  bc.width = w; bc.height = h;
  bc.getContext("2d").putImageData(bd, 0, 0);
  o.globalCompositeOperation = "multiply";
  o.drawImage(bc, 0, 0);

  // 4. Mask back to the subject's silhouette. For built-ins we re-draw the
  //    alpha PNG; for custom photos we keep just a circular disc.
  o.globalCompositeOperation = "destination-in";
  if (fitMode === "cover") {
    o.fillStyle = "#fff";
    o.beginPath();
    o.arc(cx, cy, r, 0, Math.PI * 2);
    o.fill();
  } else {
    drawImageContain(o, image, cx - r, cy - r, r * 2, r * 2);
  }
  o.globalCompositeOperation = "source-over";

  mainCtx.drawImage(oc, 0, 0);
}

function renderPhaseTo(canvas, phase, mode, customImage, builtIn) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) / 2 * 0.94;
  ctx.clearRect(0, 0, w, h);

  const entry = builtIn && builtIn[mode];
  if (entry && entry.img && entry.img.complete && entry.bbox) {
    renderSubject(ctx, w, h, cx, cy, r, entry.img, entry.bbox, "contain", phase);
    return;
  }
  if (mode === "custom" && customImage && customImage.complete) {
    renderSubject(ctx, w, h, cx, cy, r, customImage, null, "cover", phase,
                  state.cropOffsetX, state.cropOffsetY, state.cropZoom);
    return;
  }
  // Subject not loaded yet — leave the canvas empty (it'll re-render once
  // assets arrive).
}

// ───────────────────────────────────────────────────────── state

const state = {
  mode: localStorage.getItem("lm.mode") || "moon",
  customDataUrl: localStorage.getItem("lm.photo") || null,
  lat: parseFloat(localStorage.getItem("lm.lat")) ,
  lon: parseFloat(localStorage.getItem("lm.lon")) ,
  cropOffsetX: parseFloat(localStorage.getItem("lm.cropX")),
  cropOffsetY: parseFloat(localStorage.getItem("lm.cropY")),
  cropZoom:    parseFloat(localStorage.getItem("lm.cropZ")),
  customImage: null,
  viewedDate: null, // null = today (live-refreshed each minute); else a fixed Date
  calMonth: null,   // {y, m}
  apDays:  parseInt(localStorage.getItem("lm.apDays"))  || 10,
  apDelay: parseInt(localStorage.getItem("lm.apDelay")) || 1000,
  hemisphere: localStorage.getItem("lm.hemisphere") || "auto",   // auto | north | south
  apTimer: null,    // setInterval handle while playing
  apOffset: 0,      // current day offset from today during playback
  builtIn: { moon: null, lemon: null, lime: null, orange: null, "cheese-moon": null, smiley: null, watermelon: null },
};
if (Number.isNaN(state.lat)) state.lat = null;
if (Number.isNaN(state.lon)) state.lon = null;
if (Number.isNaN(state.cropOffsetX)) state.cropOffsetX = 0.5;
if (Number.isNaN(state.cropOffsetY)) state.cropOffsetY = 0.5;
if (Number.isNaN(state.cropZoom) || state.cropZoom < 1) state.cropZoom = 1;
if (state.mode === "bee-orange") state.mode = "orange"; // migrate old name
if (state.mode === "clementine") state.mode = "moon";   // clementine removed

function persist() {
  localStorage.setItem("lm.mode", state.mode);
  try {
    if (state.customDataUrl) localStorage.setItem("lm.photo", state.customDataUrl);
    else localStorage.removeItem("lm.photo");
  } catch (e) {
    // QuotaExceededError — most often the downsized photo still didn't fit.
    console.warn("Couldn't persist custom photo to localStorage:", e);
    alert("Couldn't save the photo to local storage (it's too large). It'll work for this session but won't survive a refresh.");
  }
  if (state.lat != null && state.lon != null) {
    localStorage.setItem("lm.lat", String(state.lat));
    localStorage.setItem("lm.lon", String(state.lon));
  } else {
    localStorage.removeItem("lm.lat");
    localStorage.removeItem("lm.lon");
  }
  localStorage.setItem("lm.cropX", String(state.cropOffsetX));
  localStorage.setItem("lm.cropY", String(state.cropOffsetY));
  localStorage.setItem("lm.cropZ", String(state.cropZoom));
  localStorage.setItem("lm.apDays",  String(state.apDays));
  localStorage.setItem("lm.apDelay", String(state.apDelay));
  localStorage.setItem("lm.hemisphere", state.hemisphere);
}

// Returns true if the user's effective viewpoint is the southern hemisphere.
// In southern latitudes the moon appears mirrored east-west, so we invert the
// sun direction in the shader.
function isSouthern() {
  if (state.hemisphere === "south") return true;
  if (state.hemisphere === "north") return false;
  return state.lat != null && state.lat < 0; // auto: from stored location
}

function loadCustomImage() {
  return new Promise((resolve) => {
    if (!state.customDataUrl) { state.customImage = null; return resolve(); }
    const img = new Image();
    img.onload = () => { state.customImage = img; resolve(); };
    img.onerror = () => { state.customImage = null; resolve(); };
    img.src = state.customDataUrl;
  });
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Computes the bounding box of non-transparent pixels in an image.
// For opaque JPEGs this returns the whole image; useful for transparent PNGs.
function alphaBoundingBox(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const cx = c.getContext("2d");
  cx.drawImage(img, 0, 0);
  let data;
  try { data = cx.getImageData(0, 0, w, h).data; }
  catch (e) { return { x: 0, y: 0, w, h }; }
  let xMin = w, yMin = h, xMax = -1, yMax = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > 24) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
  }
  if (xMax < 0) return { x: 0, y: 0, w, h };
  return { x: xMin, y: yMin, w: xMax - xMin + 1, h: yMax - yMin + 1 };
}

async function loadBuiltInAssets() {
  const entries = [
    { key: "moon",        src: "fruits/moon.webp" },
    { key: "lemon",       src: "fruits/lemon.webp" },
    { key: "lime",        src: "fruits/lime.webp" },
    { key: "orange",      src: "fruits/orange.webp" },
    { key: "cheese-moon", src: "fruits/cheese-moon.webp" },
    { key: "smiley",      src: "fruits/smiley.webp" },
    { key: "watermelon",  src: "fruits/watermelon.webp" },
  ];
  await Promise.all(entries.map(async (e) => {
    const img = await loadImage(e.src);
    if (!img) return;
    state.builtIn[e.key] = { img, bbox: alphaBoundingBox(img) };
  }));
}

// ───────────────────────────────────────────────────────── views

function viewedDateOrNow() {
  return state.viewedDate ? new Date(state.viewedDate) : new Date();
}

function isViewingToday() {
  if (!state.viewedDate) return true;
  const t = new Date();
  return state.viewedDate.getFullYear() === t.getFullYear()
      && state.viewedDate.getMonth()    === t.getMonth()
      && state.viewedDate.getDate()     === t.getDate();
}

function renderToday() {
  const now = viewedDateOrNow();
  const phase = moonPhaseFraction(now);
  renderPhaseTo($("#todayCanvas"), phase, state.mode, state.customImage, state.builtIn);
  $("#phaseName").textContent = phaseName(phase);
  $("#illumPct").textContent = Math.round(illumination(phase) * 100) + " % illuminated";
  $("#todayDate").textContent = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  $("#nextFull").textContent = formatDuration(daysUntilFractional(now, 0.5));
  $("#nextNew").textContent  = formatDuration(daysUntilFractional(now, 0.0));
  renderRiseSet(now);
}

function renderRiseSet(now) {
  const el = $("#riseSet");
  if (state.lat == null || state.lon == null) {
    el.innerHTML = `<button id="locBtn" class="link-btn">Enable rise/set times</button>`;
    $("#locBtn").addEventListener("click", askForLocation);
    return;
  }
  const t = moonTimes(now, state.lat, state.lon);
  const fmt = (d) => d ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
  if (t.alwaysUp)   { el.innerHTML = `<span>Moon above horizon all day</span>`; return; }
  if (t.alwaysDown) { el.innerHTML = `<span>Moon below horizon all day</span>`; return; }
  el.innerHTML = `
    <div class="pair"><span class="count-label">Rise</span><strong>${fmt(t.rise)}</strong></div>
    <div class="pair"><span class="count-label">Set</span><strong>${fmt(t.set)}</strong></div>
  `;
}

function renderCalendar() {
  const today = new Date();
  if (!state.calMonth) state.calMonth = { y: today.getFullYear(), m: today.getMonth() };
  const { y, m } = state.calMonth;
  const first = new Date(y, m, 1);
  const monthLabel = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  $("#monthLabel").textContent = monthLabel;

  // Start of grid: Monday on/before the 1st.
  const dow = (first.getDay() + 6) % 7; // 0=Mon
  const start = new Date(y, m, 1 - dow);
  const grid = $("#calGrid");
  grid.innerHTML = "";

  const todayKey = today.toDateString();
  const EVENT_LABELS = {
    0:    { txt: "New",  cls: "ev-new" },
    0.25: { txt: "1Q",   cls: "ev-q1"  },
    0.5:  { txt: "Full", cls: "ev-full"},
    0.75: { txt: "3Q",   cls: "ev-q3"  },
  };
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const inMonth = d.getMonth() === m;
    const cell = document.createElement("div");
    cell.className = "cal-cell" + (inMonth ? "" : " muted") + (d.toDateString() === todayKey ? " today" : "");
    const c = document.createElement("canvas");
    c.width = 256; c.height = 256;
    const noonish = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
    renderPhaseTo(c, moonPhaseFraction(noonish), state.mode, state.customImage, state.builtIn);
    cell.appendChild(c);
    const num = document.createElement("div");
    num.className = "num";
    num.textContent = String(d.getDate());
    cell.appendChild(num);
    const evt = phaseEventOnDay(d);
    if (evt != null && EVENT_LABELS[evt]) {
      const tag = document.createElement("div");
      tag.className = "ev-tag " + EVENT_LABELS[evt].cls;
      tag.textContent = EVENT_LABELS[evt].txt;
      cell.appendChild(tag);
    }
    grid.appendChild(cell);
  }

  if (isOnCurrentMonth() && isCalendarVisible()) {
    requestAnimationFrame(() => scrollTodayIntoView("auto"));
  }
}

function isOnCurrentMonth() {
  if (!state.calMonth) return false;
  const t = new Date();
  return state.calMonth.y === t.getFullYear() && state.calMonth.m === t.getMonth();
}

function isCalendarVisible() {
  const p = $("#pager");
  return p && Math.round(p.scrollLeft / p.clientWidth) === 1;
}

function scrollTodayIntoView(behavior = "smooth") {
  const cell = document.querySelector(".cal-cell.today");
  if (cell) cell.scrollIntoView({ behavior, block: "center", inline: "nearest" });
}

function renderAll() { renderToday(); renderCalendar(); }

// ───────────────────────────────────────────────────────── DOM glue

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const SUBJECT_OPTIONS = [
  { value: "moon",        label: "Moon" },
  { value: "lemon",       label: "Lemon" },
  { value: "lime",        label: "Lime" },
  { value: "orange",      label: "Orange" },
  { value: "cheese-moon", label: "Cheese moon" },
  { value: "smiley",      label: "Smiley" },
  { value: "watermelon",  label: "Watermelon" },
  { value: "custom",      label: "Custom photo…" },
];

function setMode(mode) {
  if (mode === "custom" && !state.customDataUrl) {
    // No custom photo yet — open settings so they can upload one.
    syncModeControls();
    $("#settingsBtn").click();
    return;
  }
  state.mode = mode;
  persist();
  syncModeControls();
  renderAll();
}

function syncModeControls() {
  const sel = $("#subjectSelect");
  if (sel) sel.value = state.mode;
  $$('input[name="mode"]').forEach((r) => { r.checked = (r.value === state.mode); });
}

function setupSubjectSelect() {
  const sel = $("#subjectSelect");
  for (const o of SUBJECT_OPTIONS) {
    const op = document.createElement("option");
    op.value = o.value;
    op.textContent = o.label;
    sel.appendChild(op);
  }
  sel.value = state.mode;
  sel.addEventListener("change", () => setMode(sel.value));
}

function setupPager() {
  const pager = $("#pager");
  const dots = $$(".dot");
  let settleTimer = null;
  pager.addEventListener("scroll", () => {
    const idx = Math.round(pager.scrollLeft / pager.clientWidth);
    dots.forEach((d, i) => d.classList.toggle("active", i === idx));
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      // After scroll settles, if calendar is now in view and we're on the
      // current month, centre today.
      if (Math.round(pager.scrollLeft / pager.clientWidth) === 1 && isOnCurrentMonth()) {
        scrollTodayIntoView();
      }
    }, 180);
  });
  dots.forEach((d, i) => {
    d.addEventListener("click", () => {
      pager.scrollTo({ left: i * pager.clientWidth, behavior: "smooth" });
    });
  });
}

function setupSettings() {
  const dlg = $("#settingsDlg");
  $("#settingsBtn").addEventListener("click", () => {
    syncSettingsUI();
    dlg.showModal();
  });

  $$('input[name="mode"]').forEach((r) => {
    r.addEventListener("change", () => setMode(r.value));
  });

  $$('input[name="hemisphere"]').forEach((r) => {
    r.addEventListener("change", () => {
      state.hemisphere = r.value;
      persist();
      renderAll();
    });
  });

  $("#photoInput").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const dataUrl = await downsizeImage(file);
    state.customDataUrl = dataUrl;
    state.cropOffsetX = 0.5;
    state.cropOffsetY = 0.5;
    state.cropZoom = 1;
    state.mode = "custom";
    persist();
    await loadCustomImage();
    syncSettingsUI();
    renderAll();
  });

  $("#clearPhoto").addEventListener("click", () => {
    state.customDataUrl = null;
    state.customImage = null;
    state.cropOffsetX = 0.5;
    state.cropOffsetY = 0.5;
    state.cropZoom = 1;
    if (state.mode === "custom") state.mode = "moon";
    persist();
    syncSettingsUI();
    renderAll();
  });

  $("#apDays").addEventListener("change", () => {
    const v = parseInt($("#apDays").value);
    if (Number.isFinite(v) && v >= 1) {
      state.apDays = v;
      persist();
      syncAutoplayButton();
      if (state.apTimer) { stopAutoplay(); startAutoplay(); }  // pick up new range
    }
  });
  $("#apDelay").addEventListener("change", () => {
    const v = parseInt($("#apDelay").value);
    if (Number.isFinite(v) && v >= 100) {
      state.apDelay = v;
      persist();
      if (state.apTimer) { stopAutoplay(); startAutoplay(); }  // pick up new speed
    }
  });

  $("#useGeo").addEventListener("click", askForLocation);
  $("#clearGeo").addEventListener("click", () => {
    state.lat = null; state.lon = null;
    persist();
    syncSettingsUI();
    renderToday();
  });
}

function syncSettingsUI() {
  syncModeControls();
  drawCropPreview();
  $("#apDays").value  = state.apDays;
  $("#apDelay").value = state.apDelay;
  $$('input[name="hemisphere"]').forEach((r) => { r.checked = (r.value === state.hemisphere); });
  $("#locStatus").textContent = (state.lat != null && state.lon != null)
    ? `Lat ${state.lat.toFixed(3)}, lon ${state.lon.toFixed(3)}`
    : "No location set.";
}

function drawCropPreview() {
  const c = $("#cropPreview");
  if (!c) return;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, c.width, c.height);
  const hasPhoto = !!(state.customImage && state.customImage.complete);
  c.dataset.empty = hasPhoto ? "false" : "true";
  $("#cropHint").hidden = !hasPhoto;
  if (!hasPhoto) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(c.width / 2, c.height / 2, c.width / 2 - 1, 0, Math.PI * 2);
  ctx.clip();
  drawImageCover(ctx, state.customImage, 0, 0, c.width, c.height,
                 state.cropOffsetX, state.cropOffsetY, state.cropZoom);
  ctx.restore();
  // Show current zoom and its ceiling.
  const max = maxZoomFor(state.customImage);
  $("#cropHint").textContent = `Drag to pan · scroll/pinch to zoom · ${state.cropZoom.toFixed(2)}× / max ${max.toFixed(2)}×`;
}

// Pan + pinch-zoom + wheel-zoom on the preview. Uses pointer events so it
// works for mouse and touch transparently.
function setupCropPreview() {
  const c = $("#cropPreview");
  const pointers = new Map();           // pointerId → {x,y}
  let pinchStartDist = null;
  let pinchStartZoom = 1;
  let dragStart = null;                 // {clientX, clientY, ox, oy}
  let commitTimer = null;

  function commit() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(() => { persist(); renderAll(); }, 120);
  }

  function setZoom(z) {
    const max = maxZoomFor(state.customImage);
    state.cropZoom = Math.min(max, Math.max(1, z));
    drawCropPreview();
    commit();
  }

  function panBy(dxClient, dyClient) {
    if (!dragStart) return;
    const img = state.customImage;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const rect = c.getBoundingClientRect();
    const dprX = c.width  / rect.width;
    const dprY = c.height / rect.height;
    const dxI = dxClient * dprX;
    const dyI = dyClient * dprY;
    const baseScale = Math.max(c.width / iw, c.height / ih) * state.cropZoom;
    const sxRange = iw - c.width  / baseScale;
    const syRange = ih - c.height / baseScale;
    let ox = dragStart.ox;
    let oy = dragStart.oy;
    if (sxRange > 0) ox -= (dxI / baseScale) / sxRange;
    if (syRange > 0) oy -= (dyI / baseScale) / syRange;
    state.cropOffsetX = Math.min(1, Math.max(0, ox));
    state.cropOffsetY = Math.min(1, Math.max(0, oy));
    drawCropPreview();
  }

  function pointerDistance() {
    const p = [...pointers.values()];
    if (p.length < 2) return 0;
    const dx = p[0].x - p[1].x, dy = p[0].y - p[1].y;
    return Math.hypot(dx, dy);
  }

  c.addEventListener("pointerdown", (e) => {
    if (!state.customImage || !state.customImage.complete) return;
    c.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      dragStart = { clientX: e.clientX, clientY: e.clientY,
                    ox: state.cropOffsetX, oy: state.cropOffsetY };
    } else if (pointers.size === 2) {
      pinchStartDist = pointerDistance();
      pinchStartZoom = state.cropZoom;
      dragStart = null;          // a second finger ends pan and starts pinch
    }
  });

  c.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1 && dragStart) {
      panBy(e.clientX - dragStart.clientX, e.clientY - dragStart.clientY);
    } else if (pointers.size === 2 && pinchStartDist) {
      const d = pointerDistance();
      if (d > 0) setZoom(pinchStartZoom * d / pinchStartDist);
    }
  });

  function release(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStartDist = null;
    if (pointers.size === 0) dragStart = null;
  }
  c.addEventListener("pointerup", release);
  c.addEventListener("pointercancel", release);

  // Wheel = zoom on desktop. preventDefault to stop page scroll.
  c.addEventListener("wheel", (e) => {
    if (!state.customImage || !state.customImage.complete) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setZoom(state.cropZoom * factor);
  }, { passive: false });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

// Downsize an uploaded image to fit within MAX_SIDE px on the longest edge,
// re-encoded as JPEG q=0.92. Keeps localStorage comfortable for big phone
// photos while still leaving plenty of resolution for our 1024-pixel canvases.
async function downsizeImage(file, maxSide = 3072, quality = 0.92) {
  const url = await fileToDataUrl(file);
  const img = await loadImage(url);
  if (!img) return url; // decode failed — fall back to original
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const longest = Math.max(iw, ih);
  if (longest <= maxSide && file.type === "image/jpeg") return url;
  const scale = Math.min(1, maxSide / longest);
  const w = Math.round(iw * scale), h = Math.round(ih * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL("image/jpeg", quality);
}

function askForLocation() {
  if (!navigator.geolocation) {
    alert("Geolocation isn't available in this browser.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.lat = pos.coords.latitude;
      state.lon = pos.coords.longitude;
      persist();
      syncSettingsUI();
      renderToday();
    },
    (err) => alert("Couldn't get location: " + err.message),
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 3600_000 }
  );
}

function shiftViewedDay(deltaDays) {
  const base = viewedDateOrNow();
  // Preserve time-of-day if we're on "today" (no fixed viewedDate yet), so that
  // shifting forward 1 day from "now" gives "this time tomorrow" rather than
  // jumping to midnight. After shifting we always pin to noon so subsequent
  // arithmetic is DST-stable.
  base.setDate(base.getDate() + deltaDays);
  base.setHours(12, 0, 0, 0);
  state.viewedDate = base;
  renderToday();
}

function setViewedDate(date) {
  if (date) {
    date = new Date(date);
    date.setHours(12, 0, 0, 0);
  }
  state.viewedDate = date;
  renderToday();
}

function ymdString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function setupDayNav() {
  $("#prevDay").addEventListener("click", () => { stopAutoplay(); shiftViewedDay(-1); });
  $("#nextDay").addEventListener("click", () => { stopAutoplay(); shiftViewedDay(1); });
  $("#todayDayBtn").addEventListener("click", () => { stopAutoplay(); setViewedDate(null); });

  const inp = $("#dateInput");
  $("#dateBtn").addEventListener("click", () => {
    stopAutoplay();
    inp.value = ymdString(viewedDateOrNow());
    if (typeof inp.showPicker === "function") inp.showPicker();
    else inp.focus();
  });
  inp.addEventListener("change", () => {
    if (!inp.value) return;
    const [y, m, d] = inp.value.split("-").map(Number);
    setViewedDate(new Date(y, m - 1, d));
  });

  $("#autoplayBtn").addEventListener("click", toggleAutoplay);
  syncAutoplayButton();   // set initial label "{N} d"
}

function syncAutoplayButton() {
  const btn = $("#autoplayBtn");
  if (!btn) return;
  const playing = state.apTimer != null;
  $("#apIcon").textContent = playing ? "⏸" : "▶";
  $("#apLabel").textContent = `${state.apDays} d`;
  btn.setAttribute("aria-label", playing ? "Stop autoplay" : "Start autoplay");
  btn.classList.toggle("playing", playing);
}

function toggleAutoplay() {
  if (state.apTimer) stopAutoplay();
  else startAutoplay();
}

function startAutoplay() {
  stopAutoplay();
  // Anchor at whatever the user is currently viewing — so they can position
  // the start date manually first, then press play to scan forward N days.
  const anchor = viewedDateOrNow();
  anchor.setHours(12, 0, 0, 0);
  state.apAnchor = anchor;
  state.apOffset = 0;
  state.viewedDate = new Date(anchor);
  renderToday();
  state.apTimer = setInterval(() => {
    state.apOffset = (state.apOffset + 1) % (state.apDays + 1);
    const d = new Date(state.apAnchor);
    d.setDate(d.getDate() + state.apOffset);
    state.viewedDate = d;
    renderToday();
  }, Math.max(100, state.apDelay));
  syncAutoplayButton();
}

function stopAutoplay() {
  if (state.apTimer) {
    clearInterval(state.apTimer);
    state.apTimer = null;
  }
  syncAutoplayButton();
}

function setupCalendarNav() {
  $("#prevMonth").addEventListener("click", () => {
    const { y, m } = state.calMonth;
    state.calMonth = m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 };
    renderCalendar();
  });
  $("#nextMonth").addEventListener("click", () => {
    const { y, m } = state.calMonth;
    state.calMonth = m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 };
    renderCalendar();
  });
  $("#todayBtn").addEventListener("click", () => {
    const t = new Date();
    state.calMonth = { y: t.getFullYear(), m: t.getMonth() };
    renderCalendar();                                      // hides button, re-renders cells
    requestAnimationFrame(() => scrollTodayIntoView());    // smooth scroll to today
  });
}

// ───────────────────────────────────────────────────────── boot

(async function init() {
  await Promise.all([loadCustomImage(), loadBuiltInAssets()]);
  setupPager();
  setupSubjectSelect();
  setupSettings();
  setupCropPreview();
  setupCalendarNav();
  setupDayNav();
  renderAll();

  // Refresh time-sensitive bits every minute, but only when actually viewing
  // today — fixed past/future dates don't change.
  setInterval(() => { if (isViewingToday()) renderToday(); }, 60_000);

  // PWA service worker registration (only when served over http/https).
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* offline support is optional */ });
  }
})();
