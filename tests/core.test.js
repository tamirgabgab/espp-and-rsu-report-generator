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
