#!/usr/bin/env python3
"""Download USD/ILS exchange rates from several sources into data/.

Sources
-------
boi      Bank of Israel representative rate (שער יציג), series RER_USD_ILS.
         The ONLY rate used for the tax calculation on form 1399.
ecb      European Central Bank reference rates via the Frankfurter API
         (USD->ILS cross computed from EUR/USD and EUR/ILS, fixed ~16:00 CET).
         Used to cross-check the BOI rate.
yahoo    Yahoo Finance ILS=X daily close (London end of day). Cross-check.
intraday Yahoo Finance ILS=X 1-minute bars (the API keeps only the last
         30 days, so a weekly run builds a permanent minute archive) and
         60-minute bars (kept ~2 years back). Used only to show the market
         rate at the exact sale time - never on the form.

The browser cannot call these APIs directly (CORS), so the app reads the
files written here. A weekly GitHub Action (.github/workflows/update-rates.yml)
keeps them current.

Usage: python3 scripts/update_rates.py [--sources boi,ecb,yahoo,intraday] [--start 2019-12-01]
"""
from __future__ import annotations

import argparse
import calendar
import csv
import datetime as dt
import io
import json
import pathlib
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
UA = {"User-Agent": "Mozilla/5.0 (espp-rsu-report-generator rates updater)"}

BOI_API = ("https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/"
           "BOI.STATISTICS/EXR/1.0/RER_USD_ILS?startPeriod={start}&endPeriod={end}&format=csv")
ECB_API = "https://api.frankfurter.dev/v1/{start}..{end}?base=USD&symbols=ILS"
YAHOO_API = "https://query1.finance.yahoo.com/v8/finance/chart/ILS=X?interval={interval}&period1={p1}&period2={p2}"


def http_get(url: str, retries: int = 3) -> str:
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read().decode("utf-8")
        except Exception as exc:  # noqa: BLE001 - network errors of any kind
            last = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET {url} failed: {last}")


