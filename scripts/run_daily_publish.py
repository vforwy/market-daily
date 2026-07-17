#!/usr/bin/env python3
"""Run the local market pipeline, publish its static snapshot, and notify Feishu."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import logging
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "public" / "data"
LOG_DIR = ROOT / "logs"
DEFAULT_FRAGMENTS_ROOT = ROOT.parent / "fragments-of-market"
DEFAULT_SITE_URL = "https://vforwy.github.io/market-daily/"
DEFAULT_REPOSITORY = "vforwy/market-daily"
DEFAULT_EXPORT_PYTHON = Path("/opt/anaconda3/envs/vforai/bin/python")
PUBLISH_PATHS = (
    "public/data/snapshot.json",
    "public/data/craps.json",
    "public/data/klines",
    "public/data/spreads",
)


class PublishError(RuntimeError):
    """A safe, user-facing daily-publish failure."""


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


def setup_logging(verbose: bool) -> logging.Logger:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("daily-publish")
    logger.setLevel(logging.DEBUG)
    logger.handlers.clear()
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")

    file_handler = logging.FileHandler(LOG_DIR / "daily_publish.log", encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    stream_handler = logging.StreamHandler()
    stream_handler.setLevel(logging.DEBUG if verbose else logging.INFO)
    stream_handler.setFormatter(formatter)
    logger.addHandler(stream_handler)
    return logger


def run(
    command: list[str | Path],
    *,
    cwd: Path,
    logger: logging.Logger,
    capture: bool = False,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    argv = [str(item) for item in command]
    logger.info("run [%s]: %s", cwd, " ".join(argv))
    if capture:
        result = subprocess.run(argv, cwd=cwd, text=True, capture_output=True, check=False)
        if result.stdout.strip():
            logger.debug("stdout: %s", result.stdout.strip())
        if result.stderr.strip():
            logger.debug("stderr: %s", result.stderr.strip())
    else:
        process = subprocess.Popen(
            argv,
            cwd=cwd,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=1,
        )
        assert process.stdout is not None
        for line in process.stdout:
            logger.info("  %s", line.rstrip())
        result = subprocess.CompletedProcess(argv, process.wait(), "", "")
    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()[-500:]
        suffix = f": {detail}" if detail else ""
        raise PublishError(f"command failed ({result.returncode}): {' '.join(argv)}{suffix}")
    return result


def git_output(repo: Path, args: list[str], logger: logging.Logger) -> str:
    return run(["/usr/bin/git", *args], cwd=repo, logger=logger, capture=True).stdout.strip()


def require_clean(repo: Path, logger: logging.Logger) -> None:
    dirty = git_output(repo, ["status", "--porcelain", "--untracked-files=all"], logger)
    if dirty:
        paths = ", ".join(line[3:] for line in dirty.splitlines()[:8])
        raise PublishError(f"refusing to run with uncommitted files in {repo}: {paths}")


def sync_main(repo: Path, logger: logging.Logger) -> None:
    branch = git_output(repo, ["branch", "--show-current"], logger)
    if branch != "main":
        raise PublishError(f"{repo} must be on main, currently on {branch or 'detached HEAD'}")
    require_clean(repo, logger)
    run(["/usr/bin/git", "fetch", "origin", "main"], cwd=repo, logger=logger)
    run(["/usr/bin/git", "merge", "--ff-only", "origin/main"], cwd=repo, logger=logger)
    require_clean(repo, logger)


def json_payload(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PublishError(f"invalid JSON file {path}: {error}") from error


def semantic_fingerprint(data_dir: Path) -> str:
    digest = hashlib.sha256()
    paths = sorted(path for path in data_dir.rglob("*.json") if path.is_file())
    if not paths:
        raise PublishError(f"no JSON files found under {data_dir}")
    for path in paths:
        payload = json_payload(path)
        if path.name in {"snapshot.json", "craps.json"} and isinstance(payload, dict):
            meta = payload.get("meta")
            if isinstance(meta, dict):
                meta.pop("generatedAt", None)
        normalized = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        digest.update(str(path.relative_to(data_dir)).encode("utf-8"))
        digest.update(b"\0")
        digest.update(normalized.encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()


def pipeline_report(fragments_root: Path) -> dict[str, Any]:
    path = fragments_root / "logs" / "daily_pipeline.json"
    payload = json_payload(path)
    if not isinstance(payload, dict):
        raise PublishError(f"pipeline report is not an object: {path}")
    status = payload.get("status")
    if status not in {"ok", "warn"} or payload.get("ingest_complete") is not True:
        raise PublishError(
            "private pipeline did not complete ingestion: "
            f"status={status} ingest_complete={payload.get('ingest_complete')}"
        )
    if not payload.get("target_trade_date"):
        raise PublishError("private pipeline report has no target_trade_date")
    return payload


def validate_export(expected_date: str | None = None) -> dict[str, Any]:
    snapshot = json_payload(DATA_DIR / "snapshot.json")
    craps = json_payload(DATA_DIR / "craps.json")
    if not isinstance(snapshot, dict) or not isinstance(craps, dict):
        raise PublishError("snapshot.json and craps.json must contain JSON objects")

    latest_date = str(snapshot.get("meta", {}).get("latestDate") or "")
    generated_at = str(snapshot.get("meta", {}).get("generatedAt") or "")
    if not latest_date or not generated_at:
        raise PublishError("snapshot metadata is missing latestDate or generatedAt")
    if expected_date and latest_date != expected_date:
        raise PublishError(f"snapshot date {latest_date} does not match pipeline target {expected_date}")

    items = snapshot.get("commodityConfig", {}).get("items", [])
    varieties = sorted(
        str(item.get("code", "")).upper()
        for item in items
        if isinstance(item, dict) and item.get("enabled", True) and item.get("code")
    )
    if not varieties:
        raise PublishError("commodity configuration contains no enabled varieties")

    kline_files = {path.stem: path for path in (DATA_DIR / "klines").glob("*.json")}
    spread_files = {path.stem: path for path in (DATA_DIR / "spreads").glob("*.json")}
    expected = set(varieties)
    if set(kline_files) != expected:
        raise PublishError("K-line files do not exactly match enabled commodity varieties")
    if set(spread_files) != expected:
        raise PublishError("spread files do not exactly match enabled commodity varieties")

    contract_count = 0
    bar_count = 0
    for variety in varieties:
        kline = json_payload(kline_files[variety])
        json_payload(spread_files[variety])
        if not isinstance(kline, dict):
            raise PublishError(f"K-line payload for {variety} is not an object")
        options = kline.get("options", [])
        selected = kline.get("selected", {})
        contracts = kline.get("contracts", {})
        if not isinstance(options, list) or not isinstance(contracts, dict):
            raise PublishError(f"K-line payload for {variety} has invalid options/contracts")
        selected_match = any(
            isinstance(option, dict)
            and option.get("kind") == selected.get("kind")
            and option.get("value") == selected.get("value")
            for option in options
        )
        if not selected_match:
            raise PublishError(f"selected K-line option is missing for {variety}")
        for option in options:
            if not isinstance(option, dict) or option.get("kind") != "contract":
                continue
            code = str(option.get("value") or "").upper()
            bars = contracts.get(code)
            if not code or not isinstance(bars, list) or not bars:
                raise PublishError(f"active contract {code or '(blank)'} for {variety} has no K-line bars")
            contract_count += 1
            bar_count += len(bars)

    craps_total = craps.get("meta", {}).get("total")
    articles = craps.get("articles")
    if not isinstance(craps_total, int) or craps_total <= 0 or not isinstance(articles, list):
        raise PublishError("Craps title index is empty or invalid")
    if craps_total != len(articles):
        raise PublishError(f"Craps total {craps_total} does not match {len(articles)} exported articles")

    return {
        "latestDate": latest_date,
        "generatedAt": generated_at,
        "varieties": len(varieties),
        "contracts": contract_count,
        "bars": bar_count,
        "craps": craps_total,
    }


def restore_generated_data(logger: logging.Logger) -> None:
    run(
        ["/usr/bin/git", "restore", "--source=HEAD", "--staged", "--worktree", "--", "public/data"],
        cwd=ROOT,
        logger=logger,
    )
    untracked = git_output(
        ROOT,
        ["ls-files", "--others", "--exclude-standard", "--", "public/data"],
        logger,
    )
    for relative in untracked.splitlines():
        path = (ROOT / relative).resolve()
        if DATA_DIR.resolve() not in path.parents:
            raise PublishError(f"refusing to remove unexpected generated path: {path}")
        if path.is_file() or path.is_symlink():
            path.unlink()
    for directory in sorted(DATA_DIR.rglob("*"), reverse=True):
        if directory.is_dir() and not any(directory.iterdir()):
            directory.rmdir()


def stage_and_commit(summary: dict[str, Any], logger: logging.Logger) -> str:
    run(["/usr/bin/git", "add", "--", *PUBLISH_PATHS], cwd=ROOT, logger=logger)
    staged = git_output(ROOT, ["diff", "--cached", "--name-only"], logger).splitlines()
    if not staged:
        raise PublishError("semantic data changed, but Git has nothing to commit")
    invalid = [path for path in staged if not path.startswith("public/data/")]
    if invalid:
        raise PublishError(f"refusing to commit paths outside public/data: {', '.join(invalid)}")
    message = f"Update market snapshot {summary['latestDate']}"
    run(["/usr/bin/git", "commit", "-m", message], cwd=ROOT, logger=logger)
    return git_output(ROOT, ["rev-parse", "HEAD"], logger)


def github_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "market-daily-publisher"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as error:
        raise PublishError(f"GitHub API request failed for {url}: {error}") from error
    if not isinstance(payload, dict):
        raise PublishError(f"GitHub API returned an invalid payload for {url}")
    return payload


def wait_for_pages(repository: str, sha: str, timeout: int, logger: logging.Logger) -> None:
    if repository.count("/") != 1:
        raise PublishError(f"invalid GitHub repository name: {repository}")
    api_root = f"https://api.github.com/repos/{repository}"
    deadline = time.monotonic() + timeout
    run_url: str | None = None
    run_api_url: str | None = None
    while time.monotonic() < deadline:
        try:
            payload = github_json(
                f"{api_root}/actions/workflows/pages.yml/runs?branch=main&event=push&per_page=20"
            )
        except PublishError as error:
            logger.warning("temporary GitHub API error while finding Pages run: %s", error)
            time.sleep(10)
            continue
        runs = payload.get("workflow_runs", [])
        match = next((item for item in runs if item.get("head_sha") == sha), None)
        if match:
            run_api_url = str(match.get("url") or "")
            run_url = str(match.get("html_url") or "")
            logger.info("Pages run found: %s (%s)", run_url, match.get("status"))
            break
        time.sleep(10)
    if not run_api_url:
        raise PublishError(f"GitHub Pages workflow did not appear within {timeout} seconds")
    while time.monotonic() < deadline:
        try:
            workflow_run = github_json(run_api_url)
        except PublishError as error:
            logger.warning("temporary GitHub API error while waiting for Pages: %s", error)
            time.sleep(15)
            continue
        status = workflow_run.get("status")
        conclusion = workflow_run.get("conclusion")
        logger.info("Pages run status: %s%s", status, f"/{conclusion}" if conclusion else "")
        if status == "completed":
            if conclusion != "success":
                raise PublishError(f"GitHub Pages deployment failed ({conclusion}): {run_url}")
            return
        time.sleep(15)
    raise PublishError(f"GitHub Pages workflow did not finish within {timeout} seconds: {run_url}")


def verify_public_site(site_url: str, summary: dict[str, Any], sha: str, timeout: int, logger: logging.Logger) -> None:
    url = f"{site_url.rstrip('/')}/data/snapshot.json?v={sha}"
    deadline = time.monotonic() + timeout
    last_error = ""
    while time.monotonic() < deadline:
        try:
            request = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = json.loads(response.read().decode("utf-8"))
            meta = payload.get("meta", {})
            if (
                meta.get("latestDate") == summary["latestDate"]
                and meta.get("generatedAt") == summary["generatedAt"]
            ):
                logger.info("public snapshot verified: %s", url)
                return
            last_error = f"public metadata is still {meta}"
        except (OSError, urllib.error.URLError, json.JSONDecodeError) as error:
            last_error = str(error)
        time.sleep(5)
    raise PublishError(f"public site verification timed out: {last_error}")


def notify(kind: str, site_url: str, message: str, logger: logging.Logger) -> None:
    command: list[str | Path] = [sys.executable, ROOT / "scripts" / "notify_feishu.py", "--site-url", site_url]
    if kind == "failure":
        command.extend(["--failure", message[:500]])
    elif kind == "unchanged":
        command.append("--unchanged")
    run(command, cwd=ROOT, logger=logger)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Export and validate, then restore data without push/notify")
    parser.add_argument("--skip-pipeline", action="store_true", help="Validate the current database without running ingestion")
    parser.add_argument("--skip-sync", action="store_true", help="Do not fetch and fast-forward either repository")
    parser.add_argument("--skip-notify", action="store_true", help="Do not send Feishu success/failure notifications")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--fragments-root", type=Path)
    parser.add_argument("--site-url")
    parser.add_argument("--repository", help="Public GitHub repository in owner/name form")
    parser.add_argument("--pages-timeout", type=int, default=900)
    parser.add_argument("--site-timeout", type=int, default=300)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    load_local_env(ROOT / ".env")
    logger = setup_logging(args.verbose)
    fragments_root = (args.fragments_root or Path(os.environ.get("FRAGMENTS_ROOT", DEFAULT_FRAGMENTS_ROOT))).resolve()
    site_url = args.site_url or os.environ.get("DAILY_PUBLISH_SITE_URL", DEFAULT_SITE_URL)
    repository = args.repository or os.environ.get("DAILY_PUBLISH_REPOSITORY", DEFAULT_REPOSITORY)
    export_python = Path(os.environ.get("FRAGMENTS_PYTHON", DEFAULT_EXPORT_PYTHON))
    lock_path = LOG_DIR / "daily_publish.lock"
    lock_file = lock_path.open("w", encoding="utf-8")
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        logger.warning("another daily publish is already running; exiting")
        return 0

    data_modified = False
    committed = False
    try:
        logger.info("daily publish started (dry_run=%s skip_pipeline=%s)", args.dry_run, args.skip_pipeline)
        if not (fragments_root / ".git").exists():
            raise PublishError(f"private repository not found: {fragments_root}")
        if not export_python.is_file():
            raise PublishError(f"export Python not found: {export_python}")
        pipeline_runner = fragments_root / "ops" / "run_daily_pipeline_local.sh"
        if not args.skip_pipeline and not pipeline_runner.is_file():
            raise PublishError(f"local pipeline profile not found: {pipeline_runner}")

        if args.dry_run:
            require_clean(fragments_root, logger)
            require_clean(ROOT, logger)
        elif args.skip_sync:
            require_clean(fragments_root, logger)
            require_clean(ROOT, logger)
        else:
            sync_main(fragments_root, logger)
            sync_main(ROOT, logger)

        before = semantic_fingerprint(DATA_DIR)
        expected_date: str | None = None
        if not args.skip_pipeline:
            run(["/bin/bash", pipeline_runner], cwd=fragments_root, logger=logger)
            expected_date = str(pipeline_report(fragments_root)["target_trade_date"])

        run(
            [export_python, "-B", ROOT / "scripts" / "export_snapshot.py", "--source-root", fragments_root],
            cwd=ROOT,
            logger=logger,
        )
        data_modified = True
        summary = validate_export(expected_date)
        after = semantic_fingerprint(DATA_DIR)
        logger.info("validated export: %s", json.dumps(summary, ensure_ascii=False, sort_keys=True))

        if args.dry_run:
            logger.info("dry-run complete; semantic_change=%s", before != after)
            restore_generated_data(logger)
            data_modified = False
            require_clean(ROOT, logger)
            return 0

        if before == after:
            restore_generated_data(logger)
            data_modified = False
            logger.info("no semantic data changes; deployment skipped")
            if not args.skip_notify:
                notify("unchanged", site_url, "", logger)
            return 0

        sha = stage_and_commit(summary, logger)
        committed = True
        run(["/usr/bin/git", "push", "origin", "main"], cwd=ROOT, logger=logger)
        wait_for_pages(repository, sha, args.pages_timeout, logger)
        verify_public_site(site_url, summary, sha, args.site_timeout, logger)
        if not args.skip_notify:
            notify("success", site_url, "", logger)
        logger.info("daily publish completed at commit %s", sha)
        return 0
    except Exception as error:  # keep the scheduler failure path and notification in one place
        logger.exception("daily publish failed: %s", error)
        if data_modified and not committed:
            try:
                restore_generated_data(logger)
            except Exception:
                logger.exception("failed to restore generated data")
        if not args.dry_run and not args.skip_notify:
            try:
                notify("failure", site_url, str(error), logger)
            except Exception:
                logger.exception("failed to send Feishu failure notification")
        return 1
    finally:
        fcntl.flock(lock_file, fcntl.LOCK_UN)
        lock_file.close()


if __name__ == "__main__":
    raise SystemExit(main())
