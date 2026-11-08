/*
 * Explanation view: the general tax method with the formulas typeset in LaTeX
 * (KaTeX, vendored, loaded the first time the tab opens).
 *
 * Hebrew text stays outside the formulas; every formula is rendered left to
 * right inside the right-to-left page.
 */
(function () {
  'use strict';
  let loading = null;
  let done = false;

  function loadKatex() {
    if (window.katex) return Promise.resolve();
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'vendor/katex/katex.min.css';
        document.head.appendChild(css);
        const s = document.createElement('script');
        s.src = 'vendor/katex/katex.min.js';
        s.onload = resolve;
        s.onerror = () => { loading = null; reject(new Error('KaTeX did not load')); };
        document.head.appendChild(s);
      });
    }
    return loading;
  }

  // Each section: a Hebrew title, Hebrew paragraphs and display formulas (TeX).
  const SECTIONS = [
    {
      title: 'הסימנים',
      table: [
        ['q', 'מספר המניות במכירה'],
        ['P', 'התמורה בדולרים (Total Proceeds)'],
        ['F', 'עמלות המכירה בדולרים, אם לא נוכו מהתמורה'],
        ['C', 'העלות בדולרים לחישוב רווח ההון'],
        ['R_b', 'השער היציג של בנק ישראל ביום הרכישה, ההבשלה או ההקצאה'],
        ['R_s', 'השער היציג של בנק ישראל ביום המכירה'],
        ['V', 'שווי ההטבה מהמעסיק, בדולרים'],
        ['C_p', 'מה ששילמת על המניות, בדולרים (ב‑RSU אפס)'],
        ['m', 'שיעור המס השולי, כולל ביטוח לאומי ומס בריאות אם רלוונטי'],
      ],
    },
    {
      title: 'שלב 1: המרה לשקלים',
      text: ['כל סכום מומר בשער היציג של היום שלו: התמורה והעמלות בשער של יום המכירה, והעלות בשער של יום הרכישה.'],
      tex: ['\\text{Proceeds} = P\\,R_s \\qquad \\text{Cost} = C\\,R_b \\qquad \\text{Fees} = F\\,R_s',
        'B = P\\,R_s - C\\,R_b - F\\,R_s \\qquad (\\text{nominal gain in ILS})'],
    },
    {
      title: 'שלב 2: הסכום האינפלציוני',
      text: ['ליחיד שקנה נייר ערך בדולרים, שער הדולר משמש כמדד. החלק של הרווח שנובע רק מעליית הדולר פטור ממס. כשהשקל התחזק הסכום שלילי: ברווח הוא נחשב 0, ובהפסד מנטרלים אותו (הלכת מוזס, חוזר 10/2025).'],
      tex: ['I = C\\,R_b\\left(\\frac{R_s}{R_b} - 1\\right) = C\\,(R_s - R_b)'],
    },
    {
      title: 'שלב 3: רווח ריאלי',
      text: ['שתי התוצאות: הרווח בדולרים מומר בשער המכירה, והרווח הנומינלי בשקלים. הרווח הריאלי הוא הקטנה מהן בערך מוחלט. כך מתקבלות בדיוק ארבע הדוגמאות שבחוזר.'],
      tex: ['A = (P - C - F)\\,R_s',
        'G = \\begin{cases} \\min(A, B) & A \\ge 0,\\ B \\ge 0 \\\\ \\max(A, B) & A \\le 0,\\ B \\le 0 \\\\ 0 & \\text{otherwise} \\end{cases}'],
    },
    {
      title: 'שלב 4: מס רווח הון',
      text: ['מקזזים הפסדים מול רווחים של אותה תקופה: בחצי שנה לצורך המקדמה (עד 31.7 ועד 31.1), ובשנה כולה בדוח השנתי. הפסד שנשאר עובר לשנים הבאות. השיעור קבוע: 25%, ו‑30% לבעל מניות מהותי. מס יסף (3% ועוד 2% על הכנסה הונית מעל התקרה) לא מחושב בכלי.'],
      tex: ['T_c = 25\\% \\times \\max\\Big(0,\\ \\sum_{G_i > 0} G_i + \\sum_{G_j < 0} G_j\\Big)'],
    },
    {
      title: 'ESPP: מחיר הרכישה (Lookback)',
      text: ['ברוב התוכניות מחיר הרכישה הוא 85% מהנמוך מבין מחיר המניה בתחילת תקופת ההצעה וביום הרכישה. S₀ ו‑S₁ הם מחירי הסגירה באותם ימים, ו‑d היא ההנחה (בדרך כלל 15%).'],
      tex: ['p = (1 - d)\\,\\min(S_0,\\ S_1) \\qquad C_p = p\\,q \\qquad V = S_1\\,q',
        '\\text{Discount} = V - C_p = (S_1 - p)\\,q'],
    },
    {
      title: 'RSU: שווי ההטבה',
      text: ['במסלול 102 עם נאמן, לחברה נסחרת, שווי ההטבה הוא ממוצע מחירי הסגירה ב‑30 ימי המסחר שלפני ההענקה. בלי נאמן, השווי הוא מחיר המניה ביום ההבשלה.'],
      tex: ['V_{102} = q \\cdot \\frac{1}{30}\\sum_{i=1}^{30} S_{g-i} \\qquad V_{\\text{regular}} = q\\,S_{\\text{vest}}'],
    },
    {
      title: 'מסלול 102 עם נאמן: חלוקת הרווח',
      text: ['המס על ההטבה לא משולם במשכורת אלא במכירה, והנאמן מנכה אותו. החלק עד שווי ההטבה הוא הכנסת עבודה במס שולי, והיתרה היא רווח הון ב‑25%, שמחושב ריאלית כמו בשלבים 1–4, עם העלות שלמטה ובשער של יום ההקצאה לנאמן (ההענקה ב‑RSU, הרכישה ב‑ESPP).',
        'מכירה לפני תום 24 חודשים מההקצאה מוציאה את המניות מהמסלול: כל הרווח הוא הכנסת עבודה, ואין רווח הון.'],
      tex: ['W = \\min(V,\\ P - F) - C_p \\qquad T_w = m \\cdot W\\,R_s',
        'C = C_p + W',
        't_{\\text{sale}} < t_{\\text{alloc}} + 24\\ \\text{months} \\ \\Rightarrow\\ W = P - F - C_p,\\ \\ G = 0'],
    },
    {
      title: 'בלי נאמן',
      text: ['ההטבה ממוסה במשכורת ביום הרכישה או ההבשלה, והמעסיק מנכה את המס. לכן העלות לרווח ההון היא השווי באותו יום (Adjusted Cost Basis), כדי שההטבה לא תמוסה פעמיים.'],
      tex: ['W_0 = V - C_p \\qquad T_0 \\approx m \\cdot W_0\\,R_b \\qquad C = V'],
    },
    {
      title: 'כמה נשאר ביד',
      text: ['מה שנשאר מהמכירה אחרי מה ששילמת, העמלות וכל המיסים. בלשונית "נוסחאות" רואים את החישוב הזה עם המספרים שלך, כולל עמודה שמראה לאן הולך הכסף.'],
      tex: ['\\text{Net} = P\\,R_s - C_p\\,R_b - F\\,R_s - T_w - T_c'],
    },
  ];

  function html() {
    const k = tex => window.katex.renderToString(tex, { displayMode: true, throwOnError: false, output: 'html' });
    const inline = tex => window.katex.renderToString(tex, { displayMode: false, throwOnError: false, output: 'html' });
    return SECTIONS.map(s => `<section class="ex-sec">
        <h3>${s.title}</h3>
        ${(s.text || []).map(p => `<p>${p}</p>`).join('')}
        ${s.table ? `<dl class="ex-symbols">${s.table.map(([sym, d]) => `<dt dir="ltr">${inline(sym)}</dt><dd>${d}</dd>`).join('')}</dl>` : ''}
        ${(s.tex || []).map(t => `<div class="ex-math" dir="ltr">${k(t)}</div>`).join('')}
      </section>`).join('');
  }

  async function render() {
    if (done) return;
    const host = document.getElementById('ex-body');
    const t = setTimeout(() => { host.innerHTML = '<p class="hint">טוען את הנוסחאות…</p>'; }, 100);
    try {
      await loadKatex();
      clearTimeout(t);
      host.innerHTML = html();
      done = true;
    } catch (e) {
      clearTimeout(t);
      console.error(e);
      host.innerHTML = '<p class="msg err">הנוסחאות לא נטענו. אפשר לרענן את הדף ולנסות שוב.</p>';
    }
  }

  window.Explain = { render };
})();
