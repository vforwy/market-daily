import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from holding_snapshot import validate_holdings, _write
from holding_fixture import make_holdings


class HoldingArchiveContractTest(unittest.TestCase):
    def test_current_and_previous_day_holdings_remain_separate_from_quote_date(self):
        for holding, status in [('2026-11-04', 'ok'), ('2026-11-03', 'partial')]:
            with self.subTest(holding=holding), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                summary = make_holdings(root, ['BU'], '2026-11-04', holding)
                report = validate_holdings(root, summary, ['BU'], '2026-11-04')
                self.assertEqual(report['coverage']['status'], status)
                self.assertEqual(report['memberRows'], 2)
                if status == 'partial':
                    board = json.loads((root / 'BU/board.json').read_text())
                    self.assertIsNone(board['topN']['5']['combined']['longSum'][-1])

    def test_changed_body_without_manifest_update_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); summary = make_holdings(root, ['BU'], '2026-11-04')
            with (root / 'BU/board.json').open('a') as stream: stream.write(' ')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                validate_holdings(root, summary, ['BU'], '2026-11-04')

    def test_missing_scope_and_path_escape_are_rejected(self):
        for mutation in ('missing', 'escape'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as folder:
                root = Path(folder); summary = make_holdings(root, ['BU'], '2026-11-04')
                if mutation == 'missing': (root / 'BU/members/BU.json').unlink()
                else:
                    index = json.loads((root / 'index.json').read_text())
                    index['varieties']['BU']['file'] = '../outside.json'
                    _write(root, 'index.json', index)
                with self.assertRaises(ValueError): validate_holdings(root, summary, ['BU'], '2026-11-04')

    def test_invalid_member_indices_are_rejected_even_with_a_valid_hash(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); summary = make_holdings(root, ['BU'], '2026-11-04')
            member = json.loads((root / 'BU/members/BU.json').read_text())
            member['rows'][0][0] = 99
            ref = _write(root, 'BU/members/BU.json', member)
            index = json.loads((root / 'index.json').read_text())
            index['varieties']['BU']['members']['BU'] = ref
            _write(root, 'index.json', index)
            with self.assertRaisesRegex(ValueError, 'member index'):
                validate_holdings(root, summary, ['BU'], '2026-11-04')
