(function () {
  'use strict';

  var MEDIA_BASE = String(window.MEDIA_BASE || '').replace(/\/+$/, '');

  var album = document.getElementById('album');
  var thanksEl = document.getElementById('thanks');
  var toTop = document.getElementById('toTop');
  var lightbox = document.getElementById('lightbox');
  var lbImage = document.getElementById('lbImage');
  var lbCount = document.getElementById('lbCount');

  var photos = [];
  var index = 0;

  function url(key) {
    return MEDIA_BASE + '/' + key;
  }

  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  /* ---------- Grid ---------- */

  function buildGrid() {
    var frag = document.createDocumentFragment();

    photos.forEach(function (photo, i) {
      var ratio = (photo.w && photo.h) ? photo.w / photo.h : 1;

      var tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tile';
      tile.setAttribute('aria-label', 'Open photo ' + (i + 1) + ' of ' + photos.length);
      // Row height comes from --row; growing in proportion to the aspect ratio
      // is what squares up the right edge of each row.
      tile.style.flexGrow = String(ratio * 100);
      tile.style.flexBasis = 'calc(' + ratio.toFixed(4) + ' * var(--row))';

      var img = document.createElement('img');
      img.src = url(photo.thumb);
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.width = photo.w || 0;
      img.height = photo.h || 0;
      if (img.complete) {
        img.classList.add('loaded');
      } else {
        img.addEventListener('load', function () { img.classList.add('loaded'); }, { once: true });
      }

      tile.appendChild(img);
      tile.addEventListener('click', function () { open(i); });
      frag.appendChild(tile);
    });

    // Zero-height spacers soak up the leftover space on the final row so its
    // tiles keep their natural width instead of stretching across the page.
    for (var s = 0; s < 10; s++) {
      var spacer = document.createElement('span');
      spacer.className = 'spacer';
      spacer.style.flexBasis = 'calc(1.5 * var(--row))';
      frag.appendChild(spacer);
    }

    album.appendChild(frag);
  }

  /* ---------- Lightbox ---------- */

  function preload(i) {
    if (i < 0 || i >= photos.length) return;
    var img = new Image();
    img.src = url(photos[i].full);
  }

  function show(i) {
    index = (i + photos.length) % photos.length;
    lbImage.classList.remove('ready');
    lbImage.src = url(photos[index].full);
    if (lbImage.complete) lbImage.classList.add('ready');
    lbCount.textContent = (index + 1) + ' / ' + photos.length;
    preload(index + 1);
    preload(index - 1);
  }

  function open(i) {
    lightbox.hidden = false;
    document.body.classList.add('lb-open');
    // Let the element paint hidden-free before transitioning opacity in.
    requestAnimationFrame(function () { lightbox.classList.add('open'); });
    show(i);
  }

  function close() {
    lightbox.classList.remove('open');
    document.body.classList.remove('lb-open');
    var done = function () {
      lightbox.hidden = true;
      lbImage.removeAttribute('src');
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) done();
    else setTimeout(done, 200);
  }

  function isOpen() {
    return !lightbox.hidden;
  }

  lbImage.addEventListener('load', function () { lbImage.classList.add('ready'); });

  lightbox.querySelector('.lb-close').addEventListener('click', close);
  lightbox.querySelector('.lb-prev').addEventListener('click', function () { show(index - 1); });
  lightbox.querySelector('.lb-next').addEventListener('click', function () { show(index + 1); });

  // A click that lands on the backdrop (not a control or the photo) closes.
  lightbox.addEventListener('click', function (e) {
    if (e.target === lightbox || e.target.classList.contains('lb-stage')) close();
  });

  document.addEventListener('keydown', function (e) {
    if (!isOpen()) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') show(index - 1);
    else if (e.key === 'ArrowRight') show(index + 1);
  });

  var touchX = null;
  var touchY = null;
  lightbox.addEventListener('touchstart', function (e) {
    touchX = e.changedTouches[0].clientX;
    touchY = e.changedTouches[0].clientY;
  }, { passive: true });

  lightbox.addEventListener('touchend', function (e) {
    if (touchX === null) return;
    var dx = e.changedTouches[0].clientX - touchX;
    var dy = e.changedTouches[0].clientY - touchY;
    // Horizontal intent only — ignore mostly-vertical drags.
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) show(index + (dx < 0 ? 1 : -1));
    touchX = null;
    touchY = null;
  }, { passive: true });

  /* ---------- Back to top ---------- */

  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var show = window.scrollY > window.innerHeight * 2;
      if (show) {
        toTop.hidden = false;
        toTop.classList.add('show');
      } else {
        toTop.classList.remove('show');
      }
      ticking = false;
    });
  }, { passive: true });

  toTop.addEventListener('transitionend', function () {
    if (!toTop.classList.contains('show')) toTop.hidden = true;
  });

  toTop.addEventListener('click', function () {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  });

  /* ---------- Boot ---------- */

  fetch('photos.json')
    .then(function (r) {
      if (!r.ok) throw new Error('photos.json ' + r.status);
      return r.json();
    })
    .then(function (data) {
      photos = shuffle((data.photos || []).slice());
      buildGrid();

      var names = data.contributors || [];
      if (names.length) {
        var list = names.length > 1
          ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
          : names[0];
        thanksEl.textContent = 'With love and thanks to everyone who shared their memories: ' + list + '.';
      }
    })
    .catch(function (err) {
      album.innerHTML = '<p class="notice">The photos could not be loaded just now. Please try again in a moment.</p>';
      console.error(err);
    });
})();
