# Remembrance Place

A gentle remembrance website for a loved one who has passed. Family and friends
can upload their favorite **photos and videos**, along with their name and a
memory. Everything is saved on the server so you can later download it all in
one zip file — organized by contributor, with a manifest — to build a big
memorial video collage.

## What's included

- **Beautiful memorial landing page** — the loved one's name, dates, and a message to the family (all editable in `site.config.json`).
- **Easy uploads** — drag & drop or tap to pick photos/videos, works on phones. Contributors add their name and an optional memory. Supports large video files (500 MB per file by default) with an upload progress bar.
- **Memories gallery** — everything shared appears on the page for the whole family to enjoy.
- **One-click export for the collage** — a private admin link downloads a zip of every file, sorted into folders by contributor, plus a `manifest.csv` / `manifest.json` listing who shared each file, when, and their message. Perfect for importing into a video editor.

## Getting started

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm start
```

Then open http://localhost:3000

## Personalize the site

Edit `site.config.json` and change the name, dates, and messages:

```json
{
  "siteTitle": "In Loving Memory",
  "personName": "Grandma Rose",
  "birthDate": "March 3, 1941",
  "passedDate": "June 20, 2026",
  "heroMessage": "Your message to the family...",
  "uploadPrompt": "Share a photo, a video, a moment...",
  "footerMessage": "Thank you for helping us remember."
}
```

Restart the server after editing (or just refresh — the config is read on each request).

## Downloading everything for the memorial video

Set a private admin key when starting the server:

```bash
ADMIN_KEY=my-secret-key npm start
```

Then visit (only share this link with whoever is making the video):

```
http://your-site.com/api/download-all?key=my-secret-key
```

You'll get `memorial-media.zip` containing:

- One folder per contributor with all their photos/videos
- `manifest.csv` — spreadsheet of every file: who shared it, when, and their message
- `manifest.json` — the same data for any tools/scripts

## Settings (environment variables)

| Variable               | Default     | What it does                                            |
| ---------------------- | ----------- | ------------------------------------------------------- |
| `PORT`                 | `3000`      | Port the site runs on                                   |
| `ADMIN_KEY`            | `change-me` | Key for the download-everything link                    |
| `MAX_FILE_MB`          | `500`       | Max size per uploaded file, in MB                       |
| `R2_ACCOUNT_ID`        | —           | Your Cloudflare account ID                              |
| `R2_ACCESS_KEY_ID`     | —           | R2 API token access key                                 |
| `R2_SECRET_ACCESS_KEY` | —           | R2 API token secret                                     |
| `R2_BUCKET`            | —           | Name of the R2 bucket to store media in                 |
| `R2_PUBLIC_BASE_URL`   | —           | *(optional)* public URL if you make the bucket public   |

See `.env.example` for a template.

## Where are the files stored?

**With Cloudflare R2 configured** (the recommended setup), every photo and video
is stored in your R2 bucket, and each contributor's name/message is stored
alongside it as a small `meta/*.json` object. Nothing is kept on the web server's
disk, so the site can run on cheap hosts that don't offer persistent storage.

**Without R2** (no `R2_*` variables set), it falls back to saving uploads in the
local `data/` folder — handy for trying it out on your own computer.

## Hosting it so family can visit (no self-hosting)

Because media now lives in **Cloudflare R2**, this app no longer needs a server
with persistent disk. Uploads go straight from the visitor's browser to R2, so
even large videos never pass through (or fill up) the web server.

**See [`DEPLOY.md`](DEPLOY.md) for the full step-by-step guide.** In short:

1. Create a Cloudflare R2 bucket and an API token (a few dollars a month; often
   free for a small memorial site — R2 has no egress fees).
2. Add a CORS rule to the bucket so browsers can upload to it.
3. Deploy this repo to a managed host — **[Render](https://render.com)**,
   **[Railway](https://railway.app)**, or **[Fly.io](https://fly.io)** — and paste
   in the `R2_*` environment variables. No disk to configure.

You still get the same one-click `download-all` zip for building the memorial
video — the server streams it straight from R2.
