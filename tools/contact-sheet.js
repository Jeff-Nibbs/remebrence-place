// Builds a local contact sheet (contact-sheet.html) for picking the featured
// portrait. Local-only — never committed, never published.
//
// Portrait-orientation photos are floated to the top as likely candidates.
//   node tools/contact-sheet.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const sharp = require('sharp');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const ROOT = path.join(__dirname, '..');
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
const OUT = path.join(ROOT, 'contact-sheet');
const CACHE = path.join(os.tmpdir(), 'remembrance-media-cache');

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const n = i++;
      out[n] = await fn(items[n], n);
    }
  }));
  return out;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'photos.json'), 'utf8'));
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(CACHE, { recursive: true });

  console.log(`Building contact sheet for ${data.photos.length} photos …`);

  const items = await mapLimit(data.photos, 8, async (p) => {
    const base = path.basename(p.thumb);
    const local = path.join(OUT, base);
    if (!fs.existsSync(local)) {
      const res = await s3.send(new GetObjectCommand({ Bucket, Key: p.thumb }));
      fs.writeFileSync(local, Buffer.from(await res.Body.transformToByteArray()));
    }
    return { file: base, w: p.w, h: p.h, portrait: p.h > p.w, full: p.full };
  });

  const portraits = items.filter((i) => i.portrait);
  const rest = items.filter((i) => !i.portrait);
  const ordered = portraits.concat(rest);

  const cell = (it, n) => `
    <figure>
      <img src="contact-sheet/${it.file}" loading="lazy" alt="">
      <figcaption>#${n + 1} &middot; ${it.file}${it.portrait ? ' &middot; portrait' : ''}</figcaption>
    </figure>`;

  const html = `<!DOCTYPE html><meta charset="utf-8">
<title>Portrait candidates — contact sheet</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 2rem; background: #fafafa; color: #24252a; }
  h1 { font-weight: 500; }
  p.note { color: #6b6d76; max-width: 40rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1rem; }
  figure { margin: 0; background: #fff; padding: .5rem; border: 1px solid #e9e9ec; border-radius: 4px; }
  img { width: 100%; height: 200px; object-fit: contain; background: #f2f2f4; display: block; }
  figcaption { font-size: .7rem; color: #6b6d76; margin-top: .4rem; word-break: break-all; }
  h2 { margin-top: 3rem; font-weight: 500; border-top: 1px solid #e9e9ec; padding-top: 1.5rem; }
</style>
<h1>Portrait candidates</h1>
<p class="note">Tell Claude the <strong>#number</strong> of the photo to use as the featured portrait
in the site header. Portrait-orientation photos (${portraits.length}) come first as likely candidates,
then the rest (${rest.length}).</p>
<h2>Portrait orientation (${portraits.length})</h2>
<div class="grid">${portraits.map((it, n) => cell(it, n)).join('')}</div>
<h2>Everything else (${rest.length})</h2>
<div class="grid">${rest.map((it, n) => cell(it, n + portraits.length)).join('')}</div>
`;

  fs.writeFileSync(path.join(ROOT, 'contact-sheet.html'), html);
  fs.writeFileSync(path.join(OUT, '_order.json'), JSON.stringify(ordered, null, 2));
  console.log(`Wrote contact-sheet.html — ${portraits.length} portrait, ${rest.length} other.`);
  console.log('Open it with: open contact-sheet.html');
})().catch((e) => { console.error('Fatal:', e); process.exit(1); });
