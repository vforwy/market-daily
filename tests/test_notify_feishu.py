import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from notify_feishu import (  # noqa: E402
    build_post,
    credential_update_lines,
    failure_lines,
    success_lines,
)


class NotifyFeishuContentTest(unittest.TestCase):
    def test_success_lines_include_trade_date_and_actionable_db_warnings(self):
        market = {"meta": {"latestDate": "2026-07-17"}}
        maintenance = {
            "status": "warn",
            "checks": [
                {
                    "name": "futures_dominant_pair_daily",
                    "status": "warn",
                    "details": {"rows": 0},
                },
                {
                    "name": "futures_holding_rank",
                    "status": "warn",
                    "details": {"rows": 100, "max_date": "2026-07-16"},
                },
                {
                    "name": "futures_realtime",
                    "status": "warn",
                    "details": {"rows": 20, "max_date": "2026-04-29"},
                },
            ],
        }

        self.assertEqual(
            success_lines(
                market,
                maintenance,
                skipped_checks={"futures_dominant_pair_daily"},
            ),
            [
                "交易日：2026-07-17",
                "DB Doctor：WARN",
                "主要警告：持仓排名最新至 2026-07-16；实时行情最新至 2026-04-29",
            ],
        )

    def test_failure_lines_are_compact_and_include_diagnostics(self):
        lines = failure_lines(
            "GitHub API request failed\nconnection reset",
            stage="等待 GitHub Pages 部署",
            occurred_at="2026-07-17T16:14:00+08:00",
            log_path="/tmp/daily_publish.log",
        )

        self.assertEqual(
            lines,
            [
                "失败阶段：等待 GitHub Pages 部署",
                "失败原因：GitHub API request failed connection reset",
                "发生时间：2026-07-17T16:14:00+08:00",
                "日志路径：/tmp/daily_publish.log",
            ],
        )

    def test_failure_lines_redact_credential_values(self):
        lines = failure_lines(
            "request failed: TUSHARE_TOKEN=top-secret-value",
            stage="运行日终数据流水线",
            occurred_at="2026-07-17T16:14:00+08:00",
            log_path="/tmp/daily_publish.log",
        )

        self.assertIn("TUSHARE_TOKEN=<redacted>", lines[1])
        self.assertNotIn("top-secret-value", " ".join(lines))

    def test_failure_post_keeps_current_site_link(self):
        payload = build_post(
            "更新失败",
            ["失败阶段：导出静态快照"],
            "https://example.com/",
            link_text="打开当前线上版本",
        )
        link = payload["content"]["post"]["zh_cn"]["content"][-1][0]

        self.assertEqual(link["text"], "打开当前线上版本")
        self.assertEqual(link["href"], "https://example.com/")

    def test_tushare_auth_failure_points_to_local_env_without_exposing_secret(self):
        fragments_root = Path("/workspace/fragments-of-market")
        lines = credential_update_lines(
            "Tushare 未返回数据，请检查 Token 或 API 地址是否有效",
            stage="运行日终数据流水线",
            fragments_root=fragments_root,
        )

        self.assertEqual(
            lines,
            [
                "凭据提示：TUSHARE_TOKEN 可能失效或接口权限异常",
                "更新位置：/workspace/fragments-of-market/.env",
            ],
        )
        self.assertNotIn("your-secret", " ".join(lines))

    def test_mptext_auth_failure_identifies_mptext_key(self):
        lines = credential_update_lines(
            "MptextApiError: 认证信息无效",
            stage="公众号同步",
            fragments_root=Path("/workspace/fragments-of-market"),
        )

        self.assertEqual(lines[0], "凭据提示：MPTEXT_AUTH_KEY 可能失效")

    def test_deepseek_auth_failure_identifies_deepseek_key(self):
        lines = credential_update_lines(
            "DeepSeek AuthenticationError: invalid API key",
            stage="公众号 LLM 过滤",
            fragments_root=Path("/workspace/fragments-of-market"),
        )

        self.assertEqual(lines[0], "凭据提示：DEEPSEEK_API_KEY 可能失效")

    def test_unrelated_failure_has_no_credential_hint(self):
        self.assertEqual(
            credential_update_lines(
                "GitHub Pages workflow timed out",
                stage="等待 GitHub Pages 部署",
                fragments_root=Path("/workspace/fragments-of-market"),
            ),
            [],
        )


if __name__ == "__main__":
    unittest.main()
