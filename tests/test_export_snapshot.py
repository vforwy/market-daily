import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "export_snapshot.py"
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
            })
        return FakeResponse({
            "spreads": [{"spreadCode": "JD_L1_L2", "seriesByYear": {}}],
            "monthlySpreads": [{"spreadCode": "JD_L1_L2", "seriesByYear": {}}],
            "specialSpreads": [{"spreadCode": "JD_01_05", "seriesByYear": {}}],
        })


class ExportSnapshotTest(unittest.TestCase):
    def test_export_spreads_includes_fixed_contract_payload(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "spreads"
            report = MODULE.export_spreads(FakeClient(), output, ["JD"])
            payload = json.loads((output / "JD.json").read_text(encoding="utf-8"))

        self.assertEqual(payload["fixedContract"]["historyStart"], "2026-01-01")
        self.assertEqual(payload["fixedContract"]["charts"][0]["nearCode"], "JD2608.DCE")
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
