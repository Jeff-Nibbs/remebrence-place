/* Remembrance site frontend */

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const fileList = document.getElementById('file-list');
const form = document.getElementById('upload-form');
const submitBtn = document.getElementById('submit-btn');
const formStatus = document.getElementById('form-status');
const progressWrap = document.getElementById('progress-wrap');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');

let selectedFiles = [];

// ---- Site config ----

fetch('/api/config')
  .then((r) => r.json())
  .then((config) => {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el && value) el.textContent = value;
    };
    set('site-title', config.siteTitle);
    set('person-name', config.personName);
    set('hero-message', config.heroMessage);
    set('upload-prompt', config.uploadPrompt);
    set('footer-message', config.footerMessage);
    if (config.birthDate && config.passedDate) {
      set('person-dates', `${config.birthDate} — ${config.passedDate}`);
    }
    if (config.personName) {
      document.title = `${config.siteTitle || 'In Loving Memory'} · ${config.personName}`;
    }
  })
  .catch(() => {});

// ---- File selection ----

function formatSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

function renderFileList() {
  fileList.innerHTML = '';
  selectedFiles.forEach((file, index) => {
    const li = document.createElement('li');

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = file.name;

    const size = document.createElement('span');
    size.className = 'file-size';
    size.textContent = formatSize(file.size);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${file.name}`);
    remove.textContent = '✕';
    remove.addEventListener('click', () => {
      selectedFiles.splice(index, 1);
      renderFileList();
    });

    li.append(name, size, remove);
    fileList.appendChild(li);
  });
  submitBtn.disabled = selectedFiles.length === 0;
}

function addFiles(files) {
  for (const file of files) {
    const isMedia = /^(image|video)\//.test(file.type) ||
      /\.(heic|heif|mov|mp4|m4v|avi|mkv|webm|3gp|mts|wmv|jpe?g|png|gif|webp|bmp|tiff)$/i.test(file.name);
    if (!isMedia) {
      setStatus(`"${file.name}" doesn't look like a photo or video, so it was skipped.`, 'error');
      continue;
    }
    const duplicate = selectedFiles.some((f) => f.name === file.name && f.size === file.size);
    if (!duplicate) selectedFiles.push(file);
  }
  renderFileList();
}

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});

['dragenter', 'dragover'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  })
);
dropzone.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

// ---- Upload ----

function setStatus(message, kind) {
  formStatus.textContent = message;
  formStatus.className = 'form-status' + (kind ? ' ' + kind : '');
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (selectedFiles.length === 0) return;

  const formData = new FormData();
  formData.append('name', document.getElementById('uploader-name').value);
  formData.append('message', document.getElementById('uploader-message').value);
  selectedFiles.forEach((file) => formData.append('files', file));

  submitBtn.disabled = true;
  progressWrap.hidden = false;
  setStatus('');

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');

  xhr.upload.addEventListener('progress', (event) => {
    if (event.lengthComputable) {
      const pct = Math.round((event.loaded / event.total) * 100);
      progressFill.style.width = pct + '%';
      progressText.textContent = pct < 100 ? `Uploading… ${pct}%` : 'Finishing up…';
    }
  });

  xhr.addEventListener('load', () => {
    progressWrap.hidden = true;
    progressFill.style.width = '0%';
    if (xhr.status >= 200 && xhr.status < 300) {
      const count = selectedFiles.length;
      selectedFiles = [];
      renderFileList();
      document.getElementById('uploader-message').value = '';
      setStatus(
        count === 1
          ? 'Thank you — your memory has been shared. ♥'
          : `Thank you — ${count} memories have been shared. ♥`,
        'success'
      );
      loadGallery();
    } else {
      let message = 'Something went wrong. Please try again.';
      try {
        message = JSON.parse(xhr.responseText).error || message;
      } catch {}
      setStatus(message, 'error');
      submitBtn.disabled = false;
    }
  });

  xhr.addEventListener('error', () => {
    progressWrap.hidden = true;
    setStatus('Upload failed — please check your connection and try again.', 'error');
    submitBtn.disabled = false;
  });

  xhr.send(formData);
});

// ---- Gallery ----

function loadGallery() {
  fetch('/api/media')
    .then((r) => r.json())
    .then((entries) => {
      const gallery = document.getElementById('gallery');
      const empty = document.getElementById('gallery-empty');
      const count = document.getElementById('gallery-count');
      gallery.innerHTML = '';
      empty.hidden = entries.length > 0;
      count.textContent = entries.length > 0
        ? `${entries.length} ${entries.length === 1 ? 'memory' : 'memories'} shared so far`
        : '';

      for (const entry of entries) {
        const card = document.createElement('div');
        card.className = 'memory-card';

        let media;
        if (entry.type === 'video') {
          media = document.createElement('video');
          media.controls = true;
          media.preload = 'metadata';
          media.src = `/media/${encodeURIComponent(entry.filename)}`;
        } else {
          media = document.createElement('img');
          media.loading = 'lazy';
          media.alt = entry.message || `Photo shared by ${entry.uploaderName}`;
          media.src = `/media/${encodeURIComponent(entry.filename)}`;
        }

        const info = document.createElement('div');
        info.className = 'memory-info';

        const name = document.createElement('p');
        name.className = 'memory-name';
        name.textContent = `Shared by ${entry.uploaderName}`;

        info.appendChild(name);

        if (entry.message) {
          const msg = document.createElement('p');
          msg.className = 'memory-message';
          msg.textContent = `“${entry.message}”`;
          info.appendChild(msg);
        }

        const date = document.createElement('p');
        date.className = 'memory-date';
        date.textContent = new Date(entry.uploadedAt).toLocaleDateString(undefined, {
          year: 'numeric', month: 'long', day: 'numeric'
        });
        info.appendChild(date);

        card.append(media, info);
        gallery.appendChild(card);
      }
    })
    .catch(() => {});
}

loadGallery();
