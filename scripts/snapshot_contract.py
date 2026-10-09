"""The Public Snapshot contract, shared by generation, publication and offline tests.

No Flask, database or credential imports belong here. Generation happens privately;
only a fully validated directory is promoted, with recovery before Git preflight.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import tempfile
from typing import Callable
import uuid


class SnapshotValidationError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise SnapshotValidationError(message)


def _object(value, label: str) -> dict:
    _require(isinstance(value, dict), f"{label} must be an object")
    return value


def _list(value, label: str) -> list:
    _require(isinstance(value, list), f"{label} must be a list")
    return value


def _date(value, label: str) -> str:
    try:
        parsed = date.fromisoformat(value)
    except (TypeError, ValueError):
        raise SnapshotValidationError(f"{label} must be an ISO date") from None
    _require(parsed.isoformat() == value, f"{label} must be YYYY-MM-DD")
    return value


def _number(value, label: str) -> None:
    try:
        valid = value is None or (
            isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
        )
    except OverflowError:
        valid = False
    _require(valid, f"{label} must be finite or null")


def _read(path: Path) -> dict:
    _require(not path.is_symlink(), f"snapshot JSON must not be a symlink: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise SnapshotValidationError(f"invalid JSON {path}: {error}") from error
    return _object(value, str(path))


def _points(value, label: str, latest: str, *, earliest: str = "", fields=("v",)) -> int:
    points = _list(value, label)
    previous = ""
    for index, raw in enumerate(points):
        point = _object(raw, f"{label}[{index}]")
        day = _date(point.get("d"), f"{label}[{index}].d")
        _require(previous < day <= latest and (not earliest or day >= earliest),
                 f"{label} dates must be unique, ascending and within its history")
        previous = day
        for field in fields:
            _require(field in point, f"{label} point is missing {field}")
            _number(point[field], f"{label}.{field}")
    return len(points)


def _contract_month(code: str, variety: str, latest: str) -> int:
    match = re.fullmatch(rf"{re.escape(variety)}(\d{{3,4}})\.[A-Z]+", str(code))
    _require(match is not None, f"invalid {variety} contract: {code}")
    digits = match.group(1)
    month = int(digits[-2:])
    _require(1 <= month <= 12, f"invalid delivery month: {code}")
    if len(digits) == 4:
        year = 2000 + int(digits[:2])
    else:
        anchor = int(latest[:4])
        year = anchor // 10 * 10 + int(digits[0])
        if year < anchor - 5:
            year += 10
        elif year > anchor + 5:
            year -= 10
    return year * 100 + month


def _structure_points(value, label: str) -> None:
    months = []
    for raw in _list(value, label):
        point = _object(raw, label)
        month = point.get("month")
        _require(isinstance(month, str) and re.fullmatch(r"\d{6}", month) is not None
                 and 1 <= int(month[-2:]) <= 12, f"{label} has an invalid delivery month")
        months.append(month)
        _require("v" in point, f"{label} point is missing v")
        for field in ("v", "leg1Price", "leg2Price"):
            if field in point:
                _number(point[field], f"{label}.{field}")
    _require(months == sorted(set(months)), f"{label} months must be unique and ascending")


def _term_matrix(matrix: dict, varieties: list[str], latest: str) -> None:
    _require(matrix.get("latestDate") == latest, "term structure and snapshot dates differ")
    codes = []
    for raw in _list(matrix.get("charts"), "termStructureMatrix.charts"):
        chart = _object(raw, "term structure chart")
        code = chart.get("code")
        _require(isinstance(code, str) and code in varieties, "invalid term structure variety")
        codes.append(code)
        chart_latest = _date(chart.get("latestDate"), f"{code}.latestDate")
        _require(chart_latest <= latest, f"{code} term structure date is in the future")
        dates = _list(chart.get("dates"), f"{code}.dates")
        for day in dates:
            _date(day, f"{code}.dates")
            _require(day <= chart_latest, f"{code} term structure history is in the future")
        _require(bool(dates) and dates == sorted(set(dates), reverse=True) and dates[0] == chart_latest,
                 f"{code} term structure dates must be unique and newest first")
        months = _list(chart.get("months"), f"{code}.months")
        _require(bool(months) and all(isinstance(month, str) for month in months)
                 and len(months) == len(set(months)), f"{code} term structure months are empty or duplicated")
        for field in ("seriesByDate", "closeSeriesByDate", "settleSeriesByDate"):
            series = _object(chart.get(field), f"{code}.{field}")
            _require(set(series) == set(dates), f"{code}.{field} dates differ from chart")
            for day, values in series.items():
                values = _object(values, f"{code}.{field}.{day}")
                _require(set(values) == set(months), f"{code}.{field} months differ from chart")
                for month, value in values.items():
                    _number(value, f"{code}.{field}.{day}.{month}")
    _require(len(codes) == len(set(codes)) and set(codes) == set(varieties),
             "term structure charts must exactly match enabled varieties")


def _fixed_charts(charts, variety: str, latest: str, history_start: str, label: str) -> list[int]:
    months = []
    for raw in _list(charts, label):
        chart = _object(raw, label)
        near = str(chart.get("nearCode", ""))
        month = _contract_month(near, variety, latest)
        _require(month not in months, f"{label} repeats {near}")
        months.append(month)
        series = _list(chart.get("series"), f"{label}.{near}.series")
        _require(0 < len(series) <= 5, f"{near} must have 1 to 5 far legs")
        far_months = []
        has_value = False
        for raw_series in series:
            item = _object(raw_series, f"{near}.series")
            far = str(item.get("farCode", ""))
            far_month = _contract_month(far, variety, latest)
            _require(far_month > month and far_month not in far_months, f"invalid or duplicate far leg {near}-{far}")
            far_months.append(far_month)
            points = item.get("points")
            _points(points, f"{near}-{far}", latest, earliest=history_start,
                    fields=("v", "nearPrice", "farPrice"))
            for point in points:
                if point["v"] is not None:
                    _require(point["nearPrice"] is not None and point["farPrice"] is not None,
                             f"{near}-{far} has a value without both leg prices")
                    _require(math.isclose(point["v"], point["nearPrice"] - point["farPrice"],
                                          rel_tol=1e-9, abs_tol=0.0001),
                             f"{near}-{far} is not near price minus far price")
                    has_value = True
        _require(far_months == sorted(far_months), f"{near} far legs are not in maturity order")
        _require(has_value, f"{near} chart has no usable spread points")
    _require(months == sorted(months), f"{label} is not in maturity order")
    return months


def _delivery_seasonal(chart: dict, series: dict, variety: str, latest: str) -> None:
    """A year denotes one near-delivery-year pair, never a rolled trade-year series."""
    _require(chart.get("spreadType") == "calendar_month" and chart.get("priceBasis") == "raw_settle",
             "delivery seasonality must use calendar-month raw settlement pairs")
    near_month, far_month = chart.get("nearMonth"), chart.get("farMonth")
    for month in (near_month, far_month):
        _require(isinstance(month, str) and re.fullmatch(r"0[1-9]|1[0-2]", month) is not None,
                 "delivery seasonality months must be two-digit calendar months")
    offset = chart.get("farYearOffset")
    _require(isinstance(offset, int) and not isinstance(offset, bool)
             and offset == int(far_month <= near_month), "delivery seasonality has an invalid far-year offset")
    _require(chart.get("spreadCode") == f"{variety}_{near_month}_{far_month}",
             "delivery seasonal spread code and months differ")
    metadata = _object(chart.get("seriesMetaByYear"), "seriesMetaByYear")
    populated = {year for year, points in series.items() if points}
    _require(set(metadata) == populated, "delivery seasonality metadata must match nonempty series")
    last_points = []
    for year, points in series.items():
        _require(isinstance(year, str) and re.fullmatch(r"[0-9]{4}", year) is not None
                 and 2000 <= int(year) <= 2099, "invalid seasonal delivery year")
        if not points:
            continue
        info = _object(metadata[year], f"seriesMetaByYear.{year}")
        near, far = info.get("leg1"), info.get("leg2")
        # Three-digit CZCE codes repeat every decade; this series' delivery year,
        # not the current snapshot year, is the only appropriate decoding anchor.
        near_delivery = _contract_month(near, variety, f"{year}-01-01")
        far_year = int(year) + offset
        far_delivery = _contract_month(far, variety, f"{far_year}-01-01")
        _require(near_delivery == int(year) * 100 + int(near_month)
                 and far_delivery == far_year * 100 + int(far_month),
                 "delivery seasonal legs differ from the series year or template months")
        instance = f"{near.split('.', 1)[0]}-{far.split('.', 1)[0]}"
        _require(info.get("instance") == instance, "delivery seasonal metadata instance and legs differ")
        count = info.get("pointCount")
        _require(isinstance(count, int) and not isinstance(count, bool) and count == len(points),
                 "delivery seasonal point count differs from complete history")
        _require(info.get("firstDate") == points[0]["d"] and info.get("lastDate") == points[-1]["d"],
                 "delivery seasonal first/last date differs from shared quote history")
        for point in points:
            _require(point.get("leg1") == near and point.get("leg2") == far
                     and point.get("instance") == instance, "delivery seasonal series rolls its fixed instance")
            _require(point.get("x") == point["d"][5:], "delivery seasonal calendar label differs from trade date")
            for field in ("leg1Price", "leg2Price"):
                _require(field in point, f"delivery seasonal point is missing {field}")
                _number(point[field], f"delivery seasonal {field}")
            _require(point["v"] is not None and point["leg1Price"] is not None and point["leg2Price"] is not None,
                     "delivery seasonal point requires both shared quote prices")
            _require(math.isclose(point["v"], point["leg1Price"] - point["leg2Price"],
                                  rel_tol=1e-9, abs_tol=0.0001), "delivery seasonal value is not near minus far")
            if "ratio" in point:
                _number(point["ratio"], "delivery seasonal ratio")
        last_points.append(points[-1])
    if last_points:
        last_date = max(point["d"] for point in last_points)
        _require(chart.get("latestDate") == last_date and last_date <= latest,
                 "delivery seasonal latest date differs from its history")
        _require(chart.get("latestInstance") in {point["instance"] for point in last_points if point["d"] == last_date},
                 "delivery seasonal latest instance differs from its history")
    else:
        _require(chart.get("latestDate") == "" and chart.get("latestInstance") == "",
                 "empty delivery seasonality cannot claim a latest quote")


def _spreads(payload: dict, variety: str, latest: str) -> tuple[int, int]:
    for mode in ("raw", "adjusted"):
        seasonal = _object(payload.get(mode), f"{variety}.{mode}")
        _require(seasonal.get("variety") == variety and seasonal.get("priceMode") == mode,
                 f"{variety}.{mode} identity mismatch")
        years = _list(seasonal.get("years"), f"{variety}.{mode}.years")
        _require(all(isinstance(year, int) and not isinstance(year, bool) for year in years),
                 f"{variety}.{mode}.years must contain integers")
        # No special template, and no historical near leg, are both legitimate empties.
        for key in ("spreads", "monthlySpreads", "specialSpreads"):
            _list(seasonal.get(key), f"{variety}.{mode}.{key}")
        for raw_chart in seasonal["specialSpreads"]:
            chart = _object(raw_chart, f"{variety}.{mode}.specialSpreads")
            series = _object(chart.get("seriesByYear"), "seriesByYear")
            for year, points in series.items():
                _require(str(year) in {str(y) for y in years}, "seasonal series year is absent from years")
                _points(points, f"{variety}.{mode}.{year}", latest)
            if "seasonAxis" in chart:
                _require(chart["seasonAxis"] == "delivery-year", "invalid seasonal axis basis")
                _delivery_seasonal(chart, series, variety, latest)
    fixed = _object(payload.get("fixedContract"), f"{variety}.fixedContract")
    _require(fixed.get("variety") == variety and fixed.get("priceBasis") == "raw_settle",
             f"{variety} fixed-contract identity or price basis mismatch")
    start = _date(fixed.get("historyStart"), f"{variety}.historyStart")
    charts = _list(fixed.get("charts"), f"{variety}.charts")
    historical = _list(fixed.get("selectableCharts"), f"{variety}.selectableCharts")
    _require(len(charts) <= 4, f"{variety} overview contains more than four near legs")
    if not charts:
        _require(not historical and bool(fixed.get("unavailableReason")),
                 f"{variety} empty fixed-contract result must explain unavailability")
        return 0, 0
    fixed_latest = _date(fixed.get("latestDate"), f"{variety}.latestDate")
    _require(start <= fixed_latest <= latest, f"{variety} fixed history date mismatch")
    _contract_month(fixed.get("dominantCode", ""), variety, fixed_latest)
    overview_months = _fixed_charts(charts, variety, fixed_latest, start, f"{variety}.charts")
    history_months = _fixed_charts(historical, variety, fixed_latest, start, f"{variety}.selectableCharts")
    _require(all(month < overview_months[0] for month in history_months),
             f"{variety} historical choices extend into or beyond the overview")
    return len(charts), len(historical)


def snapshot_view_payloads(snapshot: dict) -> dict[str, dict]:
    """Project the canonical snapshot into lazy views without recalculating data."""
    meta = snapshot["meta"]
    return {
        "manifest.json": {"formatVersion": 2, "meta": meta,
                          "commodityConfig": snapshot["commodityConfig"]},
        **{f"kline-batches/{kind}.json": {"meta": meta, "data": snapshot["klineBatches"][kind]}
           for kind in ("contract", "dominant_continuous")},
        "term-structure.json": {"meta": meta, "data": snapshot["termStructureMatrix"]},
    }


def _validate_views(data_dir: Path, snapshot: dict) -> list[str]:
    manifest = data_dir / "manifest.json"
    if not manifest.exists() and not manifest.is_symlink():
        _require(not (data_dir / "kline-batches").exists()
                 and not (data_dir / "kline-batches").is_symlink()
                 and not (data_dir / "term-structure.json").exists()
                 and not (data_dir / "term-structure.json").is_symlink(),
                 "lazy snapshot views require manifest.json")
        return []  # V1 snapshots remain usable during a cross-machine rollout.
    directory = data_dir / "kline-batches"
    _require(not directory.is_symlink(), "kline-batches must not be a symlink")
    _require({path.name for path in directory.glob("*.json")} ==
             {"contract.json", "dominant_continuous.json"}, "K-line views must contain exactly both kinds")
    views = snapshot_view_payloads(snapshot)
    for relative, expected in views.items():
        payload = _read(data_dir / relative)
        # JSON comparison is type-sensitive: True must not equal a canonical price of 1.
        _require(json.dumps(payload, sort_keys=True) == json.dumps(expected, sort_keys=True),
                 f"{relative} differs from the canonical snapshot")
    return list(views)


def validate_snapshot(data_dir: Path, expected_date: str | None = None) -> dict:
    """Validate content, not just file presence; no dependency on the live database."""
    data_dir = Path(data_dir)
    snapshot = _read(data_dir / "snapshot.json")
    meta = _object(snapshot.get("meta"), "snapshot.meta")
    latest = _date(meta.get("latestDate"), "snapshot.latestDate")
    try:
        datetime.fromisoformat(meta.get("generatedAt"))
    except (TypeError, ValueError):
        raise SnapshotValidationError("snapshot.generatedAt must be an ISO timestamp") from None
    _require(expected_date is None or latest == expected_date, "snapshot date does not match pipeline target")
    config = _object(snapshot.get("commodityConfig"), "commodityConfig")
    items = _list(config.get("items"), "commodityConfig.items")
    varieties = [str(item.get("code", "")).upper() for item in items
                 if isinstance(item, dict) and item.get("enabled", True) and item.get("code")]
    _require(bool(varieties) and len(varieties) == len(set(varieties)), "enabled varieties are empty or duplicated")
    _require(all(re.fullmatch(r"[A-Z]+", variety) for variety in varieties), "invalid enabled variety code")
    for directory in ("klines", "spreads"):
        _require(not (data_dir / directory).is_symlink(), f"{directory} must not be a symlink")
        files = {path.stem for path in (data_dir / directory).glob("*.json")}
        _require(files == set(varieties), f"{directory} files must exactly match enabled varieties")
    batches = _object(snapshot.get("klineBatches"), "klineBatches")
    for kind in ("contract", "dominant_continuous"):
        batch = _object(batches.get(kind), f"klineBatches.{kind}")
        _require(bool(batch), f"klineBatches.{kind} is empty")
        if kind == "dominant_continuous":
            _require(set(batch) == set(varieties), "dominant batch must cover every enabled variety")
        for code, entry in batch.items():
            count = _points(_object(entry, str(code)).get("bars"), f"batch.{code}.bars", latest, fields=("o", "h", "l", "c", "v"))
            _require(count > 0, f"batch {code} has no K-line bars")
    matrix = _object(snapshot.get("termStructureMatrix"), "termStructureMatrix")
    _term_matrix(matrix, varieties, latest)
    view_files = _validate_views(data_dir, snapshot)

    contracts = bars = fixed_charts = historical_charts = 0
    for variety in varieties:
        kline = _read(data_dir / "klines" / f"{variety}.json")
        _require(kline.get("variety") == variety, f"{variety} K-line identity mismatch")
        options = _list(kline.get("options"), f"{variety}.options")
        selected = _object(kline.get("selected"), f"{variety}.selected")
        concrete = _object(kline.get("contracts"), f"{variety}.contracts")
        _require(any(isinstance(option, dict) and option.get("kind") == selected.get("kind")
                     and option.get("value") == selected.get("value") for option in options),
                 f"{variety} selected K-line option is missing")
        seen = set()
        for raw in options:
            option = _object(raw, f"{variety}.option")
            if option.get("kind") != "contract":
                continue
            code = str(option.get("value", ""))
            _contract_month(code, variety, latest)
            _require(code not in seen, f"{variety} repeats K-line option {code}")
            seen.add(code)
            count = _points(concrete.get(code), code, latest, fields=("o", "h", "l", "c", "v"))
            _require(count > 0, f"active contract {code} has no K-line bars")
            contracts += 1
            bars += count
        counts = _spreads(_read(data_dir / "spreads" / f"{variety}.json"), variety, latest)
        fixed_charts += counts[0]
        historical_charts += counts[1]

    _require(not (data_dir / "cross-spreads").is_symlink(), "cross-spreads must not be a symlink")
    overview = _read(data_dir / "cross-spreads" / "overview.json")
    _require(overview.get("latestDate") == latest, "cross-spread overview and snapshot dates differ")
    cross_charts = _list(overview.get("charts"), "cross-spread overview.charts")
    _require(bool(cross_charts), "cross-spread overview is empty")
    codes = set()
    for raw in cross_charts:
        chart = _object(raw, "cross-spread chart")
        code = str(chart.get("code", ""))
        _require(re.fullmatch(r"[A-Z0-9_]+", code) is not None and code not in codes, "invalid or duplicate cross-spread code")
        codes.add(code)
        chart_latest = _date(chart.get("latestDate"), f"{code}.latestDate")
        _require(chart_latest <= latest, f"{code} overview date is in the future")
        for field in ("fixedSeries", "dominantSeries"):
            _points(chart.get(field), f"{code}.{field}", chart_latest)
        detail = _read(data_dir / "cross-spreads" / f"{code}.json")
        _require(detail.get("code") == code and detail.get("latestDate") == chart_latest,
                 f"{code} detail identity/date mismatch")
        usable = False
        for field in ("dominantSeries", "adjustedDominantSeries"):
            _points(detail.get(field), f"{code}.{field}", chart_latest)
            usable |= any(point["v"] is not None for point in detail[field])
        for series in _list(detail.get("monthSeries"), f"{code}.monthSeries"):
            points = _object(series, "monthSeries").get("points")
            _points(points, f"{code}.monthSeries.points", chart_latest)
            usable |= any(point["v"] is not None for point in points)
        _structure_points(detail.get("structure"), f"{code}.structure")
        previous = ""
        history = _list(detail.get("structureHistory"), f"{code}.structureHistory")
        _require(len(history) <= 5, f"{code} structure history exceeds five dates")
        for raw_history in history:
            item = _object(raw_history, f"{code}.structureHistory")
            day = _date(item.get("date"), f"{code}.structureHistory.date")
            _require(previous < day <= chart_latest, f"{code} structure history dates must be ascending and not future")
            previous = day
            _structure_points(item.get("points"), f"{code}.structureHistory.{day}")
        _require(usable or bool(detail.get("unavailableReason")), f"{code} detail contains no usable curves or reason")
    actual = {path.stem for path in (data_dir / "cross-spreads").glob("*.json") if path.name != "overview.json"}
    _require(actual == codes, "cross-spread detail files do not match overview")
    # A small representative sample is sufficient to detect a stale/partial deployed detail;
    # every local artifact has already passed the complete contract above.
    variety = "BU" if "BU" in varieties else sorted(varieties)[0]
    sample = ["snapshot.json", f"spreads/{variety}.json", f"klines/{variety}.json",
              "cross-spreads/overview.json", f"cross-spreads/{sorted(codes)[0]}.json", *view_files]
    hashes = {relative: hashlib.sha256((data_dir / relative).read_bytes()).hexdigest() for relative in sample}
    return {"latestDate": latest, "generatedAt": meta["generatedAt"], "varieties": len(varieties),
            "contracts": contracts, "bars": bars, "crossSpreads": len(codes),
            "fixedCharts": fixed_charts, "historicalCharts": historical_charts, "verificationFiles": hashes}


def _destination(data_dir: Path) -> Path:
    data_dir = Path(data_dir).absolute()
    _require(not data_dir.is_symlink(), "snapshot destination must not be a symlink")
    _require(re.fullmatch(r"[A-Za-z0-9_-]+", data_dir.name) is not None, "unsafe snapshot directory name")
    data_dir = data_dir.parent.resolve() / data_dir.name
    _require(data_dir not in {Path.home(), *Path(__file__).resolve().parents}, "unsafe snapshot destination")
    _require(not data_dir.exists() or data_dir.is_dir(), "snapshot destination is not a directory")
    if data_dir.exists() and any(data_dir.iterdir()):
        snapshot_path = data_dir / "snapshot.json"
        _require(not snapshot_path.is_symlink(), "snapshot.json must not be a symlink")
        _require(snapshot_path.is_file(), "nonempty destination is not a Public Snapshot")
    return data_dir


@contextmanager
def _snapshot_lock(data_dir: Path):
    data_dir.parent.mkdir(parents=True, exist_ok=True)
    with (data_dir.parent / f".snapshot-{data_dir.name}.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SnapshotValidationError("another snapshot export or recovery is running") from None
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def _journal_path(data_dir: Path) -> Path:
    return data_dir.parent / f".snapshot-{data_dir.name}-transaction.json"


def _sync_parent(path: Path) -> None:
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _write_journal(path: Path, payload: dict) -> None:
    fd, name = tempfile.mkstemp(prefix=f"{path.stem}-", suffix=".tmp", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        _sync_parent(path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _owned_path(data_dir: Path, raw: str, kind: str) -> Path:
    _require(isinstance(raw, str) and bool(raw), "invalid snapshot recovery path")
    path = Path(raw)
    _require(path.is_absolute() and path.parent == data_dir.parent and not path.is_symlink()
             and path.name.startswith(f".snapshot-{data_dir.name}-{kind}-"),
             "unsafe snapshot recovery path")
    _require(not path.exists() or path.is_dir(), "snapshot recovery artifact must be a directory")
    return path


def _remove_owned(path: Path) -> None:
    if path.exists():
        _require(path.is_dir() and not path.is_symlink(), "recovery artifact is not a directory")
        shutil.rmtree(path)


def _recover_snapshot(data_dir: Path) -> bool:
    journal_path = _journal_path(data_dir)
    if not journal_path.exists():
        return False
    journal = _read(journal_path)
    _require(journal.get("version") == 1 and journal.get("target") == str(data_dir), "snapshot journal target mismatch")
    _require(journal.get("state") in {"prepared", "committed", "rolledBack"}
             and isinstance(journal.get("hadOriginal"), bool), "invalid snapshot journal state")
    stage = _owned_path(data_dir, journal.get("stage", ""), "stage")
    backup = _owned_path(data_dir, journal.get("backup", ""), "backup")
    if journal["state"] == "committed":
        _require(data_dir.is_dir(), "committed snapshot destination is missing")
    elif journal["state"] == "rolledBack":
        _require(data_dir.is_dir() if journal["hadOriginal"] else not data_dir.exists(),
                 "rolled-back snapshot destination does not match journal")
    elif backup.exists():
        # The old generation exists: keep it, even when the new tree was renamed
        # into place before the process died and before its commit marker was durable.
        if data_dir.exists():
            _require(not stage.exists(), "ambiguous snapshot recovery state")
            os.replace(data_dir, stage)
        os.replace(backup, data_dir)
        _sync_parent(data_dir)
    elif journal["hadOriginal"]:
        _require(data_dir.is_dir() and stage.is_dir(), "original snapshot cannot be recovered safely")
    elif data_dir.exists():
        _require(not stage.exists(), "ambiguous first snapshot recovery state")
        os.replace(data_dir, stage)
    if journal["state"] == "prepared":
        # Checkpoint rollback before deleting artifacts. Recovery itself may be
        # interrupted after cleanup; its next run must remain idempotent.
        journal["state"] = "rolledBack"
        _write_journal(journal_path, journal)
    _remove_owned(backup)
    _remove_owned(stage)
    journal_path.unlink()
    _sync_parent(journal_path)
    return True


def recover_snapshot(data_dir: Path) -> bool:
    """Recover a interrupted promotion before Public Git Preflight inspects the tree."""
    # A crash after old->backup legitimately leaves target absent, so validate its
    # location without requiring an existing target before consulting the journal.
    data_dir = _destination(data_dir)
    with _snapshot_lock(data_dir):
        return _recover_snapshot(data_dir)


def publish_snapshot(data_dir: Path, generate: Callable[[Path], dict]) -> dict:
    """Generate and validate privately; promote one generation, never partial files.

    Journaled rename recovery covers process interruption. It is not a database
    transaction or a guarantee against hardware/filesystem corruption.
    """
    data_dir = _destination(data_dir)
    with _snapshot_lock(data_dir):
        _recover_snapshot(data_dir)
        stage = Path(tempfile.mkdtemp(prefix=f".snapshot-{data_dir.name}-stage-", dir=data_dir.parent))
        backup = data_dir.parent / f".snapshot-{data_dir.name}-backup-{uuid.uuid4().hex}"
        journal_path = _journal_path(data_dir)
        try:
            if data_dir.exists():
                # Preserve unrelated files; only the generator's known datasets change.
                shutil.copytree(data_dir, stage, dirs_exist_ok=True, symlinks=True)
            report = generate(stage)
            validate_snapshot(stage)
            journal = {"version": 1, "target": str(data_dir), "stage": str(stage),
                       "backup": str(backup), "hadOriginal": data_dir.exists(), "state": "prepared"}
            _write_journal(journal_path, journal)
            if data_dir.exists():
                os.replace(data_dir, backup)
            os.replace(stage, data_dir)
            _sync_parent(data_dir)
            journal["state"] = "committed"
            _write_journal(journal_path, journal)
            _recover_snapshot(data_dir)
            return report
        except BaseException:
            if journal_path.exists():
                _recover_snapshot(data_dir)
            else:
                _remove_owned(stage)
            raise


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Validate an exported Public Snapshot offline")
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("--expected-date")
    args = parser.parse_args()
    try:
        summary = validate_snapshot(args.data_dir, args.expected_date)
    except SnapshotValidationError as error:
        parser.exit(1, f"Snapshot validation failed: {error}\n")
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
