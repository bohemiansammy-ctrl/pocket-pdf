// Makes the three home-screen icons from icons/logo.svg.
//
//   node tools/make-icons.js
//
// Writes icons/icon-192.png, icons/icon-512.png (rounded tile, clear corners)
// and icons/icon-maskable-512.png (square corners; Android cuts its own shape).
// Needs only Node and Chrome or Edge, which it runs hidden in the background.
// To use a specific browser, set CHROME_PATH to its .exe first.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const iconsDir = path.join(__dirname, '..', 'icons');
const svg = fs.readFileSync(path.join(iconsDir, 'logo.svg'), 'utf8');

if (!/<rect id="tile"[^>]*rx="\d+"/.test(svg)) {
  fail('icons/logo.svg needs a <rect id="tile" ... rx="..."> for the rounded tile.');
}

const browser = findBrowser();
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-icons-'));

try {
  const square = svg.replace(/(<rect id="tile"[^>]*?)rx="\d+"/, '$1rx="0"');
  render(svg, 192, 'icon-192.png');
  render(svg, 512, 'icon-512.png');
  render(square, 512, 'icon-maskable-512.png');
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

function render(svgText, size, name) {
  const page = path.join(work, name + '.html');
  const shot = path.join(work, name);
  fs.writeFileSync(page,
    '<!doctype html><html><body style="margin:0;background:transparent">' +
    `<img width="${size}" height="${size}" style="display:block" src="data:image/svg+xml;base64,` +
    Buffer.from(svgText).toString('base64') + '"></body></html>');

  execFileSync(browser, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    `--window-size=${size},${size}`,
    `--user-data-dir=${path.join(work, 'profile')}`,
    `--screenshot=${shot}`,
    'file:///' + page.replace(/\\/g, '/'),
  ], { stdio: 'ignore', timeout: 60000 });

  if (!fs.existsSync(shot)) fail(`The browser didn't produce ${name}.`);
  fs.copyFileSync(shot, path.join(iconsDir, name));
  console.log(`made icons/${name} (${fs.statSync(shot).size} bytes)`);
}

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) fail('Could not find Chrome or Edge. Set CHROME_PATH to the browser .exe and try again.');
  return found;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
