import importlib.util
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
                "charts": [{"code": "LU_FU", "name": "LU-FU"}],
            })
        if path == "/api/cross-spreads/LU_FU":
            return FakeResponse({
                "code": "LU_FU",
                "name": "LU-FU",
                "monthSeries": [],
                "dominantSeries": [],
            })
        if path.startswith("/api/spreads/fixed-contract"):
            return FakeResponse({
                "variety": "JD",
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
            "specialSpreads": [{"spreadCode": "JD_01_05", "seriesByYear": {}}],
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
        self.assertEqual(detail["code"], "LU_FU")
        self.assertEqual(report["charts"], 1)
        self.assertEqual(report["details"], 1)


if __name__ == "__main__":
    unittest.main()
