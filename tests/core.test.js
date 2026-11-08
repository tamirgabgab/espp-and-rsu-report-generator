// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/js/core.js');

// Rates keyed by date, mirroring the examples in Income Tax Circular 10/2025.
const R = (buy, sell) => ({ '2017-01-01': buy, '2017-06-01': sell });
const lot = (cost, proceeds) => ({ dateAcquired: '2017-01-01', dateSold: '2017-06-01', costUsd: cost, proceedsUsd: proceeds, feesUsd: 0 });

test('circular example 1: USD gain, shekel weakened', () => {
  const c = Core.computeLot(lot(1000, 1200), R(3.4, 3.7));
  assert.equal(c.proceedsIls, 4440);
  assert.equal(c.costIls, 3400);
  assert.equal(c.nominal, 1040);
  assert.equal(c.inflationary, 300);
  assert.equal(c.real, 740);
});

test('circular example 2: USD loss, shekel weakened -> nominal loss allowed', () => {
  const c = Core.computeLot(lot(1000, 800), R(3.4, 3.7));
  assert.equal(c.nominal, -440);
  assert.equal(c.real, -440);
});

test('circular example 2b: gain fully inflationary -> no real gain', () => {
  const c = Core.computeLot(lot(1000, 800), R(3.4, 5));
  assert.equal(c.nominal, 600);
  assert.equal(c.inflationary, 600);
  assert.equal(c.real, 0);
  assert.equal(c.tax, 0);
});

test('circular example 3: USD gain, shekel strengthened -> all nominal gain is real', () => {
  const c = Core.computeLot(lot(1000, 1200), R(3.7, 3.4));
  assert.equal(c.nominal, 380);
  assert.equal(c.inflationary, 0);
  assert.equal(c.real, 380);
});

test('circular example 4: USD loss, shekel strengthened -> neutralise FX part', () => {
  const c = Core.computeLot(lot(1000, 900), R(3.7, 3.4));
  assert.equal(c.nominal, -640);
  assert.equal(c.inflationary, -300);
  assert.equal(c.real, -340);
});

test('USD gain but ILS loss -> no gain and no loss', () => {
  const c = Core.computeLot(lot(1000, 1050), R(3.7, 3.4));
  assert.equal(c.nominal, 3570 - 3700);
  assert.equal(c.real, 0);
  assert.equal(c.tax, 0);
});

test('user example (QCOM ESPP) with official BOI rates', () => {
  const rates = require('../data/rates/daily/boi.json').rates;
  const c = Core.computeLot({ dateAcquired: '2024-01-31', dateSold: '2026-05-11', proceedsUsd: 3938.96, costUsd: 2524.67, feesUsd: 0 }, rates);
  assert.equal(c.buy.rate, 3.635);
  assert.equal(c.sell.rate, 2.909);
  assert.equal(c.proceedsIls, 11458);
  assert.equal(c.costIls, 9177);
  assert.equal(c.real, 2281);
  assert.equal(c.tax, 570);
});

test('weekend date falls back to last published rate', () => {
  const r = Core.lookupRate({ '2026-05-08': 2.907, '2026-05-11': 2.909 }, '2026-05-10');
  assert.deepEqual(r, { rate: 2.907, date: '2026-05-08', exact: false });
});

test('dates after the last bundled rate are not silently back-filled', () => {
  assert.equal(Core.lookupRate({ '2026-05-08': 2.907 }, '2026-05-09'), null);
});

test('date parsing', () => {
  assert.equal(Core.parseDate('05/11/2026'), '2026-05-11');
  assert.equal(Core.parseDate('2024-01-31'), '2024-01-31');
  assert.equal(Core.parseDate(45322), '2024-01-31');
  assert.equal(Core.parseDate('13/45/2024'), null);
  assert.equal(Core.formatDateIL('2026-05-11'), '11.5.2026');
});

test('money parsing', () => {
  assert.equal(Core.parseMoney('$2,524.67'), 2524.67);
  assert.equal(Core.parseMoney('($12.50)'), -12.5);
  assert.ok(Number.isNaN(Core.parseMoney('--')));
});

