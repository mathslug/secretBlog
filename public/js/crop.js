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

  function cropRect() {
    var s = scale();
    return {
      x: Math.round(-ox / s),
      y: Math.round(-oy / s),
      size: Math.round(stageSize() / s)
    };
  }

  function writeCrop() {
    var r = cropRect();
    form.elements.cropX.value = r.x;
    form.elements.cropY.value = r.y;
    form.elements.cropSize.value = r.size;
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
    processed = false;
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

  // On submit, render the chosen square to a canvas and upload that instead
  // of the original file: a ~1080px JPEG is 20-30x smaller than a 12MP
  // photo, which on a slow connection is the difference between posting in
  // a second and hanging (or being killed) mid-upload. If anything in this
  // path fails, the original file plus crop coordinates go up unchanged and
  // the server crops and resizes exactly as before. Canvas re-encoding
  // bakes in the EXIF orientation, matching how the coordinates were chosen.
  var processed = false;

  // Halve in steps before the final draw; a single large downscale
  // aliases badly in some browsers.
  function renderCrop(r, out) {
    var src = img, sx = r.x, sy = r.y, s = r.size;
    while (s > out * 2) {
      var half = Math.round(s / 2);
      var c = document.createElement('canvas');
      c.width = c.height = half;
      var ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, sx, sy, s, s, 0, 0, half, half);
      src = c; sx = 0; sy = 0; s = half;
    }
    var final = document.createElement('canvas');
    final.width = final.height = out;
    var fctx = final.getContext('2d');
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(src, sx, sy, s, s, 0, 0, out, out);
    return final;
  }

  form.addEventListener('submit', function (e) {
    if (processed) return; // second pass: upload whatever is in the input now
    var file = input.files && input.files[0];
    if (!nw || !file) return;
    writeCrop();
    if (typeof DataTransfer === 'undefined' || !form.requestSubmit) return;
    e.preventDefault();

    function resubmit() {
      processed = true;
      form.requestSubmit();
    }

    try {
      var r = cropRect();
      var out = Math.min(Number(form.dataset.imageSize) || 1080, r.size);
      renderCrop(r, out).toBlob(function (blob) {
        try {
          if (blob && blob.size < file.size) {
            var dt = new DataTransfer();
            dt.items.add(new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
            input.files = dt.files;
            // The upload now IS the chosen square.
            form.elements.cropX.value = '0';
            form.elements.cropY.value = '0';
            form.elements.cropSize.value = String(out);
          }
        } catch (err) { /* keep the original file */ }
        resubmit();
      }, 'image/jpeg', 0.85);
    } catch (err) {
      resubmit();
    }
  });
})();
