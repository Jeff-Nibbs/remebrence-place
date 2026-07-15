# PLAN: Pivot to Static Remembrance Photo Album

> **For the implementing agent:** This plan is self-contained — everything you need is here.
> It was produced from a detailed requirements interview with the owner (Jeff) on 2026-07-15.
> Decisions listed here are FINAL; do not re-ask them. Where the plan says "USER ACTION",
> pause and ask Jeff to do that step (dashboard clicks he must do himself).

## 1. Background & goal

This repo is currently a memorial site where family uploaded photos/videos of
**Honorina Carvalho DeSousa Arruda** (April 6, 1938 — July 6, 2026). The collection
phase is OVER: **359 files (841 MB)** live in the Cloudflare R2 bucket `remembrance-media`
(a verified local backup was also made 2026-07-12 → `~/Desktop/memorial-media.zip`).

The site now pivots to a **read-only remembrance photo album**:

- ❌ Remove ALL upload functionality (form, dropzone, presign/complete endpoints).
- ❌ Remove the Express server entirely — the site becomes **fully static**.
- ✅ Clean photo-gallery grid of the collected photos, fast on desktop AND phones.
- ✅ Cheapest possible: $0/month (Cloudflare Pages free + R2 free tier).

## 2. Final decisions (from the owner interview — do not re-litigate)

| Topic | Decision |
|---|---|
| Architecture | Fully static site, no server, no database |
| Hosting | **Cloudflare Pages**, auto-deploy from the GitHub repo (`Jeff-Nibbs/remebrence-place`) |
| Media storage | Stays in existing R2 bucket `remembrance-media`, made **public** via free `r2.dev` URL |
| Old Render URL | No redirect — Render gets shut down once the new site is live; Jeff shares the new link |
| Videos | **EXCLUDED from the site.** Photos only. Videos remain untouched in R2 |
| Performance | Pre-generate thumbnails (grid) + resized "large" versions (lightbox); originals never load in the page |
| Grid style | **Justified rows** (Google Photos style) — natural aspect ratios, even row edges |
| Photo order | **Shuffled on every page load** (client-side Fisher–Yates) |
| Labels on photos | **NONE.** No captions, no hover popups, no uploader names on/under photos |
| Tap a photo | **Lightbox**: full-screen viewer, next/prev arrows + swipe, subtle "37 / 340" counter. No download button, no text |
| Header | Her name, dates, one short line (e.g. "Forever in our hearts"), and a **featured portrait photo** |
| Portrait selection | Build a local contact sheet of candidates; **Jeff picks** the portrait (see Phase 4) |
| Written memories/messages | **NOT displayed.** Jeff is saving them for a printed album. They stay safe in R2 meta + backup zip |
| Contributor names | Shown once as a quiet **thank-you list** (unique uploader names), e.g. near the footer |
| Design | **Refresh**: lighter/whiter clean gallery feel (move away from current cream/gold). Still respectful, elegant, minimal |
| Extras | Back-to-top floating button. Photo counter in lightbox. Nothing else |

## 3. Current state of the repo (before this work)

