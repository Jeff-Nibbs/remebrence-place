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

| Variable      | Default     | What it does                          |
| ------------- | ----------- | ------------------------------------- |
| `PORT`        | `3000`      | Port the site runs on                 |
| `ADMIN_KEY`   | `change-me` | Key for the download-everything link  |
| `MAX_FILE_MB` | `500`       | Max size per uploaded file, in MB     |

## Where are the files stored?

Uploads are saved in the `data/uploads/` folder on the server, with details in
`data/metadata.json`. **Back up the `data/` folder** — it holds every memory
your family shares.

## Hosting it so family can visit

This app needs a host with **persistent disk storage** (uploads are saved to the
server's filesystem). Good options:

- **[Railway](https://railway.app)** or **[Render](https://render.com)** — attach a persistent disk/volume, point it at `/app/data`.
- **A small VPS** (DigitalOcean, Hetzner, Lightsail) — run `npm start` behind a reverse proxy.
- **A spare computer at home** with a tunnel like [Cloudflare Tunnel](https://www.cloudflare.com/products/tunnel/) or [Tailscale Funnel](https://tailscale.com/kb/1223/funnel).

Avoid serverless hosts (Vercel, Netlify, GitHub Pages) — they can't keep
uploaded files between requests.