test('E*Trade G&L rows: skips summary, uses adjusted cost basis, splits lots', () => {
  const rows = [
    ['Record Type', 'Symbol', 'Plan Type', 'Quantity', 'Date Acquired', 'Acquisition Cost', 'Adjusted Cost Basis', 'Date Sold', 'Total Proceeds', 'Order Number'],
    ['Summary', '', '', 27, '', '$3,033.40', '$4,000.00', '', '$6,300.00', ''],
    ['Sell', 'QCOM', 'ESPP', 17, '01/31/2024', '$1,909.78', '$2,524.67', '05/11/2026', '$3,938.96', '102642608'],
    ['Sell', 'QCOM', 'RS', 10, '08/20/2024', '$0.00', '$1,800.00', '05/11/2026', '$2,317.04', '102642608'],
  ];
  const { lots, warnings } = Core.parseEtradeRows(rows);
  assert.deepEqual(warnings, []);
  assert.equal(lots.length, 2);
  assert.equal(lots[0].costUsd, 2524.67);
  assert.equal(lots[0].dateAcquired, '2024-01-31');
  assert.equal(lots[1].planType, 'RSU');
});

test('summary offsets losses against gains per half-year and year', () => {
  const mk = (sold, real) => ({ lot: { dateSold: sold }, calc: { ok: true, proceedsIls: 0, costIls: 0, feesIls: 0, nominal: real, inflationary: 0, real } });
  const s = Core.summarize([mk('2026-02-01', 1000), mk('2026-03-01', -400), mk('2026-09-01', 200)]);
  assert.deepEqual(s.map(g => g.key), ['2026-H1', '2026-H2', '2026']);
  const h1 = s.find(g => g.key === '2026-H1');
  const y = s.find(g => g.key === '2026');
  assert.equal(h1.net, 600);
  assert.equal(h1.tax, 150);
  assert.equal(y.net, 800);
  assert.equal(y.tax, 200);
});

test('cross-check flags large deviations from the BOI rate', () => {
  const src = { boi: { '2024-01-31': 3.635 }, ecb: { '2024-01-31': 3.6386 }, yahoo: { '2024-01-31': 3.72 } };
  const c = Core.crossCheck(src, '2024-01-31');
  assert.equal(c.checks.ecb.devPct, 0.1);
  assert.equal(c.checks.ecb.warn, false);
  assert.equal(c.checks.yahoo.warn, true);
  assert.equal(c.warn, true);
});

test('New York time to UTC honours daylight saving', () => {
  // 11 May 2026 is EDT (UTC-4); 15 Jan 2026 is EST (UTC-5).
  assert.equal(Core.nyToUtcEpoch('2026-05-11', '10:30'), Date.UTC(2026, 4, 11, 14, 30) / 1000);
  assert.equal(Core.nyToUtcEpoch('2026-01-15', '10:30'), Date.UTC(2026, 0, 15, 15, 30) / 1000);
  assert.equal(Core.nyToUtcEpoch('2026-01-15', ''), null);
});

test('intraday lookup picks the bar whose close is nearest to the moment', () => {
  const t0 = Date.UTC(2026, 9, 1) / 1000;
  const file = { interval: 60, t0, t: [0, 1, 2, 10], c: [3.1, 3.2, 3.3, 3.4] };
  assert.equal(Core.intradayAt(file, t0 + 90).rate, 3.2);       // bar 1 closes at t0+120
  assert.equal(Core.intradayAt(file, t0 + 100).ts, t0 + 120);
  assert.equal(Core.intradayAt(file, t0 + 80).ts, t0 + 60);       // bar 0 closes nearer
  assert.equal(Core.intradayAt(file, t0 + 60 * 4).rate, 3.3);   // gap of 2 bars -> last earlier bar
  assert.equal(Core.intradayAt(file, t0 + 60 * 6 + 5).exact, false);
  assert.equal(Core.intradayAt(file, t0 + 60 * 9 + 5), null);      // gap of 7 bars is too far
  assert.equal(Core.intradayAt(file, t0 + 60 * 20), null);     // beyond the data
  assert.equal(Core.intradayAt(file, t0 - 60), null);
});

