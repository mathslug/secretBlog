// Square crop picker: pan by dragging, zoom with the slider or scroll wheel.
// Reports the chosen square back as pixel coordinates in the image's natural
// (EXIF-oriented) coordinate space via hidden form fields; the server does
// the actual cropping from the original file, so no quality is lost here.
(function () {
  var input = document.getElementById('photo-input');
  var wrap = document.getElementById('crop-wrap');
  var stage = document.getElementById('crop-stage');
  var img = document.getElementById('crop-img');
  var zoom = document.getElementById('zoom');
  var form = document.getElementById('photo-form');
  if (!input || !form) return;

  var nw = 0, nh = 0;      // natural size
  var ox = 0, oy = 0;      // image top-left relative to stage
  var z = 1;               // zoom factor (1 = square exactly covered)
  var objectUrl = null;

  function stageSize() { return stage.clientWidth; }
  function baseScale() { return stageSize() / Math.min(nw, nh); }
  function scale() { return baseScale() * z; }

  function clamp() {
    var S = stageSize();
    var s = scale();
    ox = Math.min(0, Math.max(S - nw * s, ox));
    oy = Math.min(0, Math.max(S - nh * s, oy));
  }

  function render() {
    var s = scale();
    img.style.width = nw * s + 'px';
    img.style.height = nh * s + 'px';
    img.style.transform = 'translate(' + ox + 'px,' + oy + 'px)';
    writeCrop();
  }

  function writeCrop() {
    var s = scale();
    form.elements.cropX.value = Math.round(-ox / s);
    form.elements.cropY.value = Math.round(-oy / s);
    form.elements.cropSize.value = Math.round(stageSize() / s);
  }

  function center() {
    var S = stageSize();
    var s = scale();
    ox = (S - nw * s) / 2;
    oy = (S - nh * s) / 2;
    render();
  }

  input.addEventListener('change', function () {
    var file = input.files && input.files[0];
    if (!file) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    img.onload = function () {
      nw = img.naturalWidth;
      nh = img.naturalHeight;
      z = 1;
      zoom.value = '1';
      wrap.classList.remove('hidden');
      center();
    };
    img.onerror = function () {
      wrap.classList.add('hidden');
      // Server-side center-crop fallback still applies.
      form.elements.cropX.value = '';
      form.elements.cropY.value = '';
      form.elements.cropSize.value = '';
    };
    img.src = objectUrl;
  });

  function setZoom(nz, cx, cy) {
    if (!nw) return;
    nz = Math.min(3, Math.max(1, nz));
    var s = scale();
    // Keep the point under (cx, cy) fixed while zooming.
    var px = (cx - ox) / s;
    var py = (cy - oy) / s;
    z = nz;
    var s2 = scale();
    ox = cx - px * s2;
    oy = cy - py * s2;
    clamp();
    render();
    zoom.value = String(z);
  }

  zoom.addEventListener('input', function () {
    var S = stageSize() / 2;
    setZoom(parseFloat(zoom.value), S, S);
  });

  stage.addEventListener('wheel', function (e) {
    e.preventDefault();
    var rect = stage.getBoundingClientRect();
    setZoom(z * (e.deltaY < 0 ? 1.05 : 0.95), e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  var dragging = false, lastX = 0, lastY = 0;
  stage.addEventListener('pointerdown', function (e) {
    if (!nw) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    ox += e.clientX - lastX;
    oy += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    clamp();
    render();
  });
  stage.addEventListener('pointerup', function () { dragging = false; });
  stage.addEventListener('pointercancel', function () { dragging = false; });

  form.addEventListener('submit', function () {
    if (nw) writeCrop();
  });
})();
