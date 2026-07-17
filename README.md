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
```

## Local daily publisher

`scripts/run_daily_publish.py` connects the whole local workflow: it fast-forwards both repositories from `origin/main`, runs the private seven-day maintenance pipeline without holding data, exports and validates the static snapshot, commits only `public/data/`, waits for GitHub Pages through the public Actions API, verifies the public JSON, and finally sends Feishu success or failure status. The scheduled path does not require a GitHub API token; Git pushes continue to use the repository's SSH remote.

Run an export and validation without committing, pushing, or notifying:

```bash
python3 scripts/run_daily_publish.py --dry-run --skip-pipeline --skip-sync
```

Run the complete workflow manually:

```bash
python3 scripts/run_daily_publish.py
```

Logs and the non-overlap lock are kept under the ignored `logs/` directory. The normal publisher requires both repositories to be on a clean `main` branch and only fast-forwards them; it stops rather than resolving divergent source code automatically.
