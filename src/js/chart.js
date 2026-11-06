/*
 * Minimal SVG line chart of the USD/ILS representative rate with buy/sell
 * markers and a crosshair tooltip. No dependencies.
 */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const el = (name, attrs = {}, parent) => {
    const n = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };

  /**
   * @param {HTMLElement} host
   * @param {Object<string, number>} rates  ISO date -> rate
   * @param {{date:string, type:'buy'|'sell', label:string}[]} markers
   * @param {HTMLElement} tooltip
   */
  function renderRateChart(host, rates, markers, tooltip) {
    host.innerHTML = '';
    const dates = Object.keys(rates).filter(d => d >= '2020-01-01').sort();
    if (!dates.length) return;
    // Size the viewBox to the real container width so text stays 11px on phones.
    const W = Math.max(300, Math.round(host.clientWidth || 960));
    const H = W < 560 ? 220 : 300;
    const m = { t: 12, r: 12, b: 28, l: 40 };
    const t0 = Date.parse(dates[0]), t1 = Date.parse(dates[dates.length - 1]);
    const vals = dates.map(d => rates[d]);
    const lo = Math.floor(Math.min(...vals) * 10) / 10, hi = Math.ceil(Math.max(...vals) * 10) / 10;
    const x = d => m.l + ((Date.parse(d) - t0) / (t1 - t0)) * (W - m.l - m.r);
    const y = v => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `שער דולר-שקל יציג מ-${dates[0]} עד ${dates[dates.length - 1]}`, direction: 'ltr' }, host);

    // Grid + y axis labels.
    for (let v = lo; v <= hi + 1e-9; v += 0.1) {
      const yy = y(v);
      const major = Math.abs(v * 10 - Math.round(v * 10)) < 1e-6 && Math.round(v * 10) % 2 === 0;
      el('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, stroke: 'var(--grid)', 'stroke-width': major ? 1 : 0.5 }, svg);
      if (major) {
        const t = el('text', { x: m.l - 6, y: yy + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' }, svg);
        t.textContent = v.toFixed(1);
      }
    }
    // X axis year ticks.
    const y0 = +dates[0].slice(0, 4), y1 = +dates[dates.length - 1].slice(0, 4);
    const yearStep = W < 480 ? 2 : 1;
    for (let yr = y0; yr <= y1; yr++) {
      const d = `${yr}-01-01`;
      if ((yr - y0) % yearStep) continue;
      if (Date.parse(d) < t0) continue;
      const xx = x(d);
      el('line', { x1: xx, x2: xx, y1: m.t, y2: H - m.b, stroke: 'var(--grid)', 'stroke-width': 0.5 }, svg);
      const t = el('text', { x: xx, y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' }, svg);
      t.textContent = String(yr);
    }
    // Line.
    const dPath = dates.map((d, i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)},${y(rates[d]).toFixed(1)}`).join('');
    el('path', { d: dPath, fill: 'none', stroke: 'var(--series-1)', 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);

    // Markers.
    const Core = root.Core;
    const mks = markers.map(mk => {
      const r = Core.lookupRate(rates, mk.date);
      return r && mk.date >= dates[0] ? { ...mk, rate: r.rate, rateDate: r.date } : null;
    }).filter(Boolean);
    for (const mk of mks) {
      el('circle', {
        cx: x(mk.rateDate), cy: y(mk.rate), r: 5,
        fill: mk.type === 'buy' ? 'var(--buy)' : 'var(--sell)', stroke: 'var(--surface)', 'stroke-width': 2,
      }, svg);
    }

    // Crosshair + tooltip.
    const cross = el('line', { y1: m.t, y2: H - m.b, stroke: 'var(--muted)', 'stroke-width': 1, 'stroke-dasharray': '3 3', visibility: 'hidden' }, svg);
    const dot = el('circle', { r: 4, fill: 'var(--series-1)', stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }, svg);
    const hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
    const fmtDate = iso => Core.formatDateIL(iso);
    const hide = () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tooltip.hidden = true; };
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('pointermove', ev => {
      const box = svg.getBoundingClientRect();
      const px = ((ev.clientX - box.left) / box.width) * W;
      const t = t0 + ((px - m.l) / (W - m.l - m.r)) * (t1 - t0);
      // Binary search the nearest published date.
      let lo2 = 0, hi2 = dates.length - 1;
      while (hi2 - lo2 > 1) { const mid = (lo2 + hi2) >> 1; if (Date.parse(dates[mid]) < t) lo2 = mid; else hi2 = mid; }
      const i = Math.abs(Date.parse(dates[lo2]) - t) < Math.abs(Date.parse(dates[hi2]) - t) ? lo2 : hi2;
      const d = dates[i];
      const xx = x(d), yy = y(rates[d]);
      cross.setAttribute('x1', xx); cross.setAttribute('x2', xx); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', xx); dot.setAttribute('cy', yy); dot.setAttribute('visibility', 'visible');
      const near = mks.filter(mk => mk.rateDate === d).map(mk => mk.label);
      tooltip.innerHTML = `<b>${fmtDate(d)}</b> · ${rates[d].toFixed(3)} ₪` + (near.length ? `<br>${near.join('<br>')}` : '');
      tooltip.hidden = false;
      const tw = tooltip.offsetWidth;
      tooltip.style.left = `${Math.min(ev.clientX + 12, window.innerWidth - tw - 8)}px`;
      tooltip.style.top = `${ev.clientY + 14}px`;
    });
  }

  root.RateChart = { renderRateChart };
})(typeof self !== 'undefined' ? self : this);
