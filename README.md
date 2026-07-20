# Market Daily

Static, interactive daily snapshots generated from the private `fragments-of-market` database. The site includes commodity charts and a client-side Craps title archive.

The public repository contains only derived chart data, Craps title metadata, and frontend assets. It does not contain database credentials, application secrets, the private MySQL database, administrative endpoints, WeChat fakeids, or article bodies.

The Craps archive preserves the private app's search behavior: multiple title keywords use OR semantics and search all exported history. Time and account filters run entirely in the browser.

## Refresh the snapshot locally

```bash
set -a
source ../fragments-of-market/.env
set +a
PYTHONPATH=../fragments-of-market/backend \
  python scripts/export_snapshot.py --source-root ../fragments-of-market
npm run build
```

The exported market snapshot is written to `public/data/snapshot.json`; active concrete-contract K-lines are split by variety under `public/data/klines/` for lazy loading; and the title-only Craps archive is written to `public/data/craps.json`. Push a refreshed snapshot to `main` to deploy it through GitHub Pages.

## Feishu notification

Copy `.env.example` to `.env`, fill the custom bot webhook, and optionally add its signature secret. The real `.env` is ignored by Git.

```bash
python scripts/notify_feishu.py --test
python scripts/notify_feishu.py
python scripts/notify_feishu.py --failure "snapshot refresh failed"
python scripts/notify_feishu.py --preview
```

成功通知包含交易日、DB Doctor 状态与主要警告，并附 Pages 入口；失败通知包含失败阶段、原因、发生时间、日志路径和当前线上版本入口。识别到 Tushare、MPTEXT 或 DeepSeek 鉴权错误时，只提示需要更新的凭据名称和本机 `.env` 路径，不输出密钥值。`--preview` 只打印飞书 payload，不会发送消息。

## Local daily publisher

`scripts/run_daily_publish.py` connects the whole local workflow: it runs the private seven-day maintenance pipeline without holding data, exports and validates the static snapshot, commits only `public/data/`, waits for GitHub Pages through the public Actions API, verifies the public JSON, and finally sends Feishu success or failure status. The weekday LaunchAgent enters through `scripts/run_daily_publish_scheduled.sh`: it fast-forwards this public repository only, then runs the complete workflow once. The private repository is never synchronized automatically.

Run an export and validation without committing, pushing, or notifying:

```bash
python3 scripts/run_daily_publish.py --dry-run --skip-pipeline
```

Run the complete workflow manually:

```bash
python3 scripts/run_daily_publish.py
```

Install or refresh the single weekday LaunchAgent:

```bash
bash scripts/install_launchd.sh
```

Logs and the non-overlap lock are kept under the ignored `logs/` directory. The scheduled wrapper requires this public repository to be on a clean `main` branch and only permits a fast-forward from `origin/main`; it stops and notifies rather than stashing, rebasing, or resolving divergence automatically. The publisher itself only requires its generated `public/data` paths to be clean.
