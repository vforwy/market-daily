#!/usr/bin/env python3
"""Send a title-only market snapshot notification through a Feishu custom bot."""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SITE_URL = "https://vforwy.github.io/market-daily/"


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


def build_post(title: str, lines: list[str], site_url: str) -> dict:
    content = [[{"tag": "text", "text": line}] for line in lines]
    content.append([{"tag": "a", "text": "打开静态站点", "href": site_url}])
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


def snapshot_lines() -> list[str]:
    market = load_json(ROOT / "public" / "data" / "snapshot.json")
    craps = load_json(ROOT / "public" / "data" / "craps.json")
    return [
        f"行情日期：{market.get('meta', {}).get('latestDate') or '—'}",
        f"Craps 标题索引：{int(craps.get('meta', {}).get('total', 0)):,} 篇",
        "静态站点已经完成更新。",
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", action="store_true", help="Send a connection test instead of snapshot status")
    parser.add_argument("--unchanged", action="store_true", help="Report a successful run with no data changes")
    parser.add_argument("--failure", help="Send a failure notification with this error summary")
    parser.add_argument("--site-url", default=DEFAULT_SITE_URL)
    args = parser.parse_args()

    load_local_env(ROOT / ".env")
    webhook = os.environ.get("FEISHU_BOT_WEBHOOK", "").strip()
    secret = os.environ.get("FEISHU_BOT_SECRET", "").strip()
    if not webhook:
        raise SystemExit("FEISHU_BOT_WEBHOOK is missing in .env")

    if args.test:
        title = "Fragments of Market · 飞书连接成功"
        lines = ["本机已经可以通过飞书机器人发送通知。"]
    elif args.unchanged:
        title = "Fragments of Market · 今日无需更新"
        lines = snapshot_lines()[:2] + ["本次已完成检查，公开数据没有实质变化。"]
    elif args.failure:
        title = "Fragments of Market · 更新失败"
        lines = [args.failure[:500]]
    else:
        title = "Fragments of Market · 每日快照已更新"
        lines = snapshot_lines()

    send(build_post(title, lines, args.site_url), webhook, secret)
    print("Feishu notification sent successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
