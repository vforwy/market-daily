import importlib.util
import copy
import json
import tempfile
import unittest
import sys
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "export_snapshot.py"
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("export_snapshot", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class FakeResponse:
    status_code = 200

    def __init__(self, payload):
        self.payload = payload

    def get_json(self):
        return self.payload


class FakeClient:
    def get(self, path):
        if path == "/api/cross-spreads/overview":
            return FakeResponse({
                "latestDate": "2026-07-20",
                "charts": [{"code": "LU_FU", "name": "LU-FU", "priceBasis": "raw_close"}],
            })
        if path == "/api/cross-spreads/LU_FU":
            return FakeResponse({
                "code": "LU_FU",
                "name": "LU-FU",
                "priceBasis": "raw_close",
                "monthSeries": [],
                "dominantSeries": [],
            })
        if path.startswith("/api/spreads/fixed-contract"):
            return FakeResponse({
                "variety": "JD",
                "priceBasis": "raw_close",
                "historyStart": "2026-01-01",
                "charts": [{"nearCode": "JD2608.DCE", "series": []}],
                "selectableCharts": [{
                    "nearCode": "JD2601.DCE",
                    "series": [{"farCode": "JD2602.DCE", "points": [{"d": "2026-01-05", "v": 100}]}],
                }],
            })
        return FakeResponse({
            "spreads": [{"spreadCode": "JD_L1_L2", "seriesByYear": {}}],
            "monthlySpreads": [{"spreadCode": "JD_L1_L2", "seriesByYear": {}}],
            "specialSpreads": [{"spreadCode": "JD_01_05", "priceBasis": "raw_close", "seriesByYear": {}}],
        })


class CompleteSnapshotClient:
    def __init__(self, data_dir, fail_detail=False):
        self.root = data_dir
        self.fail_detail = fail_detail

    def read(self, relative):
        return json.loads((self.root / relative).read_text())

    def get(self, url):
        path = urlsplit(url).path
        query = parse_qs(urlsplit(url).query)
        snapshot = self.read("snapshot.json")
        if path == "/api/commodity-config":
            value = snapshot["commodityConfig"]
        elif path == "/api/klines/batch":
            value = snapshot["klineBatches"][query["kind"][0]]
        elif path == "/api/term-structure/matrix":
            value = snapshot["termStructureMatrix"]
        elif path == "/api/kline/options":
            kline = self.read("klines/BU.json")
            value = {"options": kline["options"], "selected": kline["selected"]}
        elif path == "/api/kline":
            value = self.read("klines/BU.json")["contracts"][query["code"][0]]
        elif path == "/api/spreads/seasonal":
            value = self.read("spreads/BU.json")[query["priceMode"][0]]
        elif path == "/api/spreads/fixed-contract":
            value = self.read("spreads/BU.json")["fixedContract"]
        elif path == "/api/cross-spreads/overview":
            value = self.read("cross-spreads/overview.json")
        elif path == "/api/cross-spreads/LU_FU":
            if self.fail_detail:
                raise RuntimeError("detail request interrupted")
            value = self.read("cross-spreads/LU_FU.json")
        else:
            raise AssertionError(path)
        return FakeResponse(value)


class ExportSnapshotTest(unittest.TestCase):
    def test_delivery_seasonality_keeps_all_common_quotes_and_leg_metadata(self):
        points = [{
            "x": f"01-{day:02d}", "d": f"2025-01-{day:02d}", "v": 10,
            "instance": "JD2601-JD2605", "leg1": "JD2601.DCE", "leg2": "JD2605.DCE",
            "leg1Price": 100, "leg2Price": 90, "ratio": 100 / 90,
        } for day in range(1, 13)]
        info = {"instance": "JD2601-JD2605", "leg1": "JD2601.DCE", "leg2": "JD2605.DCE",
                "firstDate": points[0]["d"], "lastDate": points[-1]["d"], "pointCount": len(points)}
        chart = {"seasonAxis": "delivery-year", "seriesByYear": {"2026": points},
                 "priceBasis": "raw_close", "seriesMetaByYear": {"2026": info}}
        payload = {"spreads": [copy.deepcopy(chart)], "monthlySpreads": [copy.deepcopy(chart)],
                   "specialSpreads": [copy.deepcopy(chart)]}
        exported = MODULE.compact_spreads(payload)
        self.assertEqual(exported["specialSpreads"][0], chart)
        self.assertEqual(exported["spreads"], [])
        self.assertEqual(exported["monthlySpreads"], [])

    def test_legacy_seasonality_keeps_its_existing_sampling_policy(self):
        points = [{"x": f"01-{day:02d}", "d": f"2025-01-{day:02d}", "v": day,
                   "instance": "JD2501-JD2505", "leg1": "JD2501.DCE"} for day in range(1, 13)]
        exported = MODULE.compact_spreads({"specialSpreads": [{"seriesByYear": {"2025": points}}]})
        actual = exported["specialSpreads"][0]["seriesByYear"]["2025"]
        self.assertEqual([point["d"] for point in actual], [points[index]["d"] for index in (0, 5, 10, 11)])
        self.assertNotIn("leg1", actual[0])

    def test_full_export_uses_validated_generation_and_reports_final_path(self):
        from test_snapshot_contract import make_snapshot
        from snapshot_contract import validate_snapshot

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            source = root / "source"
            make_snapshot(source)
            output = root / "data/snapshot.json"
            with patch.object(MODULE, "_source_client", return_value=CompleteSnapshotClient(source)):
                report = MODULE.export_snapshot(root, output)
            self.assertEqual(report["output"], str(output))
            self.assertEqual(report["varieties"], 1)
            self.assertEqual(validate_snapshot(output.parent)["crossSpreads"], 1)
            self.assertEqual(report["views"]["files"], 4)
            snapshot = json.loads(output.read_text())
            manifest = json.loads((output.parent / "manifest.json").read_text())
            self.assertEqual(manifest, {"formatVersion": 2, "meta": snapshot["meta"],
                                       "commodityConfig": snapshot["commodityConfig"]})
            self.assertEqual(json.loads((output.parent / "term-structure.json").read_text()),
                             {"meta": snapshot["meta"], "data": snapshot["termStructureMatrix"]})

    def test_full_export_preserves_delivery_pair_history_in_both_legacy_price_mode_slots(self):
        from test_snapshot_contract import delivery_seasonal_chart, make_snapshot, write_json

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            source = root / "source"
            make_snapshot(source)
            chart = delivery_seasonal_chart()
            spread_path = source / "spreads/BU.json"
            spreads = json.loads(spread_path.read_text())
            for mode in ("raw", "adjusted"):
                spreads[mode].update(years=[2026], specialSpreads=[copy.deepcopy(chart)])
            write_json(spread_path, spreads)
            output = root / "data/snapshot.json"
            with patch.object(MODULE, "_source_client", return_value=CompleteSnapshotClient(source)):
                MODULE.export_snapshot(root, output)
            exported = json.loads((output.parent / "spreads/BU.json").read_text())
            for mode in ("raw", "adjusted"):
                self.assertEqual(exported[mode]["specialSpreads"], [chart])
                self.assertEqual(exported[mode]["specialSpreads"][0]["priceBasis"], "raw_close")

    def test_full_export_detail_failure_preserves_former_tree(self):
        from test_snapshot_contract import make_snapshot, tree_bytes

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            source, target = root / "source", root / "data"
            make_snapshot(source, "new")
            make_snapshot(target, "old")
            previous = tree_bytes(target)
            with patch.object(MODULE, "_source_client", return_value=CompleteSnapshotClient(source, fail_detail=True)):
                with self.assertRaisesRegex(RuntimeError, "interrupted"):
                    MODULE.export_snapshot(root, target / "snapshot.json")
            self.assertEqual(tree_bytes(target), previous)

    def test_full_export_rejects_settlement_spreads_without_replacing_existing_generation(self):
        from test_snapshot_contract import delivery_seasonal_chart, make_snapshot, tree_bytes, write_json
        from snapshot_contract import SnapshotValidationError

        for kind in ("fixed", "special", "cross"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary).resolve()
                source, target = root / "source", root / "data"
                make_snapshot(source, "new")
                make_snapshot(target, "old")
                relative = "cross-spreads/LU_FU.json" if kind == "cross" else "spreads/BU.json"
                payload = json.loads((source / relative).read_text())
                if kind == "fixed":
                    payload["fixedContract"]["priceBasis"] = "raw_settle"
                elif kind == "special":
                    chart = delivery_seasonal_chart()
                    chart["priceBasis"] = "raw_settle"
                    payload["adjusted"].update(years=[2026], specialSpreads=[chart])
                else:
                    payload["priceBasis"] = "raw_settle"
                write_json(source / relative, payload)
                previous = tree_bytes(target)
                with patch.object(MODULE, "_source_client", return_value=CompleteSnapshotClient(source)):
                    with self.assertRaises(SnapshotValidationError):
                        MODULE.export_snapshot(root, target / "snapshot.json")
                self.assertEqual(tree_bytes(target), previous)

    def test_view_export_rejects_symlinks_without_overwriting_external_targets(self):
        from test_snapshot_contract import make_snapshot, tree_bytes
        from snapshot_contract import SnapshotValidationError

        for relative in ("manifest.json", "term-structure.json", "kline-batches"):
            with self.subTest(relative=relative), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary).resolve()
                source, target = root / "source", root / "data"
                make_snapshot(source)
                make_snapshot(target)
                outside = root / "outside"
                if relative == "kline-batches":
                    outside.mkdir()
                    (outside / "keep.txt").write_bytes(b"not public data")
                else:
                    outside.write_bytes(b"not public data")
                (target / relative).symlink_to(outside, target_is_directory=outside.is_dir())
                previous = tree_bytes(root)
                with patch.object(MODULE, "_source_client", return_value=CompleteSnapshotClient(source)):
                    with self.assertRaisesRegex(SnapshotValidationError, "symlink"):
                        MODULE.export_snapshot(root, target / "snapshot.json")
                current = tree_bytes(root)
                current.pop(".snapshot-data.lock", None)
                self.assertEqual(current, previous)

    def test_pages_export_has_no_public_account_payload(self):
        source = SCRIPT.read_text(encoding="utf-8")

        self.assertNotIn("/api/articles/", source)
        self.assertNotIn("craps.json", source)

    def test_export_spreads_includes_fixed_contract_payload(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "spreads"
            report = MODULE.export_spreads(FakeClient(), output, ["JD"])
            payload = json.loads((output / "JD.json").read_text(encoding="utf-8"))

        self.assertEqual(payload["fixedContract"]["historyStart"], "2026-01-01")
        self.assertEqual(payload["fixedContract"]["priceBasis"], "raw_close")
        self.assertEqual(payload["fixedContract"]["charts"][0]["nearCode"], "JD2608.DCE")
        historical = payload["fixedContract"]["selectableCharts"][0]
        self.assertEqual(historical["nearCode"], "JD2601.DCE")
        self.assertEqual(historical["series"][0]["points"], [{"d": "2026-01-05", "v": 100}])
        self.assertEqual(payload["raw"]["monthlySpreads"], [])
        self.assertEqual(payload["raw"]["spreads"], [])
        self.assertEqual(payload["raw"]["specialSpreads"][0]["spreadCode"], "JD_01_05")
        self.assertEqual(report["fixedCharts"], 1)

    def test_export_cross_spreads_writes_overview_and_lazy_detail(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "cross-spreads"
            report = MODULE.export_cross_spreads(FakeClient(), output)
            overview = json.loads((output / "overview.json").read_text(encoding="utf-8"))
            detail = json.loads((output / "LU_FU.json").read_text(encoding="utf-8"))

        self.assertEqual(overview["charts"][0]["code"], "LU_FU")
        self.assertEqual(overview["charts"][0]["priceBasis"], "raw_close")
        self.assertEqual(detail["code"], "LU_FU")
        self.assertEqual(detail["priceBasis"], "raw_close")
        self.assertEqual(report["charts"], 1)
        self.assertEqual(report["details"], 1)


if __name__ == "__main__":
    unittest.main()
