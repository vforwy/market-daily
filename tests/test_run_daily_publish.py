import logging
import plistlib
import subprocess
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[1]
import sys

sys.path.insert(0, str(ROOT / "scripts"))

import run_daily_publish  # noqa: E402


class DailyPublishGitBehaviorTest(unittest.TestCase):
    def test_git_output_keeps_porcelain_leading_space(self):
        result = subprocess.CompletedProcess([], 0, " M backend/app/ops/db_doctor.py\n", "")
        with patch.object(run_daily_publish, "run", return_value=result):
            output = run_daily_publish.git_output(Path("/workspace/repo"), ["status"], Mock())

        self.assertEqual(output, " M backend/app/ops/db_doctor.py")

    def test_scheduled_job_syncs_only_public_repository_before_publish(self):
        script = (ROOT / "scripts" / "run_daily_publish_scheduled.sh").read_text(encoding="utf-8")

        self.assertIn("$GIT fetch origin main", script)
        self.assertIn("$GIT merge --ff-only origin/main", script)
        self.assertIn('exec "$PYTHON" -B "$ROOT/scripts/run_daily_publish.py"', script)
        self.assertNotIn("fragments-of-market", script)

    def test_launch_agent_uses_scheduled_wrapper_on_weekdays(self):
        with (ROOT / "scripts" / "com.vforwy.market-daily.plist").open("rb") as stream:
            plist = plistlib.load(stream)

        self.assertEqual(
            plist["ProgramArguments"],
            [
                "/bin/bash",
                "__MARKET_DAILY_ROOT__/scripts/run_daily_publish_scheduled.sh",
            ],
        )
        self.assertEqual(
            {item["Weekday"] for item in plist["StartCalendarInterval"]},
            {2, 3, 4, 5, 6},
        )


if __name__ == "__main__":
    unittest.main()
