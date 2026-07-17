#!/usr/bin/env python3
"""Export a read-only market snapshot from the private Fragments backend."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode

from dotenv import load_dotenv


def fetch_json(client, path: str):
    response = client.get(path)
    if response.status_code != 200:
        raise RuntimeError(f"{path} returned {response.status_code}: {response.get_data(as_text=True)[:300]}")
    return response.get_json()


def compact_spreads(payload: dict, stride: int = 5) -> dict:
    """Keep weekly-resolution seasonal curves and only tooltip fields used by the UI."""
    for chart in payload.get("spreads", []):
        compacted = {}
        for year, points in chart.get("seriesByYear", {}).items():
            sampled = []
            for index, point in enumerate(points):
                if index % stride != 0 and index != len(points) - 1:
                    continue
                sampled.append({
                    "x": point.get("x", ""),
                    "d": point.get("d", ""),
                    "v": point.get("v"),
                    "instance": point.get("instance", ""),
                })
            compacted[year] = sampled
        chart["seriesByYear"] = compacted
    by_code = {chart.get("spreadCode"): chart for chart in payload.get("spreads", [])}
    payload["monthlySpreads"] = [
        by_code[item.get("spreadCode")]
        for item in payload.get("monthlySpreads", [])
        if item.get("spreadCode") in by_code
    ]
    payload["specialSpreads"] = [
        by_code[item.get("spreadCode")]
        for item in payload.get("specialSpreads", [])
        if item.get("spreadCode") in by_code
    ]
    payload["spreads"] = []
    return payload


def export_craps(client, output: Path, generated_at: str) -> dict:
    """Export only public article metadata already visible in Craps, never article bodies."""
    account_payload = fetch_json(client, "/api/articles/accounts")
    raw_accounts = account_payload.get("data", [])
    accounts = [
        {
            "id": int(account.get("id", 0)),
            "accountName": str(account.get("account_name", "")),
            "starred": int(account.get("starred", 0) or 0),
        }
        for account in raw_accounts
        if account.get("id") and account.get("account_name")
    ]
    account_ids_by_name = {account["accountName"]: account["id"] for account in accounts}

    articles = []
    page = 1
    while True:
        query = urlencode({"days": 0, "page": page, "size": 100})
        article_payload = fetch_json(client, f"/api/articles/list?{query}").get("data", {})
        page_items = article_payload.get("items", [])
        for item in page_items:
            account_name = str(item.get("account_name", ""))
            articles.append({
                "articleId": int(item.get("article_id", 0)),
                "title": str(item.get("title", "")),
                "url": str(item.get("url", "")),
                "publishTime": item.get("publish_time"),
                "accountId": account_ids_by_name.get(account_name),
                "accountName": account_name,
            })
        print(f"exported Craps page {page}: {len(page_items)} articles", flush=True)
        if len(page_items) < 100:
            break
        page += 1

    payload = {
        "meta": {"generatedAt": generated_at, "total": len(articles)},
        "accounts": accounts,
        "articles": articles,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return {"articles": len(articles), "accounts": len(accounts), "bytes": output.stat().st_size}


def export_snapshot(source_root: Path, output: Path) -> dict:
    load_dotenv(source_root / ".env")
    os.environ["ACCESS_ANSWER"] = ""
    sys.path.insert(0, str(source_root / "backend"))

    from main import app  # pylint: disable=import-outside-toplevel

    client = app.test_client()
    config = fetch_json(client, "/api/commodity-config")
    contract_batch = fetch_json(client, "/api/klines/batch?days=999&kind=contract")
    continuous_batch = fetch_json(client, "/api/klines/batch?days=999&kind=dominant_continuous")
    term_matrix = fetch_json(client, "/api/term-structure/matrix")

    spread_dir = output.parent / "spreads"
    if spread_dir.exists():
        shutil.rmtree(spread_dir)
    spread_dir.mkdir(parents=True)
    varieties = [
        str(item.get("code", "")).upper()
        for item in config.get("items", [])
        if item.get("enabled", True) and item.get("code")
    ]
    for index, variety in enumerate(varieties, 1):
        modes = {}
        for mode in ("raw", "adjusted"):
            query = urlencode({"variety": variety, "years": 5, "priceMode": mode})
            modes[mode] = compact_spreads(fetch_json(client, f"/api/spreads/seasonal?{query}"))
        (spread_dir / f"{variety}.json").write_text(
            json.dumps(modes, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        print(f"[{index:02d}/{len(varieties):02d}] exported spreads for {variety}", flush=True)

    generated_at = datetime.now().astimezone().isoformat(timespec="seconds")
    payload = {
        "meta": {
            "generatedAt": generated_at,
            "latestDate": term_matrix.get("latestDate", ""),
        },
        "commodityConfig": config,
        "klineBatches": {
            "contract": contract_batch,
            "dominant_continuous": continuous_batch,
        },
        "termStructureMatrix": term_matrix,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    craps_report = export_craps(client, output.parent / "craps.json", generated_at)
    return {
        "output": str(output),
        "bytes": (
            output.stat().st_size
            + sum(path.stat().st_size for path in spread_dir.glob("*.json"))
            + craps_report["bytes"]
        ),
        "latestDate": payload["meta"]["latestDate"],
        "varieties": len(varieties),
        "craps": craps_report,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "public" / "data" / "snapshot.json",
    )
    args = parser.parse_args()
    report = export_snapshot(args.source_root.resolve(), args.output.resolve())
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