test('closed form min/max rule agrees with the step-by-step circular logic', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 2000; i++) {
    const rb = 2.8 + rnd() * 1.4, rs = 2.8 + rnd() * 1.4;
    const lot = { dateAcquired: '2020-01-01', dateSold: '2021-01-01', costUsd: 100 + rnd() * 5000, proceedsUsd: 100 + rnd() * 5000, feesUsd: rnd() < 0.3 ? rnd() * 20 : 0 };
    const rates = { '2020-01-01': +rb.toFixed(3), '2021-01-01': +rs.toFixed(3) };
    const c = Core.computeLot(lot, rates);
    const cf = Core.closedFormReal(lot, rates['2020-01-01'], rates['2021-01-01']);
    assert.ok(Math.abs(c.real - cf.real) <= 3, `lot ${i}: step ${c.real} vs closed ${cf.real}`);
  }
});

test('Israeli ID check digit', () => {
  assert.equal(Core.isValidIsraeliId('123456782'), true);
  assert.equal(Core.isValidIsraeliId('123456789'), false);
  assert.equal(Core.isValidIsraeliId('12345678'), false);
  assert.equal(Core.isValidIsraeliId('000000018'), true);
  assert.equal(Core.isValidIsraeliId('18'), true);
  assert.equal(Core.isValidIsraeliId(''), false);
});

test('order text paste extracts date and 24h time', () => {
  assert.deepEqual(Core.parseOrderText('Executed 05/11/2026 10:35:12 AM ET'), { date: '2026-05-11', time: '10:35' });
  assert.deepEqual(Core.parseOrderText('Order Executed: 09/15/2026 03:05 PM EDT'), { date: '2026-09-15', time: '15:05' });
  assert.deepEqual(Core.parseOrderText('12:10 AM'), { date: null, time: '00:10' });
  assert.deepEqual(Core.parseOrderText('nothing here'), { date: null, time: null });
});

test('backup round-trip never contains the ID number and restores lots', () => {
  const lots = [{ id: 7, symbol: 'qcom', planType: 'ESPP', qty: 17, dateAcquired: '2024-01-31', dateSold: '2026-05-11', timeSold: '11:02', proceedsUsd: 3938.96, costUsd: 2524.67, feesUsd: 0, sec102: null, rateBuy: '', rateSell: '', order: '' },
                { symbol: 'X', qty: NaN, dateAcquired: '', dateSold: '2026-01-01', proceedsUsd: NaN, costUsd: 5 }];
  const b = Core.makeBackup({ name: 'A', idNumber: '123456782', belonging: '2' }, lots, new Date('2026-11-07T10:00:00Z'));
  const text = JSON.stringify(b);
  assert.ok(!text.includes('123456782'));
  assert.ok(!text.includes('"id"'));
  const back = Core.parseBackup(text);
  assert.equal(back.lots.length, 2);
  assert.equal(back.lots[0].symbol, 'QCOM');
  assert.equal(back.lots[0].proceedsUsd, 3938.96);
  assert.ok(Number.isNaN(back.lots[1].qty));
  assert.deepEqual(back.profile, { name: 'A', belonging: '2' });
});

test('backup parsing rejects foreign files', () => {
  assert.throws(() => Core.parseBackup('not json'), /JSON/);
  assert.throws(() => Core.parseBackup('{"lots":[]}'), /גיבוי/);
});

test('merge skips exact duplicate lots', () => {
  const a = { symbol: 'Q', dateAcquired: '2024-01-31', dateSold: '2026-05-11', qty: 17, proceedsUsd: 1, costUsd: 1 };
  const b = { ...a, qty: 10 };
  const r = Core.mergeLots([a], [a, b, b]);
  assert.equal(r.added, 1);
  assert.equal(r.skipped, 2);
  assert.equal(r.merged.length, 2);
});

// ------------------------------------------------------------ section 102, stock prices, simulator

