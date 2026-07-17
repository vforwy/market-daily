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

The exported market snapshot is written to `public/data/snapshot.json`; the title-only Craps archive is written to `public/data/craps.json`. Push a refreshed snapshot to `main` to deploy it through GitHub Pages.
