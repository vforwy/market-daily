# Market Daily

Static, interactive daily snapshots generated from the private `fragments-of-market` database.

The public repository contains only derived chart data and frontend assets. It does not contain database credentials, application secrets, the private MySQL database, administrative endpoints, or WeChat article bodies.

## Refresh the snapshot locally

```bash
set -a
source ../fragments-of-market/.env
set +a
PYTHONPATH=../fragments-of-market/backend \
  python scripts/export_snapshot.py --source-root ../fragments-of-market
npm run build
```

The exported snapshot is written to `public/data/snapshot.json`. Push a refreshed snapshot to `main` to deploy it through GitHub Pages.
