# Remembrance Place

A quiet, static photo album in memory of **Honorina Carvalho DeSousa Arruda**
(April 6, 1938 — July 6, 2026).

The site is a single page: a portrait and her name, then every photo the family
shared, in a justified grid that shuffles on each visit. Tapping a photo opens a
full-screen viewer. There is nothing to sign up for and nothing to upload — the
collection phase is over.

## How it's put together

- **The page** — `site/` is plain HTML, CSS, and JavaScript. No build step, no
  framework, no external dependencies. What's in the folder is what ships.
- **The photos** — stored in the Cloudflare R2 bucket `remembrance-media` and
  served straight to the browser from its public `r2.dev` URL. The page loads
  small `thumbs/` images for the grid and larger `display/` ones in the viewer.
  The original uploads are never loaded by the page.
- **`site/photos.json`** — the album's index: one entry per photo with its thumb
  and display paths and the thumb's dimensions (which let the grid lay out rows
  before any image loads). It deliberately carries no names, messages, or dates.
- **Hosting** — Cloudflare Pages, deploying automatically from `main`. Free.

## Everyday tasks

**Change her name, dates, or the closing line.** Edit `site/index.html` directly —
the text lives in the markup. (`site.config.json` is kept as the record of those
values, but with no server there is nothing reading it at runtime.)

**Point the site at the photos.** `site/config.js` holds the public bucket URL.
Get it from the Cloudflare dashboard → R2 → `remembrance-media` → Settings →
Public access → r2.dev subdomain.

**Preview locally.**

```bash
npm run dev      # serves site/ at http://localhost:3000
```

**Rebuild the photo derivatives** (only needed if photos are added to R2):

```bash
npm install      # first time — pulls in sharp and the S3 client
npm run media    # regenerates thumbs/ + display/ and rewrites site/photos.json
```

The script is safe to re-run: it skips photos whose derivatives already exist,
and it only ever writes to `thumbs/` and `display/`. Pass `--force` to rebuild
everything, or `--limit N` to try a handful first. It needs `.env` (see
`.env.example`) with the R2 credentials — that file is never committed.

**Deploy.** Push to `main`. Cloudflare Pages builds with no build command and
publishes the `site/` directory.

## The printed album

The written messages people sent were kept out of this site on purpose — they're
for the printed album. They live in R2 under `meta/`, and in the verified local
backup (`~/Desktop/memorial-media.zip`, made 2026-07-12).

Two local-only scripts support that work. They're kept out of git deliberately
(see `.gitignore`); they read `.env` and expect to run from the repo root:

- `tools/r2-backup.js` — downloads the whole bucket to `r2-backup/`, verifying
  every byte size.
- `tools/make-zip.js` — organizes a local backup by contributor with a
  `manifest.csv`/`manifest.json` of every message.

## Ground rules

The originals under `uploads/` and the records under `meta/` are the only copies
of what people sent. Nothing here modifies or deletes them; the media script adds
derivatives and nothing else.
