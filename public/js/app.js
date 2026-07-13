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
  }
});

// Typing in the friends search narrows the Everyone list.
var friendFilter = document.getElementById('friend-filter');
if (friendFilter) {
  friendFilter.addEventListener('input', function () {
    var q = friendFilter.value.trim().toLowerCase().replace(/^@/, '');
    document.querySelectorAll('#directory .friend-row').forEach(function (row) {
      row.classList.toggle('hidden', q !== '' && row.dataset.username.indexOf(q) === -1);
    });
  });
}

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
