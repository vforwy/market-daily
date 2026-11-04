"""Static, derived-only holdings archive; no raw source rows or credentials."""
from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

COMMON_FIELDS = ("variety", "varietyName", "policyVersion", "latestHoldingDate", "latestPriceDate", "missingHoldingDates", "metadata", "dates", "dominant", "ohlc", "seats")


def _write(root, relative, payload):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
    path.write_bytes(body)
    return {"file": relative, "sha256": hashlib.sha256(body).hexdigest()}


def _trim_board(board, cutoff):
    indices = [i for i, day in enumerate(board["dates"]) if day <= cutoff]
    take = lambda values: [values[i] for i in indices]
    result = {**board, "dates": take(board["dates"]), "dominant": take(board["dominant"]), "ohlc": take(board["ohlc"])}
    result["combined"] = {key: take(values) for key, values in board["combined"].items()}
    result["contracts"] = [{"code": row["code"], **{key: take(row[key]) for key in ("longSum", "shortSum", "ratio")}} for row in board["contracts"]]
    result["seats"] = [{**row, **{key: take(row[key]) for key in ("net", "contractLong", "contractShort", "longRank", "shortRank")}} for row in board["seats"]]
    holding = [day for day, value in zip(result["dates"], result["combined"]["longSum"]) if value is not None]
    quotes = [day for day, value in zip(result["dates"], result["ohlc"]) if value is not None]
    result.update(latestHoldingDate=max(holding, default=None), latestPriceDate=max(quotes, default=None),
                  missingHoldingDates=[day for day in result["dates"] if day not in set(holding)])
    return result


def export_holdings(output_dir: Path, varieties: list[str], quote_date: str) -> dict:
    """Reuse the private view contract and publish only persisted computed results."""
    from app.api.holding_seat import _load_board, _as_date, _number
    from app.core.holding_view import assemble_board
    from app.db.pool import get_conn
    from app.db.read import read_cursor

    if output_dir.is_symlink():
        raise ValueError("holdings destination must not be a symlink")
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True)
    index = {"formatVersion": 1, "quoteDate": quote_date, "latestDate": None, "tradingDates": [], "varieties": {}}
    with read_cursor(get_conn) as cur:
        cur.execute("SELECT MIN(trade_date) FROM futures_holding_topn_daily")
        first = cur.fetchone()[0]
        calendar_start = _as_date(first) - timedelta(days=366) if first else date.fromisoformat(quote_date) - timedelta(days=366)
        cur.execute("SELECT DISTINCT cal_date FROM futures_trade_cal WHERE is_open=1 AND cal_date BETWEEN %s AND %s ORDER BY cal_date", (calendar_start, quote_date))
        index["tradingDates"] = [_as_date(row[0]).isoformat() for row in cur.fetchall()]
        for variety in varieties:
            board = _trim_board(_load_board(cur, variety, 5), quote_date)
            days = board["dates"]
            positions = {day: i for i, day in enumerate(days)}
            variants = {"5": {key: board[key] for key in ("combined", "contracts")}}
            top_rows = defaultdict(list)
            cur.execute("SELECT top_n, trade_date, scope_type, scope_code, long_sum, short_sum, ratio FROM futures_holding_topn_daily WHERE variety=%s AND top_n IN (10,20) AND trade_date<=%s ORDER BY top_n,trade_date,scope_code", (variety, quote_date))
            for n, day, scope, code, long, short, ratio in cur.fetchall():
                top_rows[int(n)].append({"trade_date": _as_date(day), "scope_type": scope, "scope_code": code, "long_sum": _number(long), "short_sum": _number(short), "ratio": _number(ratio)})
            quotes = [{"trade_date": day, "dominant": code, **dict(zip(("open", "close", "low", "high"), prices))}
                      for day, code, prices in zip(days, board["dominant"], board["ohlc"]) if prices is not None]
            for n in (10, 20):
                view = assemble_board(variety=variety, variety_name=board["varietyName"], top_n=n,
                                      policy_version=board["policyVersion"], members=[], quotes=quotes,
                                      product_topn=[row for row in top_rows[n] if row["scope_type"] == "product"],
                                      contract_topn=[row for row in top_rows[n] if row["scope_type"] == "contract"])
                if view["dates"] != days:
                    raise ValueError(f"{variety}: top-N date coverage differs")
                variants[str(n)] = {key: view[key] for key in ("combined", "contracts")}
            common = {key: board[key] for key in COMMON_FIELDS}
            common["metadata"] = {key: board["metadata"][key] for key in ("computedAt", "sourceDates") if key in board["metadata"]}
            entry = {**_write(output_dir, f"{variety}/board.json", {"formatVersion": 1, "common": common, "topN": variants}),
                     "latestDate": board["latestHoldingDate"], "members": {}}
            scopes = {}
            cur.execute("SELECT trade_date,scope_code,broker,seat_group,seat_label,net,long_rank,short_rank FROM futures_holding_member_daily WHERE variety=%s AND trade_date<=%s ORDER BY scope_code,trade_date,broker", (variety, quote_date))
            for day, scope, broker, group, label, net, long_rank, short_rank in cur.fetchall():
                position = positions.get(_as_date(day).isoformat())
                if position is None:
                    continue
                slot = scopes.setdefault(scope, {"brokers": [], "lookup": {}, "rows": []})
                identity = (broker, group, label)
                if identity not in slot["lookup"]:
                    slot["lookup"][identity] = len(slot["brokers"])
                    slot["brokers"].append(identity)
                slot["rows"].append([position, slot["lookup"][identity], int(net), long_rank, short_rank])
            for scope, slot in scopes.items():
                if not re.fullmatch(r"[A-Z0-9.]+", scope):
                    raise ValueError("Invalid holdings scope")
                entry["members"][scope] = _write(output_dir, f"{variety}/members/{scope}.json", {
                    "formatVersion": 1, "variety": variety, "scopeCode": scope,
                    "brokers": slot["brokers"], "rows": slot["rows"],
                })
            index["varieties"][variety] = entry
            if entry["latestDate"]:
                index["latestDate"] = max(index["latestDate"] or "", entry["latestDate"])
            print(f"holdings {variety}: {len(days)} dates, {len(scopes)} member scopes", flush=True)
    _write(output_dir, "index.json", index)
    return {"formatVersion": 1, "latestDate": index["latestDate"], "varieties": len(varieties),
            "files": sum(1 for _ in output_dir.rglob("*.json")), "bytes": sum(p.stat().st_size for p in output_dir.rglob("*.json"))}


