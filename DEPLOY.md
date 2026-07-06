# Deploying Remembrance Place (no self-hosting)

This guide gets your memorial site online using **Cloudflare R2** for storage
and a **managed host** for the app. You never run or maintain a server yourself.

Total cost is small — often **a few dollars a month**, and sometimes free for a
short-lived family memorial site. R2 charges only for storage and has **no
egress (download) fees**.

There are two pieces:

1. **Cloudflare R2** — where the photos and videos are stored.
2. **A web host** (Render / Railway / Fly.io) — runs the small Node app that
   shows the page and hands out upload links.

---

## Part 1 — Set up Cloudflare R2 (storage)

1. Create a free [Cloudflare account](https://dash.cloudflare.com/sign-up).
2. In the dashboard, go to **R2** in the left sidebar and click
   **Create bucket**. Name it something like `remembrance-media`. (You'll be
   asked to add a payment method; R2's free tier covers a lot.)
3. Find your **Account ID** — it's shown on the R2 overview page (and in your
   dashboard URL). Save it.
4. Create an API token: **R2 → Manage R2 API Tokens → Create API token**.
   - Permissions: **Object Read & Write**
   - Scope it to your bucket (or all buckets — your choice)
   - Click create, then copy the **Access Key ID** and **Secret Access Key**.
     You won't be able to see the secret again, so save it now.

### Add the CORS rule (important)

Visitors' browsers upload files directly to R2, so R2 must allow it. In your
bucket: **Settings → CORS Policy → Edit**, and paste this (replace the origin
with your real site URL once you have it — you can start with `"*"` and tighten
it later):

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

> Tighten `AllowedOrigins` to `["https://your-site-url"]` after deploying so
> only your site can upload.

You now have five values to plug into the host in Part 2:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET` (e.g. `remembrance-media`)
- `ADMIN_KEY` (make up a long secret — this protects your download link)

---

## Part 2 — Deploy the app

Pick **one** host below. All three read the same repo and just need the
environment variables from Part 1.

### Option A — Render (simplest dashboard)

1. Push this repo to your own GitHub account (or fork it).
2. Sign in to [Render](https://render.com) → **New → Web Service** → connect the
   repo.
3. Settings:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** the cheapest paid tier is fine; the free tier also works
     but sleeps when idle (first visit after a nap is slow). **No disk needed.**
4. Under **Environment**, add each variable from Part 1
   (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
   `ADMIN_KEY`, and optionally `MAX_FILE_MB`).
5. Deploy. Render gives you a URL like `https://your-site.onrender.com`.

### Option B — Railway

1. Push the repo to GitHub.
2. [Railway](https://railway.app) → **New Project → Deploy from GitHub repo**.
3. It auto-detects Node and runs `npm start`.
4. **Variables** tab → add the same environment variables from Part 1.
5. **Settings → Networking → Generate Domain** to get a public URL.

### Option C — Fly.io

1. Install the [flyctl CLI](https://fly.io/docs/hactl/install/) and run
   `fly launch` in this folder (accept Node defaults, no volume needed).
2. Set secrets:
   ```bash
   fly secrets set R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... \
     R2_SECRET_ACCESS_KEY=... R2_BUCKET=remembrance-media ADMIN_KEY=your-secret
   ```
3. `fly deploy`.

---

## Part 3 — Personalize and share

1. Edit [`site.config.json`](site.config.json) with the name, dates, and
   messages, then push — the host redeploys automatically.
2. Open your site URL, upload a test photo, and confirm it appears in the
   gallery. (If uploads fail, re-check the CORS rule in Part 1.)
3. Share the URL with family.

## Getting everything back for the memorial video

Visit this link (keep it private — only for whoever edits the video):

```
https://your-site-url/api/download-all?key=YOUR_ADMIN_KEY
```

You'll get `memorial-media.zip` — every file sorted into a folder per
contributor, plus `manifest.csv` / `manifest.json` listing who shared what and
their message. The server streams it straight from R2.

## Keeping the media

Everything lives in your R2 bucket. Even if you shut the website down later, the
photos and videos remain safe in R2 until you delete them — and you can always
download them all with the link above first.
