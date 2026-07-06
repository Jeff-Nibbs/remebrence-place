const express = require('express');
const archiver = require('archiver');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';
const MAX_FILE_MB = parseInt(process.env.MAX_FILE_MB || '500', 10);
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

// --- Cloudflare R2 configuration (S3-compatible) ---
// If these are set, uploads go straight to R2 and the server needs no disk.
// If they are not set, the app falls back to storing files on local disk
// (handy for running `npm start` on your own machine to try it out).
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ENDPOINT =
  process.env.R2_ENDPOINT ||
  (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
// Optional: if you make the bucket public (via a custom domain or the r2.dev
// URL), set this so media is served directly from Cloudflare. Otherwise the
// server hands out short-lived signed links.
const R2_PUBLIC_BASE_URL = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');

const USE_R2 = Boolean(
  R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET && R2_ENDPOINT
);

// --- Local fallback storage ---
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const META_DIR = path.join(DATA_DIR, 'meta');

if (!USE_R2) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.mkdirSync(META_DIR, { recursive: true });
}

// --- Media helpers ---

const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp', '.tiff',
  '.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm', '.3gp', '.mts', '.wmv'
]);

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.heic': 'image/heic',
  '.heif': 'image/heif', '.bmp': 'image/bmp', '.tiff': 'image/tiff',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v',
  '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.3gp': 'video/3gpp', '.mts': 'video/mp2t', '.wmv': 'video/x-ms-wmv'
};

const VIDEO_RE = /\.(mp4|mov|m4v|avi|mkv|webm|3gp|mts|wmv)$/i;

function extOf(name) {
  return path.extname(name || '').toLowerCase();
}

function mimeOf(name) {
  return MIME_BY_EXT[extOf(name)] || 'application/octet-stream';
}

function typeOf(name, mimetype) {
  if ((mimetype && /^video\//.test(mimetype)) || VIDEO_RE.test(name || '')) {
    return 'video';
  }
  return 'image';
}

function isAllowed(name, mimetype) {
  return ALLOWED_EXTENSIONS.has(extOf(name)) || /^(image|video)\//.test(mimetype || '');
}

function makeMediaKey(originalName) {
  const ext = extOf(originalName);
  const id = crypto.randomBytes(8).toString('hex');
  return `uploads/${Date.now()}-${id}${ext}`;
}

// --- Storage backend (R2 or local disk) ---

let s3;
if (USE_R2) {
  s3 = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY
    }
  });
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Return a URL the browser can PUT a file to.
async function presignPut(key) {
  if (USE_R2) {
    return getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: R2_BUCKET, Key: key }),
      { expiresIn: 3600 }
    );
  }
  return `/api/local-put/${encodeURIComponent(key)}`;
}

// Return a URL the browser can display/download the media from.
async function mediaUrl(key, originalName) {
  if (USE_R2) {
    if (R2_PUBLIC_BASE_URL) return `${R2_PUBLIC_BASE_URL}/${key}`;
    return getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        ResponseContentType: mimeOf(originalName)
      }),
      { expiresIn: 86400 }
    );
  }
  return `/store/${key}`;
}

async function putJson(key, obj) {
  const body = JSON.stringify(obj, null, 2);
  if (USE_R2) {
    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: body,
        ContentType: 'application/json'
      })
    );
  } else {
    const full = path.join(DATA_DIR, key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const tmp = full + '.tmp';
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, full);
  }
}

