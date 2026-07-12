// Generates the PWA icons from an inline SVG snail. Run once (or after
// tweaking the art) and commit the PNGs: node scripts/make-icons.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Content is scaled to ~82% so the same art works as a maskable icon
// (Android's safe zone) and looks right with iOS's corner rounding.
const svg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#2b6cb0"/>
  <g transform="translate(256 256) scale(0.82) translate(-256 -256)">
    <rect x="104" y="308" width="310" height="46" rx="23" fill="#f8f7f4"/>
    <circle cx="127" cy="298" r="36" fill="#f8f7f4"/>
    <path d="M116 270 L102 236" stroke="#f8f7f4" stroke-width="11" stroke-linecap="round"/>
    <path d="M140 268 L152 234" stroke="#f8f7f4" stroke-width="11" stroke-linecap="round"/>
    <circle cx="100" cy="230" r="10" fill="#f8f7f4"/>
    <circle cx="154" cy="228" r="10" fill="#f8f7f4"/>
    <circle cx="300" cy="240" r="118" fill="#f8f7f4"/>
    <path d="M300 240 a20 20 0 0 1 40 0 a40 40 0 0 1 -80 0 a60 60 0 0 1 120 0 a80 80 0 0 1 -160 0"
          fill="none" stroke="#2b6cb0" stroke-width="17" stroke-linecap="round"/>
  </g>
</svg>`);

const out = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });

Promise.all([
  sharp(svg).resize(512, 512).png().toFile(path.join(out, 'icon-512.png')),
  sharp(svg).resize(192, 192).png().toFile(path.join(out, 'icon-192.png')),
  sharp(svg).resize(180, 180).png().toFile(path.join(out, 'apple-touch-icon.png'))
]).then(() => console.log('icons written to public/icons/'));