- `server.js` — Express app: config endpoint, presigned R2 uploads, `/api/media`, `/api/download-all` (this zip endpoint has a known socket-pool deadlock with 359 files; irrelevant after this pivot — it gets deleted).
- `public/index.html`, `public/app.js`, `public/styles.css` — upload form + card gallery (cream/gold serif design).
- `site.config.json` — name/dates/messages (hero text still asks people to share photos — outdated).
- `r2-backup.js` — working one-time script that downloads the whole bucket; **copy its `.env`-loading and S3 client pattern** for new scripts.
- `make-zip.js` — builds the printed-album zip from a local backup; **keep** (Jeff needs it for the printed album).
- `render.yaml`, `DEPLOY.md` — Render deployment; obsolete after pivot.
- `.env` (NOT committed) — contains working `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `ADMIN_KEY`, `MAX_FILE_MB`. Node v22 installed.
- Deps installed: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `archiver`, `express`.
- Git branch at time of writing: `update-site-config`; default branch `main`.

### R2 bucket layout

- `uploads/<timestamp>-<hex>.<ext>` — original media files (photos AND videos, mixed).
- `meta/<uuid>.json` — one per file: `{ id, key, filename, originalName, type: "image"|"video", size, uploaderName, message, uploadedAt }`.
- The `type` field distinguishes photos from videos; also video extensions: `mp4 mov m4v avi mkv webm 3gp mts wmv`.

## 4. Implementation phases

### Phase 1 — Media processing script (`tools/build-media.js`)

One-time (re-runnable, idempotent) Node script. Use the `.env` loader + S3Client setup
from `r2-backup.js`. Prefer working from R2 directly (the local `r2-backup/` folder was
deleted); download originals to a temp/cache dir as needed.

1. List all `meta/*.json`, parse, **filter to photos only** (`type === "image"`).
2. For each photo generate two derivatives with `sharp` (add as devDependency):
   - **Thumb**: long edge ≈ 640 px, JPEG quality ~72, target ~40–100 KB → upload to R2 as `thumbs/<same-basename>.jpg`.
   - **Large** (lightbox): long edge ≈ 1600–2048 px, JPEG quality ~80 → upload to R2 as `display/<same-basename>.jpg`.
   - Use `sharp().rotate()` (no args) so EXIF orientation is baked in.
3. **HEIC/HEIF warning**: prebuilt `sharp` cannot decode `.heic`. And browsers (except Safari)
   can't display HEIC at all — so HEIC photos MUST get JPEG derivatives, and the lightbox
   must use the `display/` JPEG, never the HEIC original. On this Mac the easy path is
   macOS `sips` to convert HEIC→JPEG first: `sips -s format jpeg in.heic --out out.jpg`
   (or use the `heic-convert` npm package for portability). Check the collection for
   `.heic/.heif` extensions and handle them.
4. Write **`site/photos.json`** (committed to the repo):
   ```json
   {
     "count": 0,
     "contributors": ["Name A", "Name B"],
     "photos": [
       { "thumb": "thumbs/xxx.jpg", "full": "display/xxx.jpg", "w": 640, "h": 480 }
     ]
   }
   ```
   - `w`/`h` are the THUMB pixel dimensions — required by the justified layout to compute
     row heights without loading images (prevents layout shift).
   - `contributors` = unique, trimmed `uploaderName` values (skip "Anonymous" or keep — Jeff's call at review; default keep).
   - Do NOT include uploader names, messages, or dates per photo — they must not ship per-photo to the page.
5. Idempotency: skip derivative generation/upload if the object already exists in R2 with
   nonzero size. Parallelize with a small concurrency limit (~8) — remember the old
   `/api/download-all` deadlocked by opening 359 streams at once against the SDK's socket pool.
6. NEVER delete or overwrite anything under `uploads/` or `meta/`. Derivatives only ever
   go to `thumbs/` and `display/`.

### Phase 2 — Make the bucket public (USER ACTION)

Jeff does this in the Cloudflare dashboard (can't be done with the S3 keys in `.env`):

1. Cloudflare dashboard → R2 → bucket `remembrance-media` → **Settings** → **Public access** → *Allow Access* / enable the **r2.dev subdomain**.
2. Give the resulting URL (looks like `https://pub-<hash>.r2.dev`) to the agent.
3. Put it in the frontend as the media base URL constant (e.g. `const MEDIA_BASE = "https://pub-….r2.dev"` in the site JS or a small `site/config.js`).

Note: public buckets serve GETs to browsers without CORS config; no CORS work needed for
plain `<img>` loading. Consider telling Jeff that r2.dev applies light rate-limiting —
fine for a family site; a custom domain can be added later if ever needed.

### Phase 3 — New static frontend (in `site/`)

Vanilla HTML/CSS/JS, **no build step, no framework, no external CDN dependencies**.
System font stack or a single self-hosted font file. Files: `site/index.html`,
`site/styles.css`, `site/app.js`, `site/photos.json`, `site/portrait.jpg` (chosen in Phase 4),
`site/favicon.svg` (simple, tasteful — e.g. a subtle flower/dove mark).

**Page structure:**
1. **Header** — centered: featured portrait (modest size, maybe soft-edged circle or gentle rounded rectangle), "In Loving Memory" eyebrow, her name `Honorina Carvalho DeSousa Arruda` (from `site.config.json`), dates `April 6, 1938 — July 6, 2026`, one short line ("Forever in our hearts."). No call-to-action — nothing to share anymore.
2. **The album** — justified-rows grid of ALL photo thumbs:
   - Shuffle `photos` array client-side each load (Fisher–Yates).
   - Justified rows can be done with the flexbox technique — for each item:
     `flex-grow: (w/h); flex-basis: calc(w/h * <targetRowHeight>px); aspect-ratio: w/h` —
     or a tiny row-packing function in JS. Target row height ≈ 220 px desktop, ≈ 130–150 px phones. Thin uniform gaps (4–6 px). No borders, no shadows, no captions.
   - `loading="lazy"` + `decoding="async"` on every img; empty `alt=""` (decorative, no labels by design) or `alt="Photo of Honorina"`.
   - With ~300+ imgs, plain lazy loading is acceptable; if scroll performance suffers on phones, add a simple IntersectionObserver to only attach `src` near viewport.
3. **Thank-you strip** — one quiet paragraph: "With love and thanks to everyone who shared their memories: <names, comma-separated>" from `photos.json.contributors`.
4. **Footer** — the `footerMessage` from `site.config.json`.

**Lightbox** (hand-rolled, ~100 lines):
- Click/tap thumb → full-screen overlay (near-black backdrop) showing the `display/` version (never the original, never HEIC).
- Next/prev: on-screen arrows, ArrowLeft/ArrowRight keys, touch swipe (simple touchstart/touchend deltaX).
- Subtle counter "N / TOTAL" (small, low-contrast, e.g. bottom center).
- Close: ✕ button, Escape key, click on backdrop.
- Preload the next and previous `display/` images when open.
- No download button, no captions, no other chrome.

**Back-to-top**: small floating button, appears after ~2 viewport-heights of scroll, smooth-scrolls up.

**Design refresh** (moving away from cream/gold):
- Near-white background (`#fff` / `#fafafa`), soft dark-gray text, generous whitespace.
- Typography: an elegant serif is still appropriate for her name; keep body UI minimal/sans. Restrained, gallery-like — the photos are the color.
- Must look right on a phone first: single-purpose page, fast, no horizontal scroll.
- Respect `prefers-reduced-motion` for any transitions.

### Phase 4 — Featured portrait (USER ACTION to pick)

1. Generate `contact-sheet.html` locally (NOT committed/published): a simple page of all
   thumbnails with their filenames — or preselect ~12 likely portrait candidates
   (portrait-orientation photos are a good heuristic) at the top.
2. Show it to Jeff; he picks one.
3. Export a high-quality crop as `site/portrait.jpg` (~800 px, quality 85).

### Phase 5 — Repo restructure & cleanup

- **Delete**: `server.js`, `public/` (old frontend), `render.yaml`, `DEPLOY.md` (or rewrite for Pages).
- **Keep**: `site.config.json` (name/dates/footer text — update `heroMessage`/`uploadPrompt` wording since nothing is uploaded anymore; the static build can inline these values at write time since there's no server to read it), `r2-backup.js` and `make-zip.js` → move to `tools/` (Jeff still needs them for the printed album).
- **package.json**: drop `express`, `archiver`, `@aws-sdk/s3-request-presigner` from runtime deps; keep `@aws-sdk/client-s3` + add `sharp` as devDependencies (only `tools/` uses them). Add scripts: `"media": "node tools/build-media.js"`, `"dev": "npx serve site"` or similar static preview.
- **README.md**: rewrite — what the site is now, how to re-run the media script, how deploys work (push to `main` → Pages auto-deploys), where the printed-album data lives.
- `.gitignore`: keep ignoring `.env`, `r2-backup/`, any local media caches. (Note: `.gitignore` has uncommitted local modifications on branch `update-site-config` — look at them before touching.)
- Work on a feature branch; PR into `main`.

### Phase 6 — Deploy to Cloudflare Pages (mostly USER ACTION)

1. Jeff: Cloudflare dashboard → **Workers & Pages** → Create → Pages → *Connect to Git* → select `Jeff-Nibbs/remebrence-place`, production branch `main`.
2. Build settings: **no build command**, output directory `site`.
3. Verify the `*.pages.dev` URL on desktop + phone.
4. Jeff shares the new link with family, then **suspends/deletes the Render service** (no redirect wanted).

### Phase 7 — Verification checklist

- [ ] `photos.json` count matches the number of image-type meta entries in R2 (expect roughly 359 minus videos).
- [ ] Every `thumb`/`full` URL in `photos.json` returns 200 from the public r2.dev base.
- [ ] No `.heic` URL is ever referenced by the site.
- [ ] Grid loads fast on a throttled mobile profile (thumbs only; check network tab — no original `uploads/` requests from the grid or lightbox).
- [ ] Lightbox: arrows, swipe, Escape, counter, adjacent preload all work.
- [ ] Shuffle: order differs between two reloads.
- [ ] Back-to-top appears/works; no horizontal scroll on a 375 px viewport.
- [ ] No uploader names/messages visible anywhere except the single thank-you list.
- [ ] Nothing under R2 `uploads/` or `meta/` was modified or deleted.

## 5. Hard constraints / gotchas

1. **This is a memorial for a real, recently passed family member.** Tone in all copy: warm, quiet, respectful. No playful microcopy.
2. **Never modify or delete R2 originals** (`uploads/`, `meta/`). Only add `thumbs/` and `display/`.
3. `.env` holds live R2 credentials — never commit it, never print secret values.
4. The old `/api/download-all` deadlock bug is moot (endpoint deleted), but it's the cautionary tale for why the media script must limit S3 concurrency.
5. HEIC: sharp's prebuilt binaries can't decode it and non-Safari browsers can't render it — convert via `sips`/`heic-convert` (see Phase 1.3).
6. The written messages are precious (printed album). They already exist in the backup zip's manifest and in R2 `meta/`. Do not strip them from R2.