test('addMonths clamps to the end of the month', () => {
  assert.equal(Core.addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(Core.addMonths('2024-02-29', 24), '2026-02-28');
  assert.equal(Core.unlockDate('2024-01-31'), '2026-02-01');
});

test('30-trading-day average uses only the days before the date', () => {
  const prices = {};
  for (let i = 1; i <= 40; i++) prices[Core.addDays('2025-01-01', i)] = i; // 2025-01-02 .. 2025-02-10
  const a = Core.avgCloseBefore({ rates: prices }, '2025-02-01'); // days 1..30 are before 2025-02-01
  assert.equal(a.count, 30);
  assert.equal(a.avg, 15.5);
  assert.equal(a.from, '2025-01-02');
  assert.equal(a.to, '2025-01-31');
  assert.equal(Core.avgCloseBefore({ rates: prices }, '2025-01-20'), null); // not enough history
  assert.equal(Core.avgCloseBefore({ rates: prices }, '2026-01-01'), null); // beyond the data
  assert.deepEqual(Core.lastClose({ rates: prices }), { price: 40, date: '2025-02-10' });
});

const rates102 = { '2024-01-31': 3.635, '2025-03-03': 3.6, '2026-05-11': 2.909 };

test('102 ESPP: discount is work income, the rest is a real capital gain', () => {
  const espp = { symbol: 'QCOM', planType: 'ESPP', qty: 17, dateAcquired: '2024-01-31', dateSold: '2026-05-11', proceedsUsd: 3938.96, costUsd: 2524.67, paidUsd: 2145.97, feesUsd: 0 };
  const c = Core.computeLot102(espp, rates102);
  const plain = Core.computeLot(espp, rates102);
  assert.equal(c.ok, true);
  assert.equal(c.early, false);
  assert.equal(c.workUsd, 378.7);
  assert.equal(c.workIls, Math.round(378.7 * 2.909));
  assert.equal(c.real, plain.real); // capital part = the regular calculation from the market value
  assert.equal(c.costDate, '2024-01-31');
  // Unknown purchase price: no work part, capital part unchanged.
  const u = Core.computeLot102({ ...espp, paidUsd: NaN }, rates102);
  assert.equal(u.paidKnown, false);
  assert.equal(u.workUsd, 0);
  assert.equal(u.real, plain.real);
});

test('102 early sale: the whole gain is work income and there is no form', () => {
  const c = Core.computeLot102({ planType: 'ESPP', qty: 10, dateAcquired: '2025-03-03', dateSold: '2026-05-11', proceedsUsd: 2000, costUsd: 1500, paidUsd: 1275, feesUsd: 0 }, rates102);
  assert.equal(c.early, true);
  assert.equal(c.noForm, true);
  assert.equal(c.workUsd, 725);
  assert.equal(c.real, 0);
  const g = Core.summarize([{ lot: { dateSold: '2026-05-11' }, calc: c }]);
  assert.equal(g[0].count, 0);
  assert.equal(g[0].workIls, c.workIls);
});

test('102 RSU: the 30-day average splits work income and capital gain', () => {
  const rsu = { symbol: 'X', planType: 'RSU', qty: 10, grantDate: '2024-01-31', dateAcquired: '2025-03-03', dateSold: '2026-05-11', proceedsUsd: 1000, costUsd: 900, feesUsd: 0, avg30: '60' };
  const c = Core.computeLot102(rsu, rates102);
  assert.equal(c.baseSource, 'manual');
  assert.equal(c.workUsd, 600);
  assert.equal(c.capCostUsd, 600);
  assert.equal(c.buy.rate, 3.635); // cost dated at the grant (allocation)
  const viaPrices = Core.computeLot102({ ...rsu, avg30: '' }, rates102, {}, { prices: { X: { rates: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [Core.addDays('2023-12-01', i), 60])) } } });
  assert.equal(viaPrices.baseSource, 'avg30');
  assert.equal(viaPrices.workUsd, 600);
  // Sold below the average: work income is capped at the proceeds, no capital gain.
  const low = Core.computeLot102({ ...rsu, avg30: '120' }, rates102);
  assert.equal(low.workUsd, 1000);
  assert.equal(low.real, 0);
  // Missing grant date is an issue.
  assert.equal(Core.computeLot102({ ...rsu, grantDate: '' }, rates102).ok, false);
});

test('work tax estimate', () => {
  assert.equal(Core.workTax(1000, { marginalRate: 47, niRate: 12, includeNi: true }), 590);
  assert.equal(Core.workTax(1000, { marginalRate: 47, niRate: 12, includeNi: false }), 470);
  assert.equal(Core.workTax(-5), 0);
});