async function listMetaEntries() {
  const entries = [];
  if (USE_R2) {
    let ContinuationToken;
    do {
      const out = await s3.send(
        new ListObjectsV2Command({
          Bucket: R2_BUCKET,
          Prefix: 'meta/',
          ContinuationToken
        })
      );
      for (const obj of out.Contents || []) {
        if (!obj.Key.endsWith('.json')) continue;
        const res = await s3.send(
          new GetObjectCommand({ Bucket: R2_BUCKET, Key: obj.Key })
        );
        try {
          entries.push(JSON.parse((await streamToBuffer(res.Body)).toString('utf8')));
        } catch {}
      }
      ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (ContinuationToken);
  } else {
    if (fs.existsSync(META_DIR)) {
      for (const file of fs.readdirSync(META_DIR)) {
        if (!file.endsWith('.json')) continue;
        try {
          entries.push(JSON.parse(fs.readFileSync(path.join(META_DIR, file), 'utf8')));
        } catch {}
      }
    }
  }
  return entries;
}

// Get a readable stream for a stored media object (used by download-all).
async function getMediaStream(key) {
  if (USE_R2) {
    const res = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return res.Body;
  }
  const full = path.join(DATA_DIR, key);
  if (!fs.existsSync(full)) return null;
  return fs.createReadStream(full);
}

// --- Routes ---

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
if (!USE_R2) {
  // Serve locally-stored media in fallback mode.
  app.use('/store', express.static(DATA_DIR));
}

app.get('/api/config', (req, res) => {
  let config = { siteTitle: 'In Loving Memory', personName: '', heroMessage: '' };
  try {
    config = JSON.parse(fs.readFileSync(path.join(__dirname, 'site.config.json'), 'utf8'));
  } catch {}
  config.maxFileMb = MAX_FILE_MB;
  config.storage = USE_R2 ? 'r2' : 'local';
  res.json(config);
});

// Step 1: the browser asks for upload URLs for its chosen files.
app.post('/api/presign', async (req, res) => {
  try {
    const files = Array.isArray(req.body && req.body.files) ? req.body.files : [];
    if (files.length === 0) return res.status(400).json({ error: 'No files provided.' });
    if (files.length > 20) return res.status(400).json({ error: 'Please share 20 files or fewer at a time.' });

    const results = [];
    for (const f of files) {
      const name = (f && f.name ? String(f.name) : '').slice(0, 255);
      const type = f && f.type ? String(f.type) : '';
      if (!isAllowed(name, type)) {
        return res.status(400).json({ error: `File type not supported: ${name}` });
      }
      if (Number(f && f.size) > MAX_FILE_BYTES) {
        return res.status(400).json({ error: `"${name}" is too large. The limit is ${MAX_FILE_MB} MB per file.` });
      }
      const key = makeMediaKey(name);
      results.push({ key, originalName: name, url: await presignPut(key) });
    }
    res.json({ files: results });
  } catch (err) {
    res.status(500).json({ error: 'Could not prepare the upload. Please try again.' });
  }
});

// Fallback only: receive a raw PUT and stream it to local disk.
if (!USE_R2) {
  app.put('/api/local-put/:key', (req, res) => {
    const key = decodeURIComponent(req.params.key);
    if (!key.startsWith('uploads/') || key.includes('..')) {
      return res.status(400).end();
    }
    const length = Number(req.headers['content-length'] || 0);
    if (length > MAX_FILE_BYTES) {
      return res.status(413).json({ error: `File too large. The limit is ${MAX_FILE_MB} MB per file.` });
    }
    const full = path.join(UPLOADS_DIR, path.basename(key));
    const out = fs.createWriteStream(full);
    req.pipe(out);
    out.on('finish', () => res.json({ ok: true }));
    out.on('error', () => res.status(500).json({ error: 'Save failed.' }));
  });
}

// Step 2: after the browser has uploaded the files, record who shared them.
app.post('/api/complete', async (req, res) => {
  try {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return res.status(400).json({ error: 'Nothing to record.' });

    const uploaderName =
      (body.name || 'Anonymous').toString().slice(0, 100).trim() || 'Anonymous';
    const message = (body.message || '').toString().slice(0, 2000).trim();
    const now = new Date().toISOString();

    let count = 0;
    for (const item of items) {
      const key = item && item.key ? String(item.key) : '';
      const originalName = item && item.originalName ? String(item.originalName) : 'shared-file';
      if (!key.startsWith('uploads/') || key.includes('..')) continue;
      const entry = {
        id: crypto.randomUUID(),
        key,
        filename: path.basename(key),
        originalName,
        type: typeOf(originalName, item && item.type),
        size: Number(item && item.size) || 0,
        uploaderName,
        message,
        uploadedAt: now
      };
      await putJson(`meta/${entry.id}.json`, entry);
      count++;
    }
    res.json({ ok: true, count });
  } catch (err) {
    res.status(500).json({ error: 'Could not save your memory. Please try again.' });
  }
});

app.get('/api/media', async (req, res) => {
  try {
    const entries = (await listMetaEntries()).sort((a, b) =>
      a.uploadedAt < b.uploadedAt ? 1 : -1
    );
    const withUrls = await Promise.all(
      entries.map(async (e) => ({
        id: e.id,
        type: e.type,
        uploaderName: e.uploaderName,
        message: e.message,
        uploadedAt: e.uploadedAt,
        url: await mediaUrl(e.key, e.originalName)
      }))
    );
    res.json(withUrls);
  } catch (err) {
    res.status(500).json({ error: 'Could not load the gallery.' });
  }
});

// Download every uploaded file plus a manifest, for building the memorial video.
app.get('/api/download-all', async (req, res) => {
  if ((req.query.key || '') !== ADMIN_KEY) {
    return res.status(403).send('Invalid admin key. Add ?key=YOUR_ADMIN_KEY to the URL.');
  }

  let entries;
  try {
    entries = await listMetaEntries();
  } catch {
    return res.status(500).send('Could not read the media list.');
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="memorial-media.zip"');

  const archive = archiver('zip', { zlib: { level: 1 } });
  archive.on('error', () => res.end());
  archive.pipe(res);

  const manifestLines = ['filename,original_name,type,uploader,uploaded_at,message'];
  for (const entry of entries) {
    const stream = await getMediaStream(entry.key).catch(() => null);
    if (stream) {
      const safeUploader = (entry.uploaderName || 'Anonymous').replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Anonymous';
      archive.append(stream, { name: `${safeUploader}/${entry.filename}` });
      const csvEscape = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
      manifestLines.push([
        csvEscape(entry.filename),
        csvEscape(entry.originalName),
        csvEscape(entry.type),
        csvEscape(entry.uploaderName),
        csvEscape(entry.uploadedAt),
        csvEscape(entry.message)
      ].join(','));
    }
  }
  archive.append(manifestLines.join('\n'), { name: 'manifest.csv' });
  archive.append(JSON.stringify(entries, null, 2), { name: 'manifest.json' });
  archive.finalize();
});

app.listen(PORT, () => {
  console.log(`Remembrance site running at http://localhost:${PORT}`);
  console.log(USE_R2
    ? `Storage: Cloudflare R2 (bucket "${R2_BUCKET}")`
    : 'Storage: local disk (data/ folder) — set the R2_* env vars to use Cloudflare R2.');
  if (ADMIN_KEY === 'change-me') {
    console.log('WARNING: using the default admin key. Set the ADMIN_KEY environment variable before sharing the site.');
  }
});
