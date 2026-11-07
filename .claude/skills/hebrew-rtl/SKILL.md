---
name: hebrew-rtl
description: Hebrew and right-to-left (RTL) output that renders correctly. Use when writing a chat answer, Markdown, docs or messages in Hebrew; when generating a PDF, Excel/XLSX, CSV or text file that contains Hebrew; or when Hebrew shows up reversed, jumbled, with English or numbers in the wrong place, or as gibberish. Includes RTL-safe chat writing rules, PDF and spreadsheet recipes, and a checker script (scripts/rtl_check.py) for Markdown/text, PDF, XLSX and CSV.
---

# Hebrew and RTL output

Hebrew breaks in three predictable places: a chat line that starts with a Latin
character flips to left-to-right; a PDF engine draws Hebrew letters in the
wrong order; a spreadsheet or CSV opens left-to-right or as mojibake. This
skill prevents all three, and gives a script to check the result.

Read the reference that matches the task:

| Task | Read |
|---|---|
| Chat answer, Markdown, README, commit-free prose in Hebrew | [references/chat-writing.md](references/chat-writing.md) |
| PDF, XLSX, CSV, TXT with Hebrew | [references/files.md](references/files.md) |
| Checking any of the above | the checker below |

## Hard rules

1. **Every line starts with a Hebrew letter.** A paragraph, heading, list item
   or table cell whose first strong character is Latin or a digit is laid out
   left-to-right by the renderer. If it must start with Latin text, a number,
   inline code or a link, put the RLM mark (U+200F) first.
2. **Numbered lists start with RLM:** `‏1. **מילה** ...`.
3. **Keep Hebrew in logical order in data** (strings, cells, JSON). Convert to
   visual order only at the last step, and only for engines that draw glyphs
   one by one (most PDF libraries).
4. **Never reverse twice.** If the engine shapes RTL itself (HarfBuzz,
   fontkit with an RTL script, fpdf2 `set_text_shaping`), do NOT also feed it
   visual-order text. Pick exactly one.
5. **Embed a Hebrew-capable font** in PDFs (for example Noto Sans Hebrew). The
   14 standard PDF fonts have no Hebrew glyphs.
6. **Mark spreadsheets as RTL** (sheet view `rightToLeft`), and write Hebrew
   CSV/TXT as UTF-8 **with a BOM**, plus CRLF for Windows tools.
7. **Check before you hand it over.** Run the checker. For PDFs, also render a
   page to PNG and look at it: a checker cannot see layout.

## Checker

`scripts/rtl_check.py` uses only the standard library (plus `pdftotext` from
poppler, or `pypdf`, for PDFs). Exit code 1 means problems were found.

```bash
python3 scripts/rtl_check.py text answer.md            # RTL-unsafe line starts
python3 scripts/rtl_check.py pdf out/form.pdf          # reversed Hebrew in extracted text
python3 scripts/rtl_check.py xlsx out/report.xlsx      # RTL sheet view + reversed text
python3 scripts/rtl_check.py csv out/export.csv        # BOM / encoding
```

Paths are relative to this skill's folder. Before sending a long Hebrew chat
answer, you can write it to a scratch file and run `text` on it.

How the checks work:
- **text:** flags paragraphs, headings, list items and table cells whose first
  strong character is not Hebrew and that do not start with RLM. It skips code
  blocks, and lines that contain no Hebrew at all.
- **reversed Hebrew** (pdf, xlsx): Hebrew final letters (ך ם ן ף ץ) appear only
  at the end of a word. In reversed text they show up at the start. If many
  words start with a final letter, the text is reversed.
- **xlsx:** every worksheet should have `rightToLeft="1"` in its sheet view, or
  the workbook view should.
- **csv/txt:** Hebrew content should start with a UTF-8 BOM, and must decode as
  UTF-8.

## Quick self-check for chat answers (no script)

- Does each line start with a Hebrew word (or RLM)?
- Are the English terms, file names and commands in the middle or at the end of
  the sentence?
- Do numbered items start with `‏1.` (RLM, then the number)?
- Are commands in fenced code blocks, which are left-to-right on their own?
