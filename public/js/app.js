// Progressive enhancement for the feed and composer. Everything here has a
// no-JS fallback (toggles link to the post permalink).
document.addEventListener('click', function (e) {
  var essayToggle = e.target.closest('.essay-toggle');
  if (essayToggle) {
    e.preventDefault();
    var essay = essayToggle.closest('.essay');
    var collapsed = essay.classList.toggle('collapsed');
    essayToggle.textContent = collapsed
      ? essayToggle.dataset.more
      : essayToggle.dataset.less;
    return;
  }

  var commentsToggle = e.target.closest('.comments-toggle');
  if (commentsToggle) {
    e.preventDefault();
    var box = commentsToggle.closest('.comments');
    box.querySelectorAll('.hidden-comment').forEach(function (el) {
      el.classList.remove('hidden-comment');
    });
    commentsToggle.remove();
    return;
  }

  var tab = e.target.closest('.tab');
  if (tab) {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t === tab);
    });
    var photoForm = document.getElementById('photo-form');
    var essayForm = document.getElementById('essay-form');
    if (photoForm) photoForm.classList.toggle('hidden', tab.dataset.tab !== 'photo');
    if (essayForm) essayForm.classList.toggle('hidden', tab.dataset.tab !== 'essay');
    var skipType = document.getElementById('skip-type');
    if (skipType) skipType.value = tab.dataset.tab === 'essay' ? 'essay' : 'photo';
  }
});

// Live character counters for textareas with data-count="<span id>".
document.querySelectorAll('textarea[data-count]').forEach(function (ta) {
  var span = document.getElementById(ta.dataset.count);
  if (!span) return;
  var update = function () {
    span.textContent = ta.value.length.toLocaleString();
    var over = ta.maxLength > 0 && ta.value.length >= ta.maxLength;
    var under = ta.minLength > 0 && ta.value.length < ta.minLength;
    span.classList.toggle('over', over || under);
  };
  ta.addEventListener('input', update);
  update();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

// Posting feedback. Submitting a post is a full-page navigation that uploads
// the original photo, which on a slow connection can take a long time with
// nothing on screen changing — so show a spinning snail and disable the
// button until the server responds. Duplicate submits are also rejected
// server-side (one post per day), so re-enabling after a stall is safe.
(function () {
  var timer = null;

  function reset() {
    clearTimeout(timer);
    timer = null;
    var el = document.getElementById('posting');
    if (el) el.remove();
    document.querySelectorAll('form[data-busy]').forEach(function (f) {
      delete f.dataset.busy;
      var btn = f.querySelector('button.primary');
      if (btn) {
        btn.disabled = false;
        if (btn.dataset.label) btn.textContent = btn.dataset.label;
      }
    });
  }

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (e.defaultPrevented || !/^(photo|essay)-form$/.test(form.id)) return;
    if (form.dataset.busy) { e.preventDefault(); return; }
    form.dataset.busy = '1';

    var btn = form.querySelector('button.primary');
    if (btn) {
      btn.dataset.label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Posting…';
    }

    var hasPhoto = form.elements.photo && form.elements.photo.files.length > 0;
    var el = document.createElement('div');
    el.id = 'posting';
    el.innerHTML = '<div class="snail">🐌</div><p></p>';
    el.querySelector('p').textContent = hasPhoto
      ? 'Posting… photos can take a while on a slow connection.'
      : 'Posting…';
    document.body.appendChild(el);

    // If nothing has happened after 75s the upload has probably stalled;
    // give the button back so the user can retry.
    timer = setTimeout(function () {
      reset();
      var note = document.createElement('p');
      note.className = 'flash error';
      note.textContent = 'This is taking a while — check your connection and try Post again.';
      form.insertBefore(note, form.firstChild);
    }, 75000);
  });

  // Navigating back restores this page from the back/forward cache with the
  // busy state still set; pageshow fires on those restores where load doesn't.
  window.addEventListener('pageshow', reset);
})();

// Pull-to-refresh for the installed app. Browsers have their own; standalone
// PWAs (notably on iOS) don't, so pulling down from the top reloads the page.
(function () {
  var standalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  if (!standalone) return;

  var THRESHOLD = 70;
  var startY = null;
  var snail = null;

  function getSnail() {
    if (!snail) {
      snail = document.createElement('div');
      snail.id = 'ptr';
      snail.textContent = '🐌';
      document.body.appendChild(snail);
    }
    return snail;
  }

  function reset() {
    startY = null;
    if (snail) {
      snail.classList.remove('ready');
      snail.style.opacity = '';
      snail.style.transform = '';
    }
  }

  document.addEventListener('touchstart', function (e) {
    var top = (document.scrollingElement || document.documentElement).scrollTop;
    startY = top <= 0 && e.touches.length === 1
      && !e.target.closest('#crop-stage, textarea, input')
      ? e.touches[0].clientY : null;
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (startY === null) return;
    var pull = (e.touches[0].clientY - startY) / 2.5;
    if (pull <= 0) { reset(); return; }
    var el = getSnail();
    var ready = pull >= THRESHOLD;
    el.style.opacity = Math.min(pull / THRESHOLD, 1);
    el.style.transform = 'translate(-50%, ' + Math.min(pull, THRESHOLD + 20) + 'px)'
      + (ready ? ' scale(1.3)' : '');
    el.classList.toggle('ready', ready);
  }, { passive: true });

  document.addEventListener('touchend', function () {
    if (snail && snail.classList.contains('ready')) {
      snail.classList.remove('ready');
      snail.classList.add('refreshing');
      snail.style.opacity = '';
      snail.style.transform = '';
      location.reload();
    } else {
      reset();
    }
  }, { passive: true });

  document.addEventListener('touchcancel', reset, { passive: true });
})();

// Home-screen install nudge (rendered on /new once you've posted today).
// Chromium fires beforeinstallprompt, letting a button trigger the real
// install dialog; iOS has no API, so it gets Share-menu instructions.
var deferredInstall = null;

function updateInstallNudge() {
  var nudge = document.getElementById('install-nudge');
  if (!nudge) return;
  var standalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  if (standalone) {
    nudge.classList.add('hidden');
    return;
  }
  var isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  nudge.classList.remove('hidden');
  document.getElementById('install-btn').classList.toggle('hidden', !deferredInstall);
  document.getElementById('install-ios').classList.toggle('hidden', !!deferredInstall || !isIos);
  document.getElementById('install-generic').classList.toggle('hidden', !!deferredInstall || isIos);
}

window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  deferredInstall = e;
  updateInstallNudge();
});

window.addEventListener('appinstalled', function () {
  deferredInstall = null;
  var nudge = document.getElementById('install-nudge');
  if (nudge) nudge.classList.add('hidden');
});

document.addEventListener('click', function (e) {
  if (e.target.id === 'install-btn' && deferredInstall) {
    deferredInstall.prompt();
    deferredInstall = null;
  }
});

updateInstallNudge();