test('simulator: early 102 sale also shows the sale on the unlock date', () => {
  const h = { symbol: 'X', planType: 'ESPP', qty: 10, dateAcquired: '2025-03-03', costPerShare: 150, paidPerShare: 127.5, sec102: true };
  const r = Core.simulateHolding(h, { price: 200, date: '2026-05-11', rate: 3, is102: true, rates: rates102, settings: { marginalRate: 47, includeNi: false } });
  assert.equal(r.now.ok, true);
  assert.equal(r.now.calc.early, true);
  assert.equal(r.now.workTax, Core.roundILS(725 * 3 * 0.47));
  assert.equal(r.later.calc.early, false);
  assert.equal(r.later.calc.workUsd, 225);
  assert.ok(r.later.net > r.now.net);
});

test('holdings import is tolerant of the E*Trade layout', () => {
  const rows = [
    ['Record Type', 'Symbol', 'Purchase Date', 'Purchase Price', 'Purchase Date FMV', 'Sellable Qty.'],
    ['Purchase', 'QCOM', '01/31/2025', '126.23', '148.51', '17'],
    ['Purchase', 'QCOM', '07/31/2025', '130', '160', '0'],
    ['Totals', '', '', '', '', '17'],
  ];
  const r = Core.parseHoldingsRows(rows, 'ESPP');
  assert.equal(r.holdings.length, 1);
  assert.deepEqual([r.holdings[0].planType, r.holdings[0].dateAcquired, r.holdings[0].costPerShare, r.holdings[0].paidPerShare], ['ESPP', '2025-01-31', 148.51, 126.23]);
});

test('backup keeps the 102 fields and the holdings', () => {
  const b = Core.makeBackup({ name: 'A', marginalRate: 35 }, [{ symbol: 'X', planType: 'RSU', grantDate: '2024-01-31', paidUsd: 0, avg30: '60', withheldIls: 1200 }], new Date(0), [{ symbol: 'x', planType: 'RSU', qty: 5, grantDate: '2025-01-01', costPerShare: NaN }]);
  const back = Core.parseBackup(JSON.stringify(b));
  assert.equal(back.lots[0].grantDate, '2024-01-31');
  assert.equal(back.lots[0].withheldIls, 1200);
  assert.equal(back.profile.marginalRate, 35);
  assert.equal(back.holdings[0].symbol, 'X');
  assert.ok(Number.isNaN(back.holdings[0].costPerShare));
});

// Synthetic OCR text shaped like the E*Trade Gains & Losses page (made-up numbers).
const OCR_GL = `Opening Transaction Closing Transaction
tol Transaction Benefit Quantity Date nga Date Total Deferred Gain/Loss Adjusted ay
Type Type Acquired Basis Sold Proceeds Loss Gain/Loss State
$1,111.00
v ABCD Sell ESPP 10 02/28/2023 @ 03/15/2025 $1,500.00 $0.00 $600.00 $3890@ Long Term
Order Type Covered Status © Qualified Plan? ® Disposition Type ® Discount Amount ® Grant Date ©
Sell ESPP Covered Non-Qualified .- $0.00 08/31/2022
Grant Date FMV © Purchase Date © Purchase Date FMV ® Purchase Price ©
$100.00 02/28/2023 $111.10 $85.00
View Order Details | View Tax Reporting Guidelines Order? 123456789
v ABCD Sell RS 5 03/01/2024 $1,000.00 03/15/2025 $1,250.00 $0.00 $250.00 $250.00 Long Term
Order Type Covered Status Grant Date Vest Date FMV ©
Sell Restricted Stock Covered 03/01/2022 $200.00
Totals 15 $2,750.00`;

test('OCR text of the G&L page becomes lots', () => {
  const r = Core.parseGainsText(OCR_GL);
  assert.equal(r.lots.length, 2);
  const [a, b] = r.lots;
  assert.deepEqual([a.symbol, a.planType, a.qty, a.dateAcquired, a.dateSold, a.proceedsUsd, a.costUsd, a.paidUsd, a.order],
    ['ABCD', 'ESPP', 10, '2023-02-28', '2025-03-15', 1500, 1111, 850, '123456789']);
  assert.deepEqual([b.planType, b.qty, b.dateAcquired, b.costUsd, b.proceedsUsd, b.grantDate, b.paidUsd],
    ['RSU', 5, '2024-03-01', 1000, 1250, '2022-03-01', 0]);
  assert.equal(r.warnings.length, 0);
  // A cost that does not match the FMV is flagged.
  assert.equal(Core.parseGainsText(OCR_GL.replace('$1,111.00', '$1,711.00')).warnings.length, 1);
  assert.equal(Core.parseGainsText('nothing here').lots.length, 0);
});

