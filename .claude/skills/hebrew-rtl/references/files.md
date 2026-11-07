# Hebrew in PDF, Excel, CSV and text files

## PDF

Most PDF libraries draw glyphs left to right, in the order they receive them.
Hebrew stored in logical order (the normal order in strings) then comes out
reversed, for example `םולש` instead of `שלום`.

### Pick one strategy and never combine them

| Strategy | When | How |
|---|---|---|
| **A. Convert to visual order yourself** | The engine has no bidi/RTL shaping (pdf-lib default, reportlab, PDFKit) | Run the Unicode Bidi Algorithm on each line, then draw the result left to right |
| **B. Let the engine shape RTL** | The engine uses HarfBuzz or similar with direction RTL (fpdf2 with `set_text_shaping(True)`, some Skia or Cairo setups) | Pass logical-order text and set the direction or language |

**Double reversal is the classic bug.** Strategy A plus an engine that
silently shapes RTL gives you correct text reversed again. In pdf-lib with
`@pdf-lib/fontkit`, fontkit detects the Hebrew script and reverses runs
itself. Either force its layout to `latn`/`ltr` after converting to visual
order, or skip your own conversion.

### Strategy A, by language

- **JavaScript (pdf-lib):** a small bidi pass is enough for one line of mixed
  text:
  - split the line into runs: Hebrew, Latin/digits, neutral;
  - resolve each neutral run to the direction of its neighbours when both
    sides match, and to RTL otherwise;
  - reverse the order of runs, and reverse the characters of Hebrew runs only;
  - mirror brackets (`(` ↔ `)`) inside RTL runs.

  Alternatively use the `bidi-js` package.
- **Python (reportlab):** `from bidi.algorithm import get_display`, then
  `canvas.drawRightString(x, y, get_display(text))`. Use `arabic-reshaper`
  only for Arabic; Hebrew does not need it.
- **Python (fpdf2):** prefer strategy B:
  `pdf.set_text_shaping(use_shaping_engine=True, direction="rtl")`.

### Layout

- **Right alignment:** `x = rightEdge − font.widthOfTextAtSize(text, size)`.
  Shrink the size until the text fits the box, rather than letting it overflow.
- **Numbers and Latin** inside Hebrew stay left to right
  (`5,938.25*2.909=17,274`). The bidi pass keeps them as one run.
- **Font:** embed a font that covers Hebrew, for example Noto Sans Hebrew (SIL
  OFL). Subsetting is fine.
- **Filling an existing form:** draw on top of the page at measured
  coordinates. Keep the coordinates in one map, measured in points from a
  named origin, so a new edition of the form needs only re-calibration.

### Viewing and checking

- **Text check:** `python3 scripts/rtl_check.py pdf file.pdf` runs `pdftotext`
  and looks for reversed words.
- **Visual check:** render a page and look at it, for example with
  `pdftoppm -r 80 -png -f 1 -l 1 file.pdf page`.
- **pdf.js shows garbled Hebrew in an embedded CID font:** open the document
  with `disableFontFace: true`, so the glyphs are drawn as paths.

## Excel (XLSX)

- **Sheet direction:** every sheet should open right-to-left.
  - SheetJS: `wb.Workbook = { Views: [{ RTL: true }] }`.
  - openpyxl: `ws.sheet_view.rightToLeft = True` for each sheet.
  - xlsxwriter: `worksheet.right_to_left()`.
  - ExcelJS: `worksheet.views = [{ rightToLeft: true }]`.
- **Cell text** stays in logical order. Never pre-reverse strings for Excel.
- **Headers in Hebrew** are fine. Keep units in the header (`תמורה ₪`) and
  plain numbers in the cells, so sums and formulas keep working.
- **Dates:** write real date cells, or a display format like `d.m.yyyy`,
  instead of US `MM/DD/YYYY` strings.
- **Check:** `python3 scripts/rtl_check.py xlsx file.xlsx`.

## CSV and plain text

- **Encoding:** UTF-8 **with a BOM** (`﻿` as the first character).
  Without it, Excel on Windows opens Hebrew CSV files as gibberish.
- **Line endings:** CRLF (`\r\n`) when the file is meant for Windows Notepad or
  Excel.
- **JavaScript:** `new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })`.
- **Python:** `open(path, 'w', encoding='utf-8-sig', newline='\r\n')`.
- **Check:** `python3 scripts/rtl_check.py csv file.csv` (works for `.txt` too).

## Word (DOCX), briefly

- **Paragraph direction:** each Hebrew paragraph needs `<w:bidi/>` in its
  paragraph properties.
- **Runs:** each run needs `<w:rtl/>` in its run properties.
- **python-docx:** it has no API for these, so set them through the XML
  elements (`pPr` / `rPr`).
