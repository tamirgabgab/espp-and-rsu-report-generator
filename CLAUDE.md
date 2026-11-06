# Project instructions for Claude

## Language
- Always answer the user in Hebrew. Code, comments, commit messages and documentation stay in English.
- RTL-safe Hebrew: every paragraph, heading, table cell and list item must start with a Hebrew word.
  If a line has to begin with a Latin character or a number, put the RLM mark (U+200F) first.
- Ask clarifying questions before big changes, and end each work round with a short summary by sections.

## Project
- Static web app (no build step) that turns E*Trade ESPP/RSU sale transactions into a filled
  Israeli Tax Authority form 1399 (י) for the user's accountant. See README.md and docs/, and read
  docs/HANDOFF.md at the start of every session (update it at the end).
- USD/ILS rates come from the Bank of Israel representative rate (series RER_USD_ILS), bundled in
  `data/rates/daily/boi.json` / `.js` and refreshed by `tools/update_rates.py`. The BOI API rejects
  cross-origin browser calls, so the app must not depend on fetching it at runtime.
- Only the BOI rate goes on the form. ECB / Yahoo daily rates are a cross-check, and Yahoo
  intraday bars (data/rates/intraday/) show the rate at the sale time for information only.
  All sources are refreshed weekly by .github/workflows/update-rates.yml.
- Layout: app code in src/, data in data/rates/, maintenance scripts in tools/, docs in docs/.
  index.html must stay at the repo root (GitHub Pages serves main / root).
- Never commit personal data (ID number, real transaction files). Personal details live only in the
  browser's localStorage.
