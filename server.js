const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';
const MAX_FILE_MB = parseInt(process.env.MAX_FILE_MB || '500', 10);

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const METADATA_FILE = path.join(DATA_DIR, 'metadata.json');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(METADATA_FILE)) {
  fs.writeFileSync(METADATA_FILE, '[]');
}

function readMetadata() {
  try {
    return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeMetadata(entries) {
  const tmp = METADATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2));
  fs.renameSync(tmp, METADATA_FILE);
}

// --- Upload handling ---

const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp', '.tiff',
  '.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm', '.3gp', '.mts', '.wmv'
]);

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const id = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}-${id}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const isMediaMime = /^(image|video)\//.test(file.mimetype);
    if (ALLOWED_EXTENSIONS.has(ext) || isMediaMime) {
      cb(null, true);
    } else {
      cb(new Error(`File type not supported: ${file.originalname}`));
    }
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(UPLOADS_DIR));

app.get('/api/config', (req, res) => {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'site.config.json'), 'utf8'));
    res.json(config);
  } catch {
    res.json({ siteTitle: 'In Loving Memory', personName: '', heroMessage: '' });
  }
});

app.post('/api/upload', (req, res) => {
  upload.array('files')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? `A file was too large. The limit is ${MAX_FILE_MB} MB per file.`
        : err.message;
      return res.status(400).json({ error: message });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files were uploaded.' });
    }

    const uploaderName = (req.body.name || 'Anonymous').toString().slice(0, 100).trim() || 'Anonymous';
    const message = (req.body.message || '').toString().slice(0, 2000).trim();

    const entries = readMetadata();
    const now = new Date().toISOString();
    const added = req.files.map((file) => ({
      id: crypto.randomUUID(),
      filename: file.filename,
      originalName: file.originalname,
      type: /^video\//.test(file.mimetype) || /\.(mp4|mov|m4v|avi|mkv|webm|3gp|mts|wmv)$/i.test(file.originalname)
        ? 'video'
        : 'image',
      size: file.size,
      uploaderName,
      message,
      uploadedAt: now
    }));
    entries.push(...added);
    writeMetadata(entries);

    res.json({ ok: true, count: added.length });
  });
});

app.get('/api/media', (req, res) => {
  const entries = readMetadata()
    .slice()
    .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
  res.json(entries);
});

// Download every uploaded file plus a manifest, for building the memorial video.
app.get('/api/download-all', (req, res) => {
  if ((req.query.key || '') !== ADMIN_KEY) {
    return res.status(403).send('Invalid admin key. Add ?key=YOUR_ADMIN_KEY to the URL.');
  }

  const entries = readMetadata();
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="memorial-media.zip"');

  const archive = archiver('zip', { zlib: { level: 1 } });
  archive.on('error', () => res.end());
  archive.pipe(res);

  const manifestLines = ['filename,original_name,type,uploader,uploaded_at,message'];
  for (const entry of entries) {
    const filePath = path.join(UPLOADS_DIR, path.basename(entry.filename));
    if (fs.existsSync(filePath)) {
      const safeUploader = entry.uploaderName.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Anonymous';
      archive.file(filePath, { name: `${safeUploader}/${entry.filename}` });
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
  if (ADMIN_KEY === 'change-me') {
    console.log('WARNING: using the default admin key. Set the ADMIN_KEY environment variable before sharing the site.');
  }
});
