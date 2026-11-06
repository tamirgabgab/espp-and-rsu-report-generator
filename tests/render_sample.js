// Renders a sample report to out/sample.pdf (and PNGs if pdftoppm exists) for
// visually checking field positions on the form. Usage: node tests/render_sample.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Core = require('../src/js/core.js');
const Pdf = require('../src/js/pdf1399.js');

const root = path.join(__dirname, '..');
const rates = require('../data/rates/daily/boi.json').rates;
const lots = [
  { symbol: 'QCOM', planType: 'ESPP', qty: 17, dateAcquired: '2024-01-31', dateSold: '2026-05-11', proceedsUsd: 3938.96, costUsd: 2524.67, feesUsd: 0 },
  { symbol: 'QCOM', planType: 'RSU', qty: 10, dateAcquired: '2022-08-22', dateSold: '2026-05-11', proceedsUsd: 2317.04, costUsd: 1460.2, feesUsd: 0 },
  { symbol: 'QCOM', planType: 'ESPP', qty: 12, dateAcquired: '2025-01-31', dateSold: '2026-09-15', proceedsUsd: 1800, costUsd: 2000, feesUsd: 4.95 },
];
const items = lots.map(lot => ({ lot, calc: Core.computeLot(lot, rates) }));
const profile = { name: 'ישראל ישראלי', idNumber: '123456782', belonging: 2, sec102: true, place: 'israel', signDate: '2026-11-06' };

(async () => {
  const bytes = await Pdf.buildPdf({
    formBytes: fs.readFileSync(path.join(root, 'assets/forms/form-1399y-2025-blank.pdf')),
    fontBytes: fs.readFileSync(path.join(root, 'assets/fonts/NotoSansHebrew_400Regular.ttf')),
    profile, items,
  });
  const outDir = process.argv[2] || path.join(root, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'sample.pdf');
  fs.writeFileSync(file, bytes);
  console.log('wrote', file);
  try { execSync(`pdftoppm -r 110 -png "${file}" "${path.join(outDir, 'sample')}"`); console.log('rendered PNGs'); } catch (e) { /* optional */ }
})();
