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
