# Market Daily

Static, interactive daily snapshots generated from the private `fragments-of-market` database. The site includes commodity charts, seat holdings, and a client-side Craps title archive.

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

The exported market snapshot is written to `public/data/snapshot.json`; active concrete-contract K-lines are split by variety under `public/data/klines/` for lazy loading; and the title-only Craps archive is written to `public/data/craps.json`. Derived holdings are exported under `public/data/holdings/`. Push a refreshed snapshot to `main` to deploy it through GitHub Pages.

## Seat holdings

Open the **持仓** tab or link directly to `?page=holdings`. Daily views show product-level, member-level and contract-level Top 5/10/20 holdings; the change view separates one-month rank history from the selected trading day's position changes. Contract net-long and net-short stacked bars sit vertically below the main continuous price, followed by their ratios.

The exporter reads the persisted combined/member/top-N tables. Product rankings aggregate each member across contracts before taking top N; contract rankings are separate. The browser never merges the raw sources or recalculates rankings. A variety board is loaded on demand, and member history is fetched only for the selected change scope. SHA-256 references prevent mixing assets from different releases. Empty trading-day data stays missing; numerical field fallback and Tushare priority remain in the private pipeline.

The single weekday pipeline publishes after market data completes, then again after the evening holdings refresh passes current-date coverage checks. The first release can show today's prices with the previous trading day's holdings; both dates are visible in the holdings header. The second release only exports and publishes the completed data and does not repeat market ingestion.

## Operations

The weekday database-to-Pages workflow, LaunchAgent, Git preflight, deployment verification, Feishu notifications, and operational logs live in the sibling `market-pipeline` project. This repository retains only the public site and its snapshot export Adapter.
