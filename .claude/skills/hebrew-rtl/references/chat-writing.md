# Writing Hebrew in chat and Markdown

Chat clients and Markdown renderers decide the direction of each block (a
paragraph, a heading, a list item, a table cell) from its **first strong
character**. Hebrew first: the block is right-to-left and reads correctly.
Latin or a digit first: the whole block flips to left-to-right, punctuation
jumps to the wrong side, and the list bullet moves to the left.

## Rules

| Situation | Do | Avoid |
|---|---|---|
| A sentence about a file or tool | `הקובץ README.md מתאר...` | `README.md מתאר...` |
| A number at the start | `‏3 קבצים השתנו` (RLM first), or `שלושה קבצים השתנו` | `3 קבצים השתנו` |
| A numbered list | `‏1. **ייבוא** מעלים את הקובץ` | `1. **ייבוא** ...` |
| A bold English term first | `‏**ESPP** היא תוכנית...` or `תוכנית **ESPP** היא...` | `**ESPP** היא...` |
| Inline code first | `הפקודה `npm test` מריצה...` | `` `npm test` מריצה... `` |
| A link first | `[המדריך](docs/guide.md) מסביר...` (Hebrew link text) | `[Guide](docs/guide.md) ...` |
| A table cell | `קובץ ה‑PDF`, or `‏PDF` with RLM | `PDF` |
| A heading | `## הגדרות ה‑API` | `## API settings` |
| Commands | a fenced code block (always left-to-right) | a command at the start of a Hebrew line |

- **RLM** is U+200F (`‏`). It is invisible and only sets the direction. In
  source code, write it as `‏`.
- **Hyphen before Hebrew:** join a Latin term and a Hebrew prefix with a
  non-breaking hyphen (U+2011): `ה‑PDF`, `ב‑E*Trade`. It keeps them together
  on one line.
- **Parentheses** are mirrored automatically. Do not swap them by hand.
- **Ranges and dates:** `מ‑18.1.2024 עד 29.2.2024` reads correctly. A bare
  range like `18.1.2024–29.2.2024` can come out reversed in RTL, so prefer
  "מ… עד…".
- **Mixed formulas:** keep a formula in a code span or a code block, or wrap it
  in `<bdi>` in HTML, so it stays left-to-right as a unit.
- **Emoji or a symbol at the start** (✓, ⚠) is neutral. The first strong
  character after it decides, so make that one Hebrew.

## Structure that renders well

- Short paragraphs, each starting with a Hebrew word.
- Bulleted lists where each item starts with a bold Hebrew label:
  `- **מצב כהה**: ...`.
- Tables only when the content really is tabular. Every cell, including the
  header, should start with Hebrew or RLM.
- Code, paths and commands in code blocks.

## Before sending

Write the answer to a scratch file and run:

```bash
python3 scripts/rtl_check.py text /path/to/answer.md
```

Fix every flagged line by rephrasing it so it starts with Hebrew, or by adding
RLM at its start.
