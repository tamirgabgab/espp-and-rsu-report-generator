'use strict';
/*
 * Renders the app icons in assets/icons/ from assets/icons/icon.svg.
 * Run: node tools/make_icons.js   (needs Playwright with Chromium)
 *
 * - icon-192 / icon-512: rounded square, as drawn.
 * - icon-maskable-512: full-bleed square, drawing shrunk to 84% so it stays inside the circular safe zone
 *   (Android crops it to a circle or squircle).
 * - apple-touch-icon (180): full-bleed square (iOS rounds the corners itself).
 * - favicon-32: rounded square, as drawn.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIR = path.join(__dirname, '..', 'assets', 'icons');
const SRC = fs.readFileSync(path.join(DIR, 'icon.svg'), 'utf8');

const variants = {
  'icon-192.png': { size: 192, svg: SRC },
  'icon-512.png': { size: 512, svg: SRC },
  'icon-maskable-512.png': { size: 512, svg: SRC.replace('rx="112"', 'rx="0"').replace('<g class="art">', '<g class="art" transform="translate(40.96 40.96) scale(.84)">') },
  'apple-touch-icon.png': { size: 180, svg: SRC.replace('rx="112"', 'rx="0"') },
  'favicon-32.png': { size: 32, svg: SRC },
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, { size, svg }] of Object.entries(variants)) {
    await page.setViewportSize({ width: size, height: size });
    const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    await page.setContent(`<html><body style="margin:0;background:transparent"><img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`);
    await page.screenshot({ path: path.join(DIR, name), omitBackground: true });
    console.log('wrote', name);
  }
  await browser.close();
})();
