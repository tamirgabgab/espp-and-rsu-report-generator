#!/usr/bin/env python3
"""Check Hebrew / RTL output: Markdown or text, PDF, XLSX and CSV.

Usage:
    python3 rtl_check.py text FILE...   # lines that would render left-to-right
    python3 rtl_check.py pdf FILE...    # reversed Hebrew in the extracted text
    python3 rtl_check.py xlsx FILE...   # RTL sheet view + reversed Hebrew
    python3 rtl_check.py csv FILE...    # UTF-8 BOM / encoding (also .txt)

Exit code: 0 = no problems, 1 = problems found, 2 = usage or read error.
Standard library only; PDFs need `pdftotext` (poppler) or the `pypdf` package.
"""
import re
import shutil
import subprocess
import sys
import zipfile

RLM = "‏"
HEB = re.compile(r"[א-ת]")
HEB_WORD = re.compile(r"[א-תװ-ײ]{2,}")
FINALS = set("ךםןףץ")


def is_hebrew(ch):
    return "֐" <= ch <= "׿" or "יִ" <= ch <= "ﭏ"


def is_ltr_strong(ch):
    return ch.isascii() and ch.isalnum() or ("À" <= ch <= "ɏ")


# ------------------------------------------------------------------ text / Markdown

MARKER = re.compile(r"^(\s*(?:>\s*)*)(#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?)?")
NUMBERED = re.compile(r"^(\s*(?:>\s*)*)(\d+[.)])\s+")
TAG = re.compile(r"^<[^>]*>")


def first_strong(s):
    """Return ('rtl'|'ltr'|'rlm'|None, char) for the first strong character, skipping Markdown syntax."""
    i = 0
    while i < len(s):
        m = TAG.match(s[i:])
        if m:  # an HTML tag such as <bdi> is not displayed
            i += m.end()
            continue
        ch = s[i]
        if ch == RLM:
            return "rlm", ch
        if is_hebrew(ch):
            return "rtl", ch
        if is_ltr_strong(ch):
            return "ltr", ch
        if ch == "]" and s[i + 1:i + 2] == "(":  # skip a link target: (url)
            j = s.find(")", i)
            i = j + 1 if j != -1 else len(s)
            continue
        i += 1
    return None, None


def check_text(path):
    problems = []
    try:
        lines = open(path, encoding="utf-8-sig").read().splitlines()
    except (OSError, UnicodeDecodeError) as exc:
        return [f"{path}: cannot read as UTF-8 ({exc})"]
    # A table is checked cell by cell when any of its rows contains Hebrew.
    heb_table = set()
    block = []
    for n, line in enumerate(lines + [""], 1):
        if line.strip().startswith("|"):
            block.append(n)
        else:
            if any(HEB.search(lines[k - 1]) for k in block):
                heb_table.update(block)
            block = []
    in_code = False
    prev_blank = True
    for n, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith(("```", "~~~")):
            in_code = not in_code
            prev_blank = False
            continue
        if in_code or not stripped:
            prev_blank = True if not stripped else prev_blank
            continue
        if stripped.startswith("|"):
            if n not in heb_table:
                continue
            if re.fullmatch(r"\|?[\s:|-]+\|?", stripped):
                continue
            for cell in [c.strip() for c in stripped.strip("|").split("|")]:
                kind, ch = first_strong(cell)
                if kind == "ltr":
                    problems.append(f"{path}:{n}: table cell starts with '{ch}' (left-to-right): {cell[:40]!r}")
            prev_blank = False
            continue
        if not HEB.search(line):
            prev_blank = False
            continue
        num = NUMBERED.match(line)
        if num and RLM not in line[:num.start(2)]:
            problems.append(f"{path}:{n}: numbered item without RLM before the number: {stripped[:50]!r}")
            prev_blank = False
            continue
        m = MARKER.match(line)
        is_block_start = prev_blank or bool(m.group(2)) or bool(m.group(1).strip())
        if is_block_start:
            rest = line[m.end():]
            kind, ch = first_strong(rest)
            if kind == "ltr":
                problems.append(f"{path}:{n}: line starts with '{ch}' and renders left-to-right: {stripped[:50]!r}")
        prev_blank = False
    return problems


# ------------------------------------------------------------------ reversed Hebrew

def reversed_score(text):
    """Words starting with a final letter vs. words ending with one. Normal Hebrew never starts with one."""
    start = end = 0
    for w in HEB_WORD.findall(text):
        if w[0] in FINALS:
            start += 1
        if w[-1] in FINALS:
            end += 1
    return start, end


def reversed_problem(label, text):
    start, end = reversed_score(text)
    if start >= 3 and start > 0.3 * (start + end):
        return [f"{label}: Hebrew looks reversed ({start} words start with a final letter ך/ם/ן/ף/ץ, {end} end with one)"]
    return []


def pdf_text(path):
    if shutil.which("pdftotext"):
        out = subprocess.run(["pdftotext", "-enc", "UTF-8", path, "-"], capture_output=True)
        if out.returncode == 0:
            return out.stdout.decode("utf-8", "replace")
    try:
        from pypdf import PdfReader  # optional
    except ImportError as exc:
        raise RuntimeError("needs pdftotext (poppler-utils) or the pypdf package") from exc
    return "\n".join(page.extract_text() or "" for page in PdfReader(path).pages)


def check_pdf(path):
    try:
        text = pdf_text(path)
    except Exception as exc:  # noqa: BLE001
        return [f"{path}: cannot extract text ({exc})"]
    if not HEB.search(text):
        return [f"{path}: no Hebrew text found (a missing Hebrew font, or text drawn as paths)"]
    return reversed_problem(path, text)


# ------------------------------------------------------------------ XLSX

def check_xlsx(path):
    problems = []
    try:
        z = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as exc:
        return [f"{path}: not an XLSX file ({exc})"]
    names = z.namelist()
    sheets = sorted(n for n in names if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n))
    texts = []
    for name in sheets:
        xml = z.read(name).decode("utf-8", "replace")
        if not re.search(r"<sheetView\b[^>]*\brightToLeft=\"(1|true)\"", xml):
            problems.append(f"{path}: {name} is not right-to-left (sheetView rightToLeft missing)")
        texts.extend(re.findall(r"<t[^>]*>([^<]*)</t>", xml))
    if "xl/sharedStrings.xml" in names:
        texts.extend(re.findall(r"<t[^>]*>([^<]*)</t>", z.read("xl/sharedStrings.xml").decode("utf-8", "replace")))
    problems += reversed_problem(path, "\n".join(texts))
    return problems


# ------------------------------------------------------------------ CSV / TXT

def check_csv(path):
    try:
        raw = open(path, "rb").read()
    except OSError as exc:
        return [f"{path}: cannot read ({exc})"]
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return [f"{path}: not UTF-8 (Hebrew may be in Windows-1255); save it as UTF-8 with a BOM"]
    problems = []
    if HEB.search(text) and not raw.startswith(b"\xef\xbb\xbf"):
        problems.append(f"{path}: Hebrew without a UTF-8 BOM; Excel on Windows will show gibberish")
    problems += reversed_problem(path, text)
    return problems


CHECKS = {"text": check_text, "md": check_text, "pdf": check_pdf, "xlsx": check_xlsx, "csv": check_csv, "txt": check_csv}


def main(argv):
    if len(argv) < 3 or argv[1] not in CHECKS:
        print(__doc__.strip())
        return 2
    problems = []
    for path in argv[2:]:
        problems += CHECKS[argv[1]](path)
    for p in problems:
        print(p)
    if not problems:
        print(f"OK: {len(argv) - 2} file(s) checked, no RTL problems found")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