def write_json(path: pathlib.Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def daily_payload(source: str, series: str, rates: dict) -> dict:
    rates = dict(sorted(rates.items()))
    return {"source": source, "series": series, "first": next(iter(rates)),
            "last": next(reversed(rates)), "count": len(rates), "rates": rates}


# --------------------------------------------------------------------- daily

def fetch_boi(start: str, end: str) -> dict:
    rates = {}
    for row in csv.DictReader(io.StringIO(http_get(BOI_API.format(start=start, end=end)))):
        if row.get("SERIES_CODE") == "RER_USD_ILS" and row.get("OBS_VALUE"):
            rates[row["TIME_PERIOD"]] = float(row["OBS_VALUE"])
    if len(rates) < 10:
        raise RuntimeError(f"BOI returned only {len(rates)} rates")
    return rates


def fetch_ecb(start: str, end: str) -> dict:
    data = json.loads(http_get(ECB_API.format(start=start, end=end)))
    rates = {d: round(v["ILS"], 4) for d, v in data.get("rates", {}).items() if "ILS" in v}
    if len(rates) < 10:
        raise RuntimeError(f"ECB returned only {len(rates)} rates")
    return rates


def yahoo_chart(interval: str, p1: int, p2: int) -> list[tuple[int, float]]:
    data = json.loads(http_get(YAHOO_API.format(interval=interval, p1=p1, p2=p2)))["chart"]
    if data.get("error"):
        raise RuntimeError(f"Yahoo {interval}: {data['error'].get('description')}")
    res = data["result"][0]
    ts = res.get("timestamp") or []
    closes = res["indicators"]["quote"][0].get("close") or []
    return [(t, round(c, 4)) for t, c in zip(ts, closes) if c is not None]


def fetch_yahoo_daily(start: str) -> dict:
    p1 = calendar.timegm(dt.date.fromisoformat(start).timetuple())
    bars = yahoo_chart("1d", p1, int(time.time()))
    return {dt.datetime.fromtimestamp(t, dt.timezone.utc).date().isoformat(): c for t, c in bars}


# ------------------------------------------------------------------ intraday

def merge_bucketed(bars: list[tuple[int, float]], step: int, folder: pathlib.Path, key_fn) -> int:
    """Merge bars into files keyed by key_fn(datetime) (e.g. month / year).

    File format: {"interval": step seconds, "t0": first epoch, "t": [offsets in steps], "c": [close]}
    """
    buckets: dict[str, dict[int, float]] = {}
    for t, c in bars:
        key = key_fn(dt.datetime.fromtimestamp(t, dt.timezone.utc))
        buckets.setdefault(key, {})[t - t % step] = c
    written = 0
    for key, new in buckets.items():
        path = folder / f"{key}.json"
        merged: dict[int, float] = {}
        if path.exists():
            old = json.loads(path.read_text(encoding="utf-8"))
            for off, c in zip(old["t"], old["c"]):
                merged[old["t0"] + off * old["interval"]] = c
        before = len(merged)
        merged.update(new)
        ts = sorted(merged)
        payload = {"symbol": "ILS=X", "source": "Yahoo Finance", "tz": "UTC", "interval": step,
                   "t0": ts[0], "t": [(t - ts[0]) // step for t in ts], "c": [merged[t] for t in ts]}
        write_json(path, payload)
        written += len(merged) - before
    return written


def fetch_intraday() -> str:
    now = int(time.time())
    minute_bars: list[tuple[int, float]] = []
    # 1-minute data: Yahoo keeps 30 days, max 7 days per request.
    p2 = now
    while p2 > now - 29 * 86400:
        p1 = max(p2 - 7 * 86400, now - 29 * 86400)
        minute_bars += yahoo_chart("1m", p1, p2)
        p2 = p1
    added_m = merge_bucketed(minute_bars, 60, DATA / "intraday" / "minute", lambda d: d.strftime("%Y-%m"))
    hour_bars = yahoo_chart("60m", now - 729 * 86400, now)
    added_h = merge_bucketed(hour_bars, 3600, DATA / "intraday" / "hourly", lambda d: d.strftime("%Y"))
    write_intraday_index()
    return f"intraday: +{added_m} minute bars, +{added_h} hourly bars"


def write_intraday_index() -> None:
    idx = {}
    for kind in ("minute", "hourly"):
        files = sorted(p.stem for p in (DATA / "intraday" / kind).glob("*.json"))
        idx[kind] = files
    write_json(DATA / "intraday" / "index.json", idx)


# ---------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", default="boi,ecb,yahoo,intraday")
    ap.add_argument("--start", default="2019-12-01")
    args = ap.parse_args()
    wanted = set(args.sources.split(","))
    end = dt.date.today().isoformat()
    report, failed = [], []

    def run(name, fn):
        if name not in wanted:
            return
        try:
            report.append(fn())
        except Exception as exc:  # noqa: BLE001 - keep other sources going
            failed.append(name)
            report.append(f"{name}: FAILED - {exc}")

    def boi():
        p = daily_payload("Bank of Israel - representative rate (שער יציג)", "RER_USD_ILS", fetch_boi(args.start, end))
        write_json(DATA / "usd_ils_rates.json", p)
        (DATA / "usd_ils_rates.js").write_text(
            "// Generated by scripts/update_rates.py - do not edit by hand.\n"
            f"window.USD_ILS_RATES = {json.dumps(p, ensure_ascii=False, separators=(',', ':'))};\n", encoding="utf-8")
        return f"boi: {p['count']} rates {p['first']}..{p['last']}"

    def ecb():
        p = daily_payload("European Central Bank reference rate via Frankfurter (USD->ILS cross)", "ECB", fetch_ecb(args.start, end))
        write_json(DATA / "usd_ils_ecb.json", p)
        return f"ecb: {p['count']} rates {p['first']}..{p['last']}"

    def yahoo():
        p = daily_payload("Yahoo Finance ILS=X daily close (London)", "ILS=X", fetch_yahoo_daily(args.start))
        write_json(DATA / "usd_ils_yahoo.json", p)
        return f"yahoo: {p['count']} rates {p['first']}..{p['last']}"

    run("boi", boi)
    run("ecb", ecb)
    run("yahoo", yahoo)
    run("intraday", fetch_intraday)

    # Bundle the secondary daily sources for the browser (works from file:// too).
    secondary = {}
    for key, name in (("ecb", "usd_ils_ecb.json"), ("yahoo", "usd_ils_yahoo.json")):
        if (DATA / name).exists():
            secondary[key] = json.loads((DATA / name).read_text(encoding="utf-8"))
    if secondary:
        (DATA / "usd_ils_secondary.js").write_text(
            "// Generated by scripts/update_rates.py - do not edit by hand.\n"
            f"window.USD_ILS_SECONDARY = {json.dumps(secondary, ensure_ascii=False, separators=(',', ':'))};\n",
            encoding="utf-8")

    print("\n".join(report))
    # The tax calculation depends on BOI only; fail the run if BOI failed.
    return 1 if "boi" in failed else 0


if __name__ == "__main__":
    sys.exit(main())
