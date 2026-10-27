# Working on Lemooneter

## Project and architecture

Lemooneter ("It's Fruitometry!") recreates an older Symbian moon-phase app. It is a vanilla HTML/CSS/JavaScript PWA with ES modules, no framework, no npm dependencies, and no build step. Preserve that simplicity unless a requirement justifies changing it. Prefer the PWA; native packaging was discussed and parked.

- `index.html`: markup and settings dialogs.
- `app.css`: styling and responsive layout.
- `app.js`: UI, state, canvas rendering, photo cropping, calendar, autoplay.
- `astro.js`: pure astronomy math, also imported by `tests.html`.
- `fruits/*.webp`: seven built-in subjects; custom photos use the same shading path.
- `tools/prepare_image.py`: offline Python image preparation, not a runtime dependency.
- `sw.js`: cache-first offline shell and assets.
- `manifest.webmanifest` and `icon-*.png`: PWA metadata and lemon-photo icons.

Repository: https://github.com/bishopofbathandwells/lemooneter
Published URL: https://bishopofbathandwells.github.io/lemooneter/
GitHub Pages serves the root of `main`. These URLs describe the configured project; verify deployment status when needed.

## Development and release workflow

1. Serve the repo over HTTP, for example `python -m http.server 8765 --bind 127.0.0.1`, and open http://127.0.0.1:8765/.
2. For astronomy changes, open `/tests.html` and check its results. It checks known phase events with a deliberately broad tolerance. For UI changes, inspect the affected behavior on desktop and a phone-sized viewport; watch for flattened calendar discs, long dates, scrolling and crop interactions.
3. When changing any cached runtime asset, bump the `CACHE` string in `sw.js` and update `ASSETS` if files were added or removed. Documentation-only edits do not need a cache bump.
4. Let the user refresh the local app and confirm the result before committing or pushing implementation changes. This is an explicit preference recovered from Claude development notes. Bundle related verified fixes into one commit. Do not push as part of routine debugging.
5. After an authorized push, verify deployment when relevant. Installed clients can require fully closing and reopening the PWA to pick up cached updates.

If commit identity needs configuring, use repo-local configuration, not global: user `bishopofbathandwells`, email `6672895+bishopofbathandwells@users.noreply.github.com`.

## Rendering invariants and known limits

The renderer applies per-pixel Lambertian shading to an ellipsoid fitted to the subject's alpha bounding box. Compute brightness through a 4 px padding region around the bbox. Outside the unit ellipsoid, project to the limb (`nz = 0`) instead of leaving brightness at 255. The feathered alpha edge extends outside the ellipsoid; losing this extrapolation reintroduces bright halos. Preserve final alpha clipping and the southern-hemisphere light-direction inversion.

The astronomy uses a fixed mean synodic period (29.530588853 days) without perturbation terms. Historical checks found drift up to roughly 13 hours over a few years; the existing phase tolerance is approximately 14 hours. Do not claim precision suitable for tides or exact event prediction. Improving this requires a deliberate model change and reference checks.

State is in `localStorage`: `lm.mode`, `lm.photo`, `lm.lat`, `lm.lon`, `lm.cropX`, `lm.cropY`, `lm.cropZ`, `lm.apDays`, `lm.apDelay`, `lm.hemisphere`. Preserve compatibility when changing state. Crop offsets are normalized, and uploads are reduced to a maximum 3072 px side and JPEG quality 0.92. Handle storage quota failures; custom-photo persistence is limited by browser storage.

## Debugging preference

If a fix fails, pause and investigate the observed symptom before patching again. Document two or three distinct approaches with tradeoffs; use parallel agents only when authorized by the current session or applicable instructions. For persistent visual bugs, inspect a current reproduction or screenshot. The historical halo bug took several failed patches before the shading/alpha boundary was identified.

## Historical handoff and pending work

Recovered from Claude memory dated 26 May 2026 and the session stored under `C:/Users/zahir/.claude/projects/D--tmp-claude/`. The old working copy was `D:/tmp/claude/lemooneter`. Treat historical backlog items as leads to verify against current code, not proof of current defects.

- The later session requested a single main screen in place of the separate swipe page. The cloned repository still has a Today/Calendar pager. This is a pending historical request, not authorization to implement it during unrelated work.
- Lemon-photo PNG icons at 192 and 512 px, including a maskable icon, are already committed. Older README/memory statements saying only SVG icons exist are stale.
- Previously noted follow-ups: verify moon-photo licensing and attribution (the notes identify Gregory H. Revera's FullMoon2010 image), real-device iOS Safari testing, an update-available hint, failed-image handling, accessibility, lazy loading, more accurate phase math, and sharing the rendered image. Recheck each before acting.
- Android installation was reported working during the original development; that is historical user feedback, not current cross-device verification.

See `README.md` for more background, but check its claims against the implementation because some release notes predate the final icon change.
