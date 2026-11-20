'use strict';
/*
 * Browser smoke test (Playwright, Chromium). Run: npm run e2e
 *
 * Serves the repository on a free port, then for two widths (375, 1280) and two
 * themes (light, dark): imports a synthetic G&L CSV, opens a calculation panel,
 * visits the four tabs and checks that the page never scrolls sideways. At 1280 px
 * in the light theme it also downloads the PDF, the Excel file and the
 * accountant package. Any page error or console error fails the run.
 *
 * The CSV holds illustrative numbers only, never real transactions.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.pdf': 'application/pdf', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.gz': 'application/gzip',
  '.wasm': 'application/wasm',
};

const CSV = [
  'Record Type,Symbol,Plan Type,Quantity,Date Acquired,Acquisition Cost,Adjusted Cost Basis,Date Sold,Total Proceeds,Order Number',
  'Sell,QCOM,ESPP,17,01/31/2024,"$2,145.97","$2,524.67",05/11/2026,"$3,938.96",100000001',
  'Sell,QCOM,RS,10,08/20/2024,$0.00,"$1,800.00",05/11/2026,"$2,317.04",100000001',
].join('\n');

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };

async function run() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  try {
    for (const width of [375, 1280]) {
      for (const theme of ['light', 'dark']) {
        const tag = `${width}px ${theme}`;
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, acceptDownloads: true });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        await page.goto(base);
        await page.evaluate(() => localStorage.clear());
        await page.reload();

        await page.setInputFiles('#file', { name: 'gains.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
        const list = width < 768 ? '#lots-cards .lot-card' : '#lots-body .lot-row';
        await page.waitForSelector(list);
        check(await page.locator(list).count() === 2, `${tag}: two sales imported`);

        const scope = width < 768 ? '#lots-cards' : '#lots-body';
        await page.locator(`${scope} [data-act="explain"]`).first().click();
        await page.waitForSelector('.calc-table');
        check(await page.locator('.calc-table tbody tr').count() >= 3, `${tag}: calculation panel opens`);
        await page.locator('.panel-more summary').first().click();
        await page.waitForSelector('.wi-chart svg', { timeout: 5000 }).catch(() => null);
        check(await page.locator('.wi-chart svg').count() > 0, `${tag}: "what if" chart draws`);

        if (width === 1280 && theme === 'light') {
          const download = async (click, what) => {
            const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), click()]);
            const file = await dl.path();
            return { name: dl.suggestedFilename(), bytes: fs.readFileSync(file) };
          };
          const pdf = await download(async () => {
            await page.click('#dl-pdf');
            await page.click('#details-skip'); // the name / ID dialog
          });
          check(pdf.name.endsWith('.pdf') && pdf.bytes.slice(0, 5).toString() === '%PDF-', `PDF download (${pdf.name}, ${pdf.bytes.length} bytes)`);
          const xlsx = await download(() => page.click('#dl-xlsx'));
          check(xlsx.name.endsWith('.xlsx') && xlsx.bytes.slice(0, 2).toString() === 'PK', `Excel download (${xlsx.name})`);
          const zip = await download(() => page.click('#dl-zip'));
          check(zip.name.endsWith('.zip') && zip.bytes.slice(0, 2).toString() === 'PK', `package download (${zip.name})`);
        }

        for (const view of ['report', 'sim', 'formulas', 'explain']) {
          await page.click(`#tab-${view}`);
          await page.waitForTimeout(view === 'explain' ? 800 : 200);
          check(await page.locator(`#view-${view}`).isVisible(), `${tag}: tab ${view} shows`);
          check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `${tag}: tab ${view} has no sideways scroll`);
        }
        check(errors.length === 0, `${tag}: no page or console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
  process.exitCode = failures.length ? 1 : 0;
}

run().catch(e => { console.error(e); process.exitCode = 1; });
