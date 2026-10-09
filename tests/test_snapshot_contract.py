import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import snapshot_contract as contract


LATEST = "2026-10-08"


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def make_snapshot(root, generation="old"):
    bar = {"d": LATEST, "o": 100, "h": 105, "l": 95, "c": 101, "v": 1000}
    selected = {"kind": "contract", "value": "BU2611.SHF"}
    write_json(root / "snapshot.json", {
        "meta": {"latestDate": LATEST, "generatedAt": "2026-10-08T17:00:00+08:00", "generation": generation},
        "commodityConfig": {"items": [{"code": "BU", "enabled": True}]},
        "klineBatches": {"contract": {"BU2611.SHF": {"bars": [bar]}},
                         "dominant_continuous": {"BU": {"bars": [bar]}}},
        "termStructureMatrix": {"latestDate": LATEST, "charts": [{
            "code": "BU", "latestDate": LATEST, "dates": [LATEST], "months": ["2611"],
            "seriesByDate": {LATEST: {"2611": 101}}, "closeSeriesByDate": {LATEST: {"2611": 101}},
            "settleSeriesByDate": {LATEST: {"2611": 101}},
        }]},
    })
    write_json(root / "klines/BU.json", {
        "variety": "BU", "selected": selected, "options": [selected], "contracts": {"BU2611.SHF": [bar]},
    })
    seasonal = {"variety": "BU", "priceMode": "raw", "years": [],
                "spreads": [], "monthlySpreads": [], "specialSpreads": []}
    adjusted = dict(seasonal, priceMode="adjusted")
    write_json(root / "spreads/BU.json", {
        "raw": seasonal, "adjusted": adjusted,
        "fixedContract": {
            "variety": "BU", "priceBasis": "raw_settle", "historyStart": "2026-01-01",
            "latestDate": LATEST, "dominantCode": "BU2611.SHF", "selectableCharts": [],
            "charts": [{"nearCode": "BU2610.SHF", "series": [{
                "farCode": "BU2611.SHF", "points": [{"d": LATEST, "v": 10, "nearPrice": 100, "farPrice": 90}],
            }]}],
        },
    })
    point = {"d": LATEST, "v": 10}
    write_json(root / "cross-spreads/overview.json", {
        "latestDate": LATEST, "charts": [{"code": "LU_FU", "latestDate": LATEST,
                                          "fixedSeries": [point], "dominantSeries": []}],
    })
    write_json(root / "cross-spreads/LU_FU.json", {
        "code": "LU_FU", "latestDate": LATEST, "monthSeries": [], "dominantSeries": [],
        "adjustedDominantSeries": [point], "structure": [], "structureHistory": [],
    })
    return {"generation": generation}


def tree_bytes(root):
    return {str(path.relative_to(root)): path.read_bytes() for path in root.rglob("*") if path.is_file()}


class SnapshotValidationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / "data"
        make_snapshot(self.root)

    def mutate(self, relative, mutate):
        path = self.root / relative
        payload = json.loads(path.read_text())
        mutate(payload)
        write_json(path, payload)

    def test_valid_without_special_templates_or_historical_choices(self):
        summary = contract.validate_snapshot(self.root, LATEST)
        self.assertEqual((summary["varieties"], summary["fixedCharts"], summary["historicalCharts"]), (1, 1, 0))
        self.assertEqual(len(summary["verificationFiles"]), 5)
        self.assertEqual(summary["verificationFiles"]["spreads/BU.json"],
                         hashlib.sha256((self.root / "spreads/BU.json").read_bytes()).hexdigest())

    def test_empty_fixed_requires_explicit_reason(self):
        self.mutate("spreads/BU.json", lambda p: p["fixedContract"].update(charts=[]))
        with self.assertRaisesRegex(contract.SnapshotValidationError, "explain unavailability"):
            contract.validate_snapshot(self.root)
        self.mutate("spreads/BU.json", lambda p: p["fixedContract"].update(unavailableReason="no_priced_dominant"))
        self.assertEqual(contract.validate_snapshot(self.root)["fixedCharts"], 0)

    def test_empty_cross_detail_requires_explicit_reason(self):
        self.mutate("cross-spreads/LU_FU.json", lambda p: p.update(adjustedDominantSeries=[]))
        with self.assertRaisesRegex(contract.SnapshotValidationError, "no usable curves"):
            contract.validate_snapshot(self.root)
        self.mutate("cross-spreads/LU_FU.json", lambda p: p.update(unavailableReason="no_shared_quotes"))
        contract.validate_snapshot(self.root)

    def test_partial_or_misidentified_payload_is_rejected(self):
        cases = [
            ("snapshot.json", lambda p: p["meta"].update(latestDate="2026-10-07")),
            ("snapshot.json", lambda p: p["commodityConfig"]["items"].append({"code": "BU"})),
            ("snapshot.json", lambda p: p["klineBatches"].update(contract={})),
            ("snapshot.json", lambda p: p["termStructureMatrix"].update(charts=[])),
            ("snapshot.json", lambda p: p["termStructureMatrix"]["charts"][0]["seriesByDate"][LATEST].update({"2611": float("inf")})),
            ("klines/BU.json", lambda p: p.update(variety="RB")),
            ("klines/BU.json", lambda p: p["selected"].update(value="BU2612.SHF")),
            ("klines/BU.json", lambda p: p["contracts"].update({"BU2611.SHF": []})),
            ("spreads/BU.json", lambda p: p.clear()),
            ("spreads/BU.json", lambda p: p["fixedContract"].update(priceBasis="adjusted_close")),
            ("cross-spreads/LU_FU.json", lambda p: p.update(code="FU_LU")),
            ("cross-spreads/LU_FU.json", lambda p: p.update(latestDate="2026-10-07")),
            ("cross-spreads/LU_FU.json", lambda p: p.update(structure=["garbage"])),
            ("cross-spreads/LU_FU.json", lambda p: p.update(structure=[{"month": "202613", "v": 10}])),
            ("cross-spreads/LU_FU.json", lambda p: p.update(structureHistory=[{"date": "2026-10-09", "points": []}])),
        ]
        for relative, mutate in cases:
            with self.subTest(relative=relative, mutate=mutate):
                make_snapshot(self.root)
                self.mutate(relative, mutate)
                with self.assertRaises(contract.SnapshotValidationError):
                    contract.validate_snapshot(self.root)

    def test_fixed_spread_arithmetic_and_dates_are_checked(self):
        cases = [{"v": 11}, {"v": float("nan")}, {"farPrice": float("inf")},
                 {"nearPrice": None}, {"d": "2026-10-09"}, {"d": "2025-12-31"}]
        for changed in cases:
            with self.subTest(changed=changed):
                make_snapshot(self.root)
                self.mutate("spreads/BU.json", lambda p: p["fixedContract"]["charts"][0]["series"][0]["points"][0].update(changed))
                with self.assertRaises(contract.SnapshotValidationError):
                    contract.validate_snapshot(self.root)

    def test_duplicate_dates_and_wrong_delivery_order_are_rejected(self):
        for action in ("repeat_point", "invalid_far", "invalid_history"):
            with self.subTest(action=action):
                make_snapshot(self.root)
                def mutate(payload):
                    fixed = payload["fixedContract"]
                    series = fixed["charts"][0]["series"][0]
                    if action == "repeat_point":
                        series["points"].append(copy.deepcopy(series["points"][0]))
                    elif action == "invalid_far":
                        series["farCode"] = "BU2609.SHF"
                    else:
                        fixed["selectableCharts"] = copy.deepcopy(fixed["charts"])
                self.mutate("spreads/BU.json", mutate)
                with self.assertRaises(contract.SnapshotValidationError):
                    contract.validate_snapshot(self.root)

    def test_missing_extra_and_symlink_json_are_rejected(self):
        source = self.root / "spreads/BU.json"
        saved = source.read_bytes()
        source.unlink()
        with self.assertRaises(contract.SnapshotValidationError):
            contract.validate_snapshot(self.root)
        source.write_bytes(saved)
        write_json(self.root / "cross-spreads/UNEXPECTED.json", {})
        with self.assertRaises(contract.SnapshotValidationError):
            contract.validate_snapshot(self.root)
        (self.root / "cross-spreads/UNEXPECTED.json").unlink()
        outside = Path(self.temp.name) / "outside.json"
        outside.write_bytes(saved)
        source.unlink()
        source.symlink_to(outside)
        with self.assertRaisesRegex(contract.SnapshotValidationError, "symlink"):
            contract.validate_snapshot(self.root)

    def test_cli_rejects_incomplete_snapshot(self):
        self.mutate("spreads/BU.json", lambda p: p.clear())
        result = subprocess.run([sys.executable, "-B", contract.__file__, str(self.root)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Snapshot validation failed", result.stderr)


class SnapshotTransactionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / "data"
        make_snapshot(self.root)
        (self.root / "unrelated.txt").write_text("preserve me")
        self.original = tree_bytes(self.root)

    def assert_original(self):
        self.assertEqual(tree_bytes(self.root), self.original)
        self.assertFalse(contract._journal_path(self.root).exists())
        self.assertEqual(list(self.root.parent.glob(".snapshot-data-stage-*")), [])
        self.assertEqual(list(self.root.parent.glob(".snapshot-data-backup-*")), [])

    def test_partial_generation_failure_keeps_old_generation(self):
        def fail(stage):
            make_snapshot(stage, "new")
            (stage / "klines/BU.json").unlink()
            raise RuntimeError("API failed halfway through")
        with self.assertRaisesRegex(RuntimeError, "halfway"):
            contract.publish_snapshot(self.root, fail)
        self.assert_original()

    def test_validation_failure_keeps_old_generation(self):
        def invalid(stage):
            report = make_snapshot(stage, "new")
            write_json(stage / "spreads/BU.json", {})
            return report
        with self.assertRaises(contract.SnapshotValidationError):
            contract.publish_snapshot(self.root, invalid)
        self.assert_original()

    def test_success_promotes_whole_generation_and_preserves_unrelated_files(self):
        result = contract.publish_snapshot(self.root, lambda stage: make_snapshot(stage, "new"))
        self.assertEqual(result, {"generation": "new"})
        contract.validate_snapshot(self.root)
        self.assertEqual((self.root / "unrelated.txt").read_text(), "preserve me")
        self.assertEqual(json.loads((self.root / "snapshot.json").read_text())["meta"]["generation"], "new")
        self.assertFalse(contract._journal_path(self.root).exists())

    def test_first_generation(self):
        target = self.root.parent / "fresh"
        contract.publish_snapshot(target, make_snapshot)
        contract.validate_snapshot(target)

    def test_failed_promotion_restores_old_generation(self):
        real_replace = os.replace
        failed = False
        def fail_once(source, target):
            nonlocal failed
            if Path(source).name.startswith(".snapshot-data-stage-") and Path(target) == self.root and not failed:
                failed = True
                raise OSError("injected promotion failure")
            real_replace(source, target)
        with patch.object(contract.os, "replace", side_effect=fail_once):
            with self.assertRaisesRegex(OSError, "promotion failure"):
                contract.publish_snapshot(self.root, lambda stage: make_snapshot(stage, "new"))
        self.assert_original()

    def journal(self, state="prepared"):
        stage = self.root.parent / ".snapshot-data-stage-test"
        backup = self.root.parent / ".snapshot-data-backup-test"
        make_snapshot(stage, "new")
        journal = {"version": 1, "target": str(self.root), "stage": str(stage), "backup": str(backup),
                   "state": state, "hadOriginal": True}
        contract._write_journal(contract._journal_path(self.root), journal)
        return stage, backup, journal

    def test_interrupted_generation_promotion_and_recovery_are_idempotent(self):
        for point in ("prepared", "old_moved", "new_moved"):
            with self.subTest(point=point):
                stage, backup, _ = self.journal()
                if point != "prepared":
                    os.replace(self.root, backup)
                if point == "new_moved":
                    os.replace(stage, self.root)
                self.assertTrue(contract.recover_snapshot(self.root))
                self.assertFalse(contract.recover_snapshot(self.root))
                self.assert_original()

    def test_committed_marker_keeps_new_generation(self):
        stage, backup, _ = self.journal("committed")
        os.replace(self.root, backup)
        os.replace(stage, self.root)
        contract.recover_snapshot(self.root)
        self.assertEqual(json.loads((self.root / "snapshot.json").read_text())["meta"]["generation"], "new")
        self.assertFalse(backup.exists())

    def test_recovery_interrupted_after_artifact_cleanup_can_resume(self):
        stage, backup, _ = self.journal()
        os.replace(self.root, backup)
        os.replace(stage, self.root)
        remove = contract._remove_owned
        def interrupted(path):
            remove(path)
            if path == stage:
                raise RuntimeError("recovery interrupted after cleanup")
        with patch.object(contract, "_remove_owned", side_effect=interrupted):
            with self.assertRaises(RuntimeError):
                contract.recover_snapshot(self.root)
        contract.recover_snapshot(self.root)
        self.assert_original()

    def test_unsafe_journal_cannot_remove_outside_data(self):
        _, _, journal = self.journal()
        outside = self.root.parent / "outside"
        outside.mkdir()
        (outside / "keep").write_text("keep")
        journal["backup"] = str(outside)
        contract._write_journal(contract._journal_path(self.root), journal)
        with self.assertRaisesRegex(contract.SnapshotValidationError, "unsafe snapshot recovery"):
            contract.recover_snapshot(self.root)
        self.assertEqual((outside / "keep").read_text(), "keep")
        self.assertEqual(tree_bytes(self.root), self.original)

    def test_regular_file_recovery_artifact_cannot_replace_live_directory(self):
        _, backup, _ = self.journal()
        backup.write_text("not a backup directory")
        with self.assertRaisesRegex(contract.SnapshotValidationError, "must be a directory"):
            contract.recover_snapshot(self.root)
        self.assertEqual(tree_bytes(self.root), self.original)
        self.assertEqual(backup.read_text(), "not a backup directory")

    def test_concurrent_export_fails_without_changing_old_data(self):
        with contract._snapshot_lock(self.root):
            with self.assertRaisesRegex(contract.SnapshotValidationError, "another snapshot"):
                contract.publish_snapshot(self.root, make_snapshot)
        self.assert_original()

    def test_existing_snapshot_symlink_cannot_be_followed_by_generator(self):
        outside = self.root.parent / "outside.json"
        outside.write_text("external sentinel")
        (self.root / "snapshot.json").unlink()
        (self.root / "snapshot.json").symlink_to(outside)
        with self.assertRaisesRegex(contract.SnapshotValidationError, "symlink"):
            contract.publish_snapshot(self.root, make_snapshot)
        self.assertEqual(outside.read_text(), "external sentinel")

    def test_journal_write_does_not_follow_predictable_temporary_symlink(self):
        outside = self.root.parent / "outside.json"
        outside.write_text("external sentinel")
        contract._journal_path(self.root).with_suffix(".tmp").symlink_to(outside)
        contract.publish_snapshot(self.root, make_snapshot)
        self.assertEqual(outside.read_text(), "external sentinel")

    def test_real_sigkill_at_promotion_boundaries_recovers_original(self):
        program = """
import os, signal, sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, sys.argv[1])
from test_snapshot_contract import contract, make_snapshot
root, boundary = Path(sys.argv[2]), sys.argv[3]
real_replace, real_journal = contract.os.replace, contract._write_journal
def replace(source, target):
    real_replace(source, target)
    if (boundary == 'old_moved' and Path(source) == root or
        boundary == 'new_moved' and Path(target) == root):
        os.kill(os.getpid(), signal.SIGKILL)
def journal(path, value):
    real_journal(path, value)
    if boundary == 'prepared' and value['state'] == 'prepared':
        os.kill(os.getpid(), signal.SIGKILL)
with patch.object(contract.os, 'replace', side_effect=replace), patch.object(contract, '_write_journal', side_effect=journal):
    contract.publish_snapshot(root, lambda stage: make_snapshot(stage, 'new'))
"""
        for boundary in ("prepared", "old_moved", "new_moved"):
            with self.subTest(boundary=boundary):
                result = subprocess.run([sys.executable, "-B", "-c", program, str(Path(__file__).parent), str(self.root), boundary],
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, -9, result.stderr)
                self.assertTrue(contract.recover_snapshot(self.root))
                self.assert_original()


if __name__ == "__main__":
    unittest.main()