test('sale hints from a trade confirmation', () => {
  const h = Core.parseSaleHints('Symbol: ABCD\nTrade Date 03/15/2025 Settlement Date 03/17/2025\nQuantity 10\nCommission $4.95 SEC Fee $0.03\nNet Amount $1,495.02');
  assert.deepEqual([h.symbol, h.dateSold, h.qty, h.proceedsUsd, Core.round2(h.feesUsd)], ['ABCD', '2025-03-15', 10, 1495.02, 4.98]);
});

test('OCR helpers: ticker snapping and best of several readings', () => {
  assert.equal(Core.snapSymbol('QCcoM', ['QCOM']), 'QCOM');
  assert.equal(Core.snapSymbol('MSFT', ['QCOM']), 'MSFT');
  const bad = OCR_GL.replace('$85.00', '$5.00');
  const best = Core.bestGainsParse([bad, OCR_GL], { symbols: ['ABCD'] });
  assert.equal(best.text, OCR_GL);
  assert.equal(Core.parseGainsText(bad).warnings.length, 1); // purchase price far below the FMV
});

// ------------------------------------------------------------ what if / lookback

const P = { X: { rates: { '2023-07-31': 100, '2024-01-31': 120, '2024-02-01': 90, '2026-05-11': 200, '2026-05-12': 210 },
  high: { '2026-05-11': 220, '2026-05-12': 215 }, low: { '2026-05-11': 190, '2026-05-12': 205 } } };
const R2 = { '2023-07-31': 3.7, '2024-01-31': 3.635, '2024-02-01': 3.62, '2026-05-11': 2.909, '2026-05-12': 2.91 };
const wlot = { symbol: 'X', planType: 'ESPP', qty: 10, dateAcquired: '2024-01-31', dateSold: '2026-05-11', offerStart: '2023-07-31', proceedsUsd: 2000, costUsd: 1200, paidUsd: 850, feesUsd: 0 };

test('lookback purchase price and offering start', () => {
  assert.equal(Core.lookbackPrice(100, 120), 85);
  assert.equal(Core.lookbackPrice(130, 120, 10), 108);
  assert.equal(Core.offeringStart({ dateAcquired: '2024-01-31' }), '2023-07-31');
  assert.equal(Core.offeringStart(wlot), '2023-07-31');
});

test('what if: unmoved dates give no variants; a moved sale gives the low and high of the day', () => {
  assert.equal(Core.whatIfLots(wlot, { offerStart: '2023-07-31', buyDate: '2024-01-31', saleDate: '2026-05-11' }, P).variants.length, 0);
  const s = Core.whatIfLots(wlot, { offerStart: '2023-07-31', buyDate: '2024-01-31', saleDate: '2026-05-12' }, P);
  assert.deepEqual(s.variants.map(v => [v.key, v.lot.proceedsUsd, v.lot.costUsd]), [['low', 2050, 1200], ['high', 2150, 1200]]);
});

test('what if: moving the purchase re-prices FMV and the lookback price', () => {
  const s = Core.whatIfLots(wlot, { offerStart: '2023-07-31', buyDate: '2024-02-01', saleDate: '2026-05-11' }, P);
  const v = s.variants[0].lot;
  assert.equal(v.costUsd, 900); // close 90 x 10
  assert.equal(v.paidUsd, 765); // 85% x min(100, 90) x 10
  const e = Core.evaluateLot(v, { rates: R2, prices: P, is102: true, settings: { marginalRate: 50, includeNi: false } });
  assert.equal(e.ok, true);
  assert.equal(e.calc.workUsd, 135); // discount 900 - 765
  assert.equal(e.workTax, Core.roundILS(Core.roundILS(135 * 2.909) * 0.5));
  assert.equal(e.net, e.calc.proceedsIls - e.paidIls - e.workTax - e.calc.tax);
});
