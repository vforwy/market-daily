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

    payload = {
        "meta": {
            "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
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
    return {
        "output": str(output),
        "bytes": output.stat().st_size + sum(path.stat().st_size for path in spread_dir.glob("*.json")),
        "latestDate": payload["meta"]["latestDate"],
        "varieties": len(varieties),
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
