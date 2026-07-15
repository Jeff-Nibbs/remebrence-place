// Builds the album's derivative images from the R2 originals.
//
// Reads meta/*.json, keeps the photos, and writes two JPEG derivatives per photo
// back to R2 (thumbs/ for the grid, display/ for the lightbox), then emits
// site/photos.json for the static frontend.
//
// Safety: this script only ever reads uploads/ and meta/. It writes nothing
// outside thumbs/ and display/. Re-running it is safe — existing derivatives
// are left alone unless --force is passed.
//
//   node tools/build-media.js [--force] [--limit N]
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const sharp = require('sharp');
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command
} = require('@aws-sdk/client-s3');

const ROOT = path.join(__dirname, '..');

// Load .env manually (project has no dotenv dependency)
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});
const Bucket = process.env.R2_BUCKET;

const FORCE = process.argv.includes('--force');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i !== -1 ? Number(process.argv[i + 1]) : Infinity;
})();

const THUMB_EDGE = 640;
const DISPLAY_EDGE = 2048;
// The old /api/download-all deadlocked by opening 359 streams against the SDK
// socket pool at once. Keep concurrency well under that.
const CONCURRENCY = 8;
const CACHE = path.join(os.tmpdir(), 'remembrance-media-cache');

async function listAll(Prefix) {
  const objects = [];
  let ContinuationToken;
  do {
    const out = await s3.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }));
    objects.push(...(out.Contents || []));
    ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return objects;
}

async function getBuffer(Key) {
  const res = await s3.send(new GetObjectCommand({ Bucket, Key }));
  return Buffer.from(await res.Body.transformToByteArray());
}

async function exists(Key) {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket, Key }));
    return head.ContentLength > 0;
  } catch {
    return false;
  }
}

// Prebuilt sharp has no HEVC decoder, so .heic originals can't be decoded
// directly. macOS `sips` can, so round-trip those through a temp JPEG.
function heicToJpeg(buf) {
  const inFile = path.join(CACHE, `heic-${process.pid}-${Math.random().toString(16).slice(2)}.heic`);
  const outFile = inFile.replace(/\.heic$/, '.jpg');
  try {
    fs.writeFileSync(inFile, buf);
    execFileSync('sips', ['-s', 'format', 'jpeg', inFile, '--out', outFile], { stdio: 'ignore' });
    return fs.readFileSync(outFile);
  } finally {
    for (const f of [inFile, outFile]) if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

async function sourceBuffer(meta) {
  const cached = path.join(CACHE, path.basename(meta.key));
  let buf;
  if (fs.existsSync(cached) && fs.statSync(cached).size > 0) {
    buf = fs.readFileSync(cached);
  } else {
    buf = await getBuffer(meta.key);
    fs.writeFileSync(cached, buf);
  }
  if (/\.(heic|heif)$/i.test(meta.key)) buf = heicToJpeg(buf);
  return buf;
}

async function processPhoto(meta) {
  const base = path.basename(meta.key).replace(/\.[^.]+$/, '');
  const thumbKey = `thumbs/${base}.jpg`;
  const displayKey = `display/${base}.jpg`;

  // Thumb dimensions drive the justified layout, so they're needed even when
  // the derivatives already exist and we skip re-uploading.
  if (!FORCE && (await exists(thumbKey)) && (await exists(displayKey))) {
    const meta2 = await sharp(await getBuffer(thumbKey)).metadata();
    return { thumb: thumbKey, full: displayKey, w: meta2.width, h: meta2.height, skipped: true };
  }

  const src = await sourceBuffer(meta);

  // .rotate() with no args bakes in EXIF orientation.
  const thumb = await sharp(src)
    .rotate()
    .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const display = await sharp(src)
    .rotate()
    .resize({ width: DISPLAY_EDGE, height: DISPLAY_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();

  await s3.send(new PutObjectCommand({
    Bucket, Key: thumbKey, Body: thumb.data,
    ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable'
  }));
  await s3.send(new PutObjectCommand({
    Bucket, Key: displayKey, Body: display,
    ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable'
  }));

  return {
    thumb: thumbKey,
    full: displayKey,
    w: thumb.info.width,
    h: thumb.info.height,
    skipped: false
  };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }));
  return results;
}

(async () => {
  fs.mkdirSync(CACHE, { recursive: true });

  console.log('Listing meta/ …');
  const metaObjects = await listAll('meta/');
  const metas = (await mapLimit(metaObjects, CONCURRENCY, async (o) => {
    try {
      return JSON.parse(await getBuffer(o.Key));
    } catch (err) {
      console.warn(`  skipping unreadable ${o.Key}: ${err.message}`);
      return null;
    }
  })).filter(Boolean);

  const photos = metas
    .filter((m) => m.type === 'image')
    .sort((a, b) => String(a.uploadedAt).localeCompare(String(b.uploadedAt)));
  const targets = photos.slice(0, LIMIT);
  console.log(`${metas.length} meta records → ${photos.length} photos (${metas.length - photos.length} non-photo excluded)`);
  console.log(`Processing ${targets.length} with concurrency ${CONCURRENCY}${FORCE ? ' (--force)' : ''} …`);

  let done = 0, made = 0, skipped = 0;
  const failed = [];
  const entries = await mapLimit(targets, CONCURRENCY, async (meta) => {
    try {
      const entry = await processPhoto(meta);
      done++;
      if (entry.skipped) skipped++; else made++;
      if (done % 25 === 0 || done === targets.length) {
        console.log(`  [${done}/${targets.length}] ${made} generated, ${skipped} already present`);
      }
      return entry;
    } catch (err) {
      failed.push({ key: meta.key, error: String(err.message || err) });
      console.warn(`  FAILED ${meta.key}: ${err.message || err}`);
      return null;
    }
  });

  const ok = entries.filter(Boolean).map(({ thumb, full, w, h }) => ({ thumb, full, w, h }));
  const contributors = [...new Set(
    metas.filter((m) => m.type === 'image').map((m) => (m.uploaderName || '').trim()).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));

  const outPath = path.join(ROOT, 'site', 'photos.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ count: ok.length, contributors, photos: ok }, null, 2) + '\n');

  console.log(`\nWrote ${path.relative(ROOT, outPath)} — ${ok.length} photos, ${contributors.length} contributors.`);
  if (failed.length) {
    console.log(`${failed.length} failed:`);
    for (const f of failed) console.log(`  ${f.key}: ${f.error}`);
    process.exit(1);
  }
})().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
