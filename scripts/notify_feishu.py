#!/usr/bin/env python3
"""Send a title-only market snapshot notification through a Feishu custom bot."""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SITE_URL = "https://vforwy.github.io/market-daily/"
DEFAULT_FRAGMENTS_ROOT = ROOT.parent / "fragments-of-market"
CHECK_LABELS = {
    "futures_holding_rank": "持仓排名",
    "futures_realtime": "实时行情",
    "futures_dominant_pair_daily": "主力-次主力价差",
}


def load_local_env(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def sign(timestamp: int, secret: str) -> str:
    string_to_sign = f"{timestamp}\n{secret}".encode("utf-8")
    digest = hmac.new(string_to_sign, digestmod=hashlib.sha256).digest()
    return base64.b64encode(digest).decode("utf-8")


def build_post(title: str, lines: list[str], site_url: str, *, link_text: str = "打开 Pages 站点") -> dict:
    content = [[{"tag": "text", "text": line}] for line in lines]
    content.append([{"tag": "a", "text": link_text, "href": site_url}])
    return {
        "msg_type": "post",
        "content": {
            "post": {
                "zh_cn": {
                    "title": title,
                    "content": content,
                }
            }
        },
    }


def send(payload: dict, webhook: str, secret: str) -> dict:
    if secret:
        timestamp = int(time.time())
        payload = {"timestamp": str(timestamp), "sign": sign(timestamp, secret), **payload}
    request = urllib.request.Request(
        webhook,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Feishu returned HTTP {error.code}: {detail}") from error
    code = result.get("code", result.get("StatusCode", 0))
    if code != 0:
        raise RuntimeError(f"Feishu rejected the message: {result}")
    return result


def compact_warning(check: dict) -> str:
    name = str(check.get("name") or "未知检查")
    label = CHECK_LABELS.get(name, name)
    details = check.get("details") if isinstance(check.get("details"), dict) else {}
    latest = details.get("max_date")
    if latest:
        return f"{label}最新至 {latest}"
    if int(details.get("rows") or 0) == 0:
        return f"{label}为空"
    return f"{label}异常"


def success_lines(
    market: dict,
    maintenance: dict | None,
    *,
    skipped_checks: set[str] | None = None,
) -> list[str]:
    trade_date = market.get("meta", {}).get("latestDate") or "—"
    status = str((maintenance or {}).get("status") or "unknown").upper()
    skipped_checks = skipped_checks or set()
    warnings = [
        compact_warning(check)
        for check in (maintenance or {}).get("checks", [])
        if check.get("status") in {"warn", "fail"}
        and check.get("name") not in skipped_checks
        and not (isinstance(check.get("details"), dict) and check["details"].get("skipped"))
    ]
    return [
        f"交易日：{trade_date}",
        f"DB Doctor：{status}",
        f"主要警告：{'；'.join(warnings) if warnings else '无'}",
    ]


def credential_update_lines(error: str, *, stage: str, fragments_root: Path) -> list[str]:
    text = f"{stage} {error}".lower()
    credential = ""
    message = ""
    if any(marker in text for marker in ("mptext_auth_key", "mptextapierror", "认证信息无效")):
        credential = "MPTEXT_AUTH_KEY"
        message = f"凭据提示：{credential} 可能失效"
    elif "deepseek" in text and any(
        marker in text for marker in ("api key", "api_key", "authentication", "unauthorized", "401", "invalid")
    ):
        credential = "DEEPSEEK_API_KEY"
        message = f"凭据提示：{credential} 可能失效"
    elif "tushare" in text and any(
        marker in text for marker in ("token", "权限", "认证", "未返回", "unauthorized", "401", "403")
    ):
        credential = "TUSHARE_TOKEN"
        message = f"凭据提示：{credential} 可能失效或接口权限异常"
    elif "日终数据流水线" in stage and any(
        marker in text for marker in ("invalid token", "token invalid", "无效token", "token 无效")
    ):
        credential = "TUSHARE_TOKEN"
        message = f"凭据提示：{credential} 可能失效或接口权限异常"

    if not credential:
        return []
    return [message, f"更新位置：{fragments_root / '.env'}"]


def redact_credential_values(text: str) -> str:
    redacted = re.sub(r"(?i)\b(bearer)\s+\S+", r"\1 <redacted>", str(text))
    return re.sub(
        r"(?i)\b([a-z0-9_]*(?:token|api_key|auth_key|secret|password)[a-z0-9_]*)\s*([=:])\s*([^\s,;]+)",
        r"\1\2<redacted>",
        redacted,
    )


def failure_lines(
    error: str,
    *,
    stage: str,
    occurred_at: str,
    log_path: str,
    credential_lines: list[str] | None = None,
) -> list[str]:
    reason = " ".join(redact_credential_values(error).split())[:500] or "未知错误"
    lines = [
        f"失败阶段：{stage or '未知'}",
        f"失败原因：{reason}",
    ]
    lines.extend(credential_lines or [])
    lines.extend([
        f"发生时间：{occurred_at}",
        f"日志路径：{log_path}",
    ])
    return lines


def configured_skipped_checks(fragments_root: Path) -> set[str]:
    config_path = fragments_root / "backend" / "app" / "core" / "spread_config.json"
    if not config_path.is_file():
        return set()
    config = load_json(config_path)
    enabled_templates = {
        str(template)
        for item in config.get("items", [])
        if isinstance(item, dict)
        for template in item.get("templates", [])
    }
    skipped: set[str] = set()
    if "dominant_pair" not in enabled_templates:
        skipped.add("futures_dominant_pair_daily")
    return skipped


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", action="store_true", help="Send a connection test instead of snapshot status")
    parser.add_argument("--unchanged", action="store_true", help="Report a successful run with no data changes")
    parser.add_argument("--failure", help="Send a failure notification with this error summary")
    parser.add_argument("--site-url", default=DEFAULT_SITE_URL)
    parser.add_argument("--fragments-root", type=Path, default=DEFAULT_FRAGMENTS_ROOT)
    parser.add_argument("--failure-stage", default="未知")
    parser.add_argument("--log-path", default=str(ROOT / "logs" / "daily_publish.log"))
    parser.add_argument("--preview", action="store_true", help="Print the payload without sending it")
    args = parser.parse_args()

    load_local_env(ROOT / ".env")
    market = load_json(ROOT / "public" / "data" / "snapshot.json")
    maintenance_path = args.fragments_root / "logs" / "db_maintenance_status.json"
    maintenance = load_json(maintenance_path) if maintenance_path.is_file() else None
    skipped_checks = configured_skipped_checks(args.fragments_root)
    link_text = "打开 Pages 站点"

    if args.test:
        title = "Fragments of Market · 飞书连接成功"
        lines = ["本机已经可以通过飞书机器人发送通知。"]
    elif args.unchanged:
        title = "Fragments of Market · 今日无需更新"
        lines = success_lines(market, maintenance, skipped_checks=skipped_checks) + [
            "公开数据无实质变化，未重复部署。"
        ]
    elif args.failure:
        title = "Fragments of Market · 更新失败"
        lines = failure_lines(
            args.failure,
            stage=args.failure_stage,
            occurred_at=datetime.now().astimezone().isoformat(timespec="seconds"),
            log_path=args.log_path,
            credential_lines=credential_update_lines(
                args.failure,
                stage=args.failure_stage,
                fragments_root=args.fragments_root,
            ),
        )
        link_text = "打开当前线上版本"
    else:
        title = "Fragments of Market · 每日更新成功"
        lines = success_lines(market, maintenance, skipped_checks=skipped_checks)

    payload = build_post(title, lines, args.site_url, link_text=link_text)
    if args.preview:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    webhook = os.environ.get("FEISHU_BOT_WEBHOOK", "").strip()
    secret = os.environ.get("FEISHU_BOT_SECRET", "").strip()
    if not webhook:
        raise SystemExit("FEISHU_BOT_WEBHOOK is missing in .env")
    send(payload, webhook, secret)
    print("Feishu notification sent successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