def validate_holdings(root: Path, summary: dict, varieties: list[str], quote_date: str) -> dict:
    """Offline release contract: paths, generations, missing data and derived shape."""
    def require(condition, message):
        if not condition:
            raise ValueError(f"holdings: {message}")

    def read(path):
        require(not path.is_symlink(), "symlink is not allowed")
        return json.loads(path.read_text())

    def number(value):
        return value is None or (isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value))

    def vector(values, width):
        require(isinstance(values, list) and len(values) == width and all(number(v) for v in values), "invalid series length or number")

    require(root.is_dir() and not root.is_symlink(), "missing or unsafe archive")
    require(not any(path.is_symlink() for path in root.rglob("*")), "symlink is not allowed")
    index = read(root / "index.json")
    require(index.get("formatVersion") == summary.get("formatVersion") == 1, "unsupported format")
    require(index.get("quoteDate") == quote_date, "quote date differs from market snapshot")
    require(set(index.get("varieties", {})) == set(varieties), "varieties differ from website configuration")
    calendar = index.get("tradingDates", [])
    require(calendar == sorted(set(calendar)) and all(date.fromisoformat(d).isoformat() == d and d <= quote_date for d in calendar), "invalid trading calendar")
    referenced = {"index.json"}
    dated = []
    total_rows = 0
    expected_varieties = []
    missing_varieties = []

    def load(ref):
        relative = ref.get("file", "")
        require(re.fullmatch(r"[A-Z]+/(?:board\.json|members/[A-Z0-9.]+\.json)", relative) is not None and ".." not in relative, "invalid asset path")
        path = root / relative
        require(path.is_file() and not path.is_symlink(), f"missing asset {relative}")
        require(hashlib.sha256(path.read_bytes()).hexdigest() == ref.get("sha256"), f"hash mismatch for {relative}")
        referenced.add(relative)
        return read(path)

    for variety, entry in index["varieties"].items():
        require(entry.get("file") == f"{variety}/board.json", "board identity mismatch")
        archive = load(entry)
        require(archive.get("formatVersion") == 1, "invalid board version")
        common = archive.get("common", {})
        require(set(common) == set(COMMON_FIELDS) and common.get("variety") == variety, "invalid public board fields")
        days = common["dates"]
        require(days == sorted(set(days)) and all(date.fromisoformat(d).isoformat() == d and d <= quote_date for d in days), "invalid board dates")
        width = len(days)
        require(len(common["dominant"]) == len(common["ohlc"]) == width, "quote series is misaligned")
        for prices in common["ohlc"]:
            require(prices is None or (len(prices) == 4 and all(number(v) and v is not None for v in prices)), "invalid price bar")
        require(set(archive.get("topN", {})) == {"5", "10", "20"}, "top-N sets are incomplete")
        contract_sets = []
        for variant in archive["topN"].values():
            points = [variant["combined"], *variant["contracts"]]
            contracts = [row["code"] for row in variant["contracts"]]
            require(len(contracts) == len(set(contracts)) and all(re.fullmatch(re.escape(variety) + r"\d{3,4}\.[A-Z]+", c) for c in contracts), "invalid contract codes")
            contract_sets.append(set(contracts))
            for point in points:
                for field in ("longSum", "shortSum", "ratio"):
                    vector(point[field], width)
                for long, short, ratio in zip(point["longSum"], point["shortSum"], point["ratio"]):
                    if long is None or short is None:
                        require(long is short is ratio is None, "missing positions were partially filled")
                    else:
                        require(long >= 0 and short >= 0, "negative top-N magnitude")
                        require(ratio is None if short == 0 else ratio is not None and abs(ratio - long / short) <= 0.000002, "invalid long/short ratio")
        require(all(codes == contract_sets[0] for codes in contract_sets), "contract coverage differs across top-N")
        holding_days = [d for d, value in zip(days, archive["topN"]["5"]["combined"]["longSum"]) if value is not None]
        require(entry.get("latestDate") == common["latestHoldingDate"] == max(holding_days, default=None), "holding date mismatch")
        require(common["missingHoldingDates"] == [d for d in days if d not in set(holding_days)], "missing trading days differ")
        if entry["latestDate"]:
            dated.append(entry["latestDate"])
            if entry["latestDate"] >= (date.fromisoformat(quote_date) - timedelta(days=45)).isoformat() and common["latestPriceDate"] == quote_date:
                expected_varieties.append(variety)
                if entry["latestDate"] != quote_date:
                    missing_varieties.append(variety)
        for seat in common["seats"]:
            for field in ("net", "contractLong", "contractShort", "longRank", "shortRank"):
                vector(seat[field], width)
        require(set(entry["members"]).issubset({variety} | contract_sets[0]), "unknown member scope")
        if holding_days:
            require({variety} | contract_sets[0] == set(entry["members"]), "member scopes are incomplete")
        for scope, ref in entry["members"].items():
            require(ref["file"] == f"{variety}/members/{scope}.json", "member identity mismatch")
            members = load(ref)
            require(members.get("formatVersion") == 1 and members.get("variety") == variety and members.get("scopeCode") == scope, "invalid member archive")
            brokers = members["brokers"]
            require(all(isinstance(b, list) and len(b) == 3 and isinstance(b[0], str) and b[0] for b in brokers), "invalid broker dictionary")
            seen = set()
            for row in members["rows"]:
                require(isinstance(row, list) and len(row) == 5, "invalid member tuple")
                day, broker, net, long_rank, short_rank = row
                require(isinstance(day, int) and 0 <= day < width and isinstance(broker, int) and 0 <= broker < len(brokers), "invalid member index")
                require(number(net) and net is not None and all(v is None or isinstance(v, int) and v >= 1 for v in (long_rank, short_rank)), "invalid net position or rank")
                require((long_rank is None or net > 0) and (short_rank is None or net < 0), "rank side differs from net position")
                identity = (day, brokers[broker][0])
                require(identity not in seen, "duplicate broker/day")
                seen.add(identity)
            total_rows += len(members["rows"])
    require(index.get("latestDate") == summary.get("latestDate") == max(dated, default=None), "archive holding date differs")
    require(summary.get("varieties") == len(varieties), "archive variety count differs")
    require({str(p.relative_to(root)) for p in root.rglob("*") if p.is_file()} == referenced, "archive contains unreferenced files")
    sample_variety = "FU" if "FU" in index["varieties"] else sorted(varieties)[0]
    sample = index["varieties"][sample_variety]
    member_sample = list(sample["members"].values())[:2]
    return {"latestDate": index["latestDate"], "varieties": len(varieties), "memberRows": total_rows,
            "coverage": {"status": "ok" if expected_varieties and not missing_varieties else "partial", "missingVarieties": sorted(missing_varieties)},
            "verificationFiles": ["holdings/index.json", f"holdings/{sample['file']}", *[f"holdings/{ref['file']}" for ref in member_sample]]}
