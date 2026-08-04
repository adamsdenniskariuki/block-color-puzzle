// Regenerates qr.png / qr.svg pointing at the live site.
//
// Unlike the rest of this project this script needs one dev-only package:
//   npm install --no-save qrcode
//   node tools/make-qr.js
//
// The generated images are committed, so you only need this when the URL changes.

const path = require('path');

const URL = process.argv[2] || 'https://adamsdenniskariuki.github.io/block-color-puzzle/';
const root = path.join(__dirname, '..');

let QR;
try {
  QR = require('qrcode');
} catch {
  console.error('Missing dependency. Run: npm install --no-save qrcode');
  process.exit(1);
}

const style = {
  margin: 2,
  errorCorrectionLevel: 'M',
  color: { dark: '#12161c', light: '#ffffff' },
};

(async () => {
  await QR.toFile(path.join(root, 'qr.png'), URL, { ...style, width: 640 });
  await QR.toFile(path.join(root, 'qr.svg'), URL, { ...style, type: 'svg' });
  console.log(await QR.toString(URL, { type: 'terminal', small: true }));
  console.log('Wrote qr.png and qr.svg for ' + URL);
})();
