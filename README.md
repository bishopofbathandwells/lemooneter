# Lemooneter (It's Fruitometry!)

A moon-phase tracker that recreates a 15-year-old Symbian app of the same name (originally written by a friend of the project owner). The twist: the moon disc can be swapped for various fruits, a cheese moon, a smiley, or any photo you upload — all rendered with proper lunar-phase shading.

Built as a vanilla **Progressive Web App** — no framework, no build step. Installs on Android (Chrome) and iOS (Safari) via *Add to Home Screen*, no app store required.

**Live**: <https://bishopofbathandwells.github.io/lemooneter/>
**Repo**: <https://github.com/bishopofbathandwells/lemooneter>

---

## Install on your phone

It's a Progressive Web App — no Play Store, no App Store, no APK to sideload.

**Android (Chrome)** — open the live URL → tap the ⋮ menu → **Add to Home Screen**. The app icon lands on your home screen and launches full-screen, looking and behaving like a native app.

**iOS (Safari)** — open the live URL → tap the Share icon → **Add to Home Screen**. Same result. (Other iOS browsers can't install PWAs; you must use Safari for the install step. Once installed, it works independently.)

Updates are automatic: every `git push` triggers a GitHub Pages redeploy within ~30 seconds, and the installed app picks up the new version on next launch.

---

## Features

### Today view (left page)
- **Large phase render** — the chosen subject (moon / fruit / custom) shown at ~420 px with the current lunar phase applied as Lambertian shading.
- **Phase name + % illuminated** (Waxing crescent, First quarter, Waxing gibbous, …).
- **Day navigation bar** below the phase info: `‹` / *interactive date* / **Today** / `›` plus a hidden native `<input type="date">` that the date label opens via `showPicker()`.
- **Counters card** with three columns:
  - **Next full** — countdown from the currently viewed date.
  - **Next new** — same.
  - **Autoplay** — pill button (`▶ N d`) that cycles `viewedDate → viewedDate+N → viewedDate` looping. Anchors at the user's currently viewed date, not always today. Configurable in Settings.
- **Rise / Set times** — once the user grants geolocation, shows moonrise and moonset for the viewed date. Adapted from SunCalc-style Meeus formulas; accuracy ~1 minute.

### Calendar view (right page, swipe or dot)
- **Monthly grid**, 7 columns × 6 rows. Each cell renders the subject at its phase for that day.
- **Capped at 900 px wide** and centred on desktop so cells stay readable on 4K monitors.
- **Page-internal vertical scroll** — the page itself is the scroll container, not the document, so the calendar doesn't push other UI around.
- **Sticky header** containing `‹ month-label Today ›` — pins to the top as you scroll the grid.
- **Today highlight** — accent-yellow border, soft outer glow, and accent-coloured day number.
- **Auto-scroll** — when the calendar becomes the active page (after pager scroll settles) and you're on the current month, today's cell scrolls into the centre.

### Subject selector (top bar)
- Quick `<select>` dropdown next to the settings gear. One-click switch between Moon / Lemon / Lime / Orange / Cheese moon / Smiley / Watermelon / Custom photo.
- Picking "Custom photo…" without a stored photo opens Settings so the user can upload one.
- Stays in sync with the radio buttons in Settings.

### Settings dialog (gear icon)
- **Mode** radios — same options as the dropdown.
- **Custom photo** — file input, Clear button, and a **drag-to-pan, wheel/pinch-to-zoom circular preview**:
  - Photos are downsized to **3072 px** on the longest side and re-encoded as JPEG q=0.92 before storage (keeps `localStorage` comfortable).
  - `cropOffsetX/Y` and `cropZoom` are stored normalised so they're invariant to image dimensions.
  - Max zoom auto-clamps to `min(source_w, source_h) / 962` so the disc is never upsampled.
  - Hint line shows current zoom and the ceiling.
- **Autoplay** — `Days forward` (1-365) and `Delay per day (ms)` (100-10000).
- **Location** — opt-in geolocation; "Use my location" / "Clear" buttons. Coordinates stored in `localStorage`.

### PWA-ness
- `manifest.webmanifest` declares standalone, portrait, black background.
- `sw.js` is a cache-first service worker that precaches the shell and built-in WebP assets so the app works offline after first visit.
- `apple-touch-icon` and theme-color meta tags for iOS install styling.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS, ES modules | No build, simple deploy, works from `file://` for quick testing |
| Rendering | Canvas 2D, per-pixel Lambertian | Same path for moon / fruits / custom photos |
| Image preprocessing | Python (Pillow, NumPy, SciPy) | Offline pipeline run by hand; not part of runtime |
| Storage | `localStorage` | All state: mode, custom photo + crop, location, autoplay config |
| Offline | Service worker (cache-first) | Plain JS, no Workbox |
| Astronomy | Custom JS, SunCalc/Meeus-style | Moon phase + position + rise/set |

No npm, no bundler, no TypeScript. Open `index.html` over a local HTTP server and it runs.

---

## File layout

```
lemooneter/
├── README.md                    (this file)
├── index.html                   (markup + dialogs)
├── app.css                      (all styles)
├── app.js                       (UI + rendering — ES module)
├── astro.js                     (pure astronomy math — ES module, shared with tests)
├── tests.html                   (browser-runnable phase-math tests)
├── manifest.webmanifest         (PWA manifest)
├── sw.js                        (service worker — cache-first shell)
├── icon.svg                     (PWA / favicon)
├── icon-maskable.svg            (Android adaptive icon)
├── tools/
│   └── prepare_image.py         (offline image preprocessing — black-bg source → WebP)
└── fruits/                      (processed runtime assets)
    ├── moon.webp
    ├── lemon.webp
    ├── lime.webp
    ├── orange.webp
    ├── cheese-moon.webp
    ├── smiley.webp
    └── watermelon.webp
```

---

## How rendering works (the part with the maths)

Every subject — moon, fruit, custom photo — uses the **same Lambertian sphere shader**.

1. The chosen subject's transparent PNG/WebP is drawn into an offscreen canvas using either `contain` (built-ins, natural silhouette) or `cover` (custom photos, fill the disc with a crop).
2. The subject's **alpha bounding box** is computed once at load via `getImageData`, scanning for pixels with alpha > 24.
3. A **brightness map** is generated per-render:
   - For each pixel `(x, y)` inside the bbox + 4 px pad, compute `dx = (x-cx)/rx, dy = (y-cy)/ry`.
   - If inside the unit ellipsoid (`dx² + dy² < 1`), `nz = √(1 − dx² − dy²)`.
   - Otherwise (in the AA-feathered edge), project to the limb: `nz = 0`, `dx̂ = dx / |r|`.
   - Sun direction: `s = (sin(2π·phase), 0, −cos(2π·phase))`. At full moon `sz=+1`; at new `sz=−1`; quarters `sx=±1`.
   - Brightness `b = max(0, dx·sx + nz·sz)`; soften with `b = √b` (real lunar surfaces aren't truly Lambertian).
   - Pixels outside the padded rect get RGB 255 (multiply identity).
4. Multiply-blend the brightness map onto the subject.
5. `destination-in` with the original alpha image to clip back to the subject's silhouette (kills any multiply leak into transparent regions).

The 4 px padding plus limb extrapolation past `r²=1` was the critical fix for halo artefacts — without it, the alpha-feathered edge sits *outside* the ellipsoid and gets brightness=255, producing a bright rim around the disc.

**Image preprocessing** does roughly the same thing offline for the source photos:

- Detect the subject by colour/luminance threshold (black background for the current image set).
- Take the largest connected component (rejects stray bright pixels).
- `binary_fill_holes` so dark interior features (smiley eyes, cheese craters) stay opaque.
- Erode the mask by 3-5 px so the alpha boundary sits on fully-interior pixels.
- Gaussian-blur the mask edge (σ=1.0) for anti-aliasing.
- Crop to bbox + pad → centre square → resize to 1024 with Lanczos → WebP q=90.

---

## Moon phase / position math

- **Phase reference epoch**: 2000-01-06 18:14 UTC (a known new moon).
- **Synodic month**: 29.530588853 days.
- **Phase fraction**: `((now − ref) / synodic) mod 1`. 0 = new, 0.5 = full.
- **Illumination**: `(1 − cos(2π·phase)) / 2`.
- **Moon position**: simplified series (mean anomaly, mean longitude, distance) → ecliptic → equatorial.
- **Rise / set**: hour-by-hour altitude scan with bisection at sign changes; horizon refraction approximated as −0.583°.

Cross-checked against published NASA new/full moons (see `tests.html`). Because the model uses a fixed mean synodic period and omits perturbation terms, predictions drift up to **~13 hours** in either direction over a 2-3 year span. Plenty good for "is it roughly a full moon tonight"; not good enough for tide tables. Adding 2-3 higher-order Meeus terms (sun mean anomaly correction, moon longitude perturbation, evection) would tighten this to ~1 hour without much more code — left as a future improvement.

---

## How to run locally

```bash
git clone https://github.com/bishopofbathandwells/lemooneter.git
cd lemooneter
python -m http.server 8765 --bind 127.0.0.1
# open http://127.0.0.1:8765/
```

To test from another device on the same Wi-Fi (e.g. your phone), bind to all interfaces:
```bash
python -m http.server 8765 --bind 0.0.0.0
# then open http://<your-laptop-ip>:8765/ on the phone
```

A few things to know:
- Loading from `file://` works for everything **except** service-worker registration — install / offline only kick in over `http(s)://`.
- After making changes, always **hard-refresh** (Ctrl+Shift+R) so the service worker picks up the new cache version.

---

## How to add a new subject

1. Drop the raw photo into `raw-fruits/`. Black background preferred (matches the current pipeline).
2. Run the preprocessing script:
   ```
   python tools/prepare_image.py raw-fruits/grapefruit.jpg fruits/grapefruit.webp
   # add --extra-inset for sources with a bright thin limb (like the moon)
   ```
3. In `app.js`:
   - Add the key to `state.builtIn = { … }`.
   - Add an entry to `loadBuiltInAssets()`.
   - Add an entry to `SUBJECT_OPTIONS` for the topbar dropdown.
4. In `index.html`, add a radio in the Settings *Mode* fieldset.
5. **Bump the `CACHE` key in `sw.js`** — without this, returning users won't fetch the new assets. Add the new path to `ASSETS`.

---

## Known limitations

- **Custom-photo lighting compounding** — the Lambertian shader assumes the source is uniformly / front-lit. A photo with directional studio lighting (e.g., the old clementine shot) will compound that lighting with our shading and look wrong on the lit side. No fix without normal-map estimation.
- **`localStorage` quota** — typical 5-10 MB. The downsize-on-upload (max 3072 px, JPEG q=0.92) usually lands ~1 MB; we catch the `QuotaExceededError` and alert the user but the photo is then session-only.
- **`showPicker()`** isn't on older Safari; falls back to focusing the input, which doesn't always open the picker on those browsers.
- **Calendar dates beyond ~2100** are fine but the moon math drifts over centuries (no perturbation terms).
- **Custom-photo bbox is not detected** — Lambertian uses the whole disc, so any background in the photo gets shaded along with the subject.
- **`localStorage` eviction** — Chrome/Edge can evict storage from inactive origins (Storage Pressure or Storage Buckets policies; rough rule: ~60 days of disuse without `navigator.storage.persist()`). The custom photo and crop settings live in `localStorage`, so a long-dormant install may reset to defaults.

---

## What's left for "release"

### Must
- [ ] **Full PWA icon set** — currently just `icon.svg` and `icon-maskable.svg`. Add raster PNGs at 192, 256, 384, 512 px in the manifest. iOS needs `apple-touch-icon` at multiple sizes (180, 152, 120). Android adaptive icon needs separate foreground + background.
- [ ] **Photo attribution** — the full moon photo (`raw-fruits/moon.jpg`) is Wikipedia's `1280px-FullMoon2010.jpg`; check the licence and credit Gregory H. Revera (the original photographer) per the CC-BY-SA terms.
- [ ] **iOS Safari real-device testing** — Android Chrome confirmed working. iPhone Safari install + use still pending.

### Should
- [ ] **Update-available toast** — when a new SW activates, surface a "Reload to update" hint. Currently the cache flips silently on next reload.
- [ ] **Error states** — what happens if a WebP fetch fails? Empty canvas. Fall back to a placeholder or retry.
- [ ] **Accessibility audit** — keyboard navigation through the day-nav, focus rings, screen-reader labels on the canvas (currently has `aria-label`).

### Nice to have
- [ ] **Performance** — first load is ~600 KB of WebPs. Could lazy-load all but the active subject.
- [ ] **Improve phase-math accuracy** — current model drifts up to ~13 hours over a few years. Adding 2-3 Meeus terms (sun mean-anomaly correction, evection, moon longitude perturbation) gets it to ~1 hour without much more code.
- [ ] **Share image** button — render the current Today view as PNG and trigger the share sheet on mobile.

---

## Building an Android app from this

Four viable paths, by audience:

### 1. PWA install (free, no APK, no Play Store)
Host on HTTPS → Chrome's "Add to Home Screen" produces an installable icon. **No Play Store presence**, no review, no fee. Best for personal use or sharing a link. Updates are instant on next visit.

### 2. Capacitor + self-signed APK (free, personal / friends)
**This is the path for sharing with friends without going near the Play Store.** Capacitor wraps your web assets inside an APK. You build it locally with Android Studio, get a debug-signed `.apk`, email it to friends, they install it by allowing "unknown apps" in Android settings.

Steps:
1. Install Node.js, Java JDK 17, and Android Studio (one-time).
2. From the project root:
   ```
   npm init -y
   npm install -D @capacitor/core @capacitor/cli @capacitor/android
   npx cap init "Lemooneter" "com.lemooneter.app"
   ```
3. Edit `capacitor.config.ts` so `webDir` points at the directory containing `index.html`.
4. `npx cap add android` — generates an `android/` Gradle project.
5. `npx cap copy && npx cap open android` — opens Android Studio.
6. *Build → Build Bundle(s) / APK(s) → Build APK(s)*. Out comes a debug-signed APK.
7. Bump `versionCode` and `versionName` in `android/app/build.gradle` each release.

Pros: zero cost, fully offline (assets bundled), versioned binary you control. Cons: friends see an "unknown developer" warning on install, no auto-updates (you resend the APK).

### 3. Trusted Web Activity (TWA, $25 once, Play Store)
Wraps the hosted PWA in a thin Android shell using Chrome Custom Tabs. The PWA runs in Chrome under the hood, so content updates ship instantly without a new APK.

Steps (the hosted PWA is already at <https://bishopofbathandwells.github.io/lemooneter/>):
1. `npm i -g @bubblewrap/cli`.
2. `bubblewrap init --manifest=https://bishopofbathandwells.github.io/lemooneter/manifest.webmanifest`.
3. Set up Digital Asset Links (`assetlinks.json` at the domain root) so Android verifies the PWA matches the app. *Hosting the file at the right path under github.io is fiddly; a custom domain is easier.*
4. `bubblewrap build` → unsigned `.aab`. Sign with `keytool` + `jarsigner`.
5. Pay the **one-time $25 Google Play Developer fee**, upload the AAB.

Pros: tiny shell, web-style update cadence. Cons: requires public HTTPS hosting and a Play Store account.

### 4. Capacitor + Play Store listing ($25 once, broad audience)
Same Capacitor setup as #2, but signed with a release key, uploaded to Play Store. Useful if you want to grow beyond friends. Cons: full Play Store review, slower update cadence than TWA.

### Recommendations
- **For just you and friends**: path 2 (Capacitor + APK file). Free, simple, versioned.
- **For Play Store presence with web-style updates**: path 3 (TWA).
- **For Play Store + planned native APIs (camera, notifications)**: path 4 (Capacitor + Play Store).

For iOS, the equivalent of path 2 doesn't exist — Apple's sideloading restrictions mean any "real app" needs the **Apple Developer Program ($99/year)** and TestFlight (free for testers, but you need the dev account to publish). The free path remains *Add to Home Screen* in Safari.

---

## Deploy flow

The repo is wired to GitHub Pages:

1. Make changes locally.
2. Run a local server (`python -m http.server 8765 --bind 127.0.0.1`) and hard-refresh to verify.
3. **Bump `CACHE` in `sw.js`** if any cached asset changed (HTML/CSS/JS/icons/WebPs/`astro.js`). Without this, returning users keep the old code.
4. `git add` the modified files, commit with a meaningful message, `git push`.
5. GitHub Pages picks up the change and redeploys in ~30 seconds. The Settings → Pages tab in the repo shows build status.
6. The installed PWA on devices picks up the new version on the *next* launch (or after a foreground reload — the service worker installs new assets in the background, activates them when all open tabs close).

If a friend installed the PWA and isn't seeing your latest changes, ask them to fully close the app (swipe it away from Recents on Android, force-quit on iOS) and reopen. That triggers the SW activate step.

---

## Project history

Originally requested as a recreation of a Symbian/early-Android app called *Lemooneter* (a moon-phase tracker with a lemon-image swap). Built up iteratively over a single session:

1. PWA scaffold + Today / Calendar pager.
2. Procedural moon, then real moon photo + crop-to-circle.
3. Lemon mode with shape-fitted shadow.
4. Clementine, then bee-orange.
5. Lambertian shader replacing the hand-drawn ellipse-shadow approach (two sub-agents convened to diagnose halos and converged on padded ellipsoid + limb extrapolation).
6. Black backgrounds + transparent PNGs + WebP encoding.
7. New subject lineup (lime, cheese-moon, smiley, watermelon).
8. Layout overhaul — capped widths, sticky calendar header, internal page scroll, auto-scroll to today.
9. Subject dropdown in topbar.
10. Custom-photo crop preview with drag-to-pan + wheel/pinch-zoom.
11. Day navigation + autoplay.
12. Southern-hemisphere toggle; new/quarter/full markers in the calendar; `astro.js` extraction + `tests.html`; `tools/prepare_image.py` committed.
13. Squashed-canvas + long-date fixes on phones.
14. **Pushed to GitHub and deployed to GitHub Pages** — <https://bishopofbathandwells.github.io/lemooneter/>.
