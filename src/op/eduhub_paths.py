"""EduHub 数据路径：一律落在项目仓库 `src/rd/server/data` 内。"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVER_DATA = ROOT / "src" / "rd" / "server" / "data"


def env_name() -> str:
    e = os.environ.get("EDUHUB_ENV", "").lower()
    if e in ("prod", "test"):
        return e
    if os.environ.get("NODE_ENV") == "production":
        return "prod"
    return "test"


def _inside_repo(path: Path) -> Path:
    resolved = path.resolve()
    root = ROOT.resolve()
    try:
        resolved.relative_to(root)
    except ValueError:
        raise SystemExit(f"数据路径必须在项目仓库内: {path}")
    return resolved


def data_dir() -> Path:
    raw = os.environ.get("DATA_DIR")
    if raw:
        return _inside_repo(Path(raw))
    return SERVER_DATA


def runtime_dir() -> Path:
    return data_dir() / "runtime" / env_name()


def cache_dir() -> Path:
    return data_dir() / "cache" / env_name()


def db_path() -> Path:
    raw = os.environ.get("EDUHUB_DB")
    if raw:
        return _inside_repo(Path(raw))
    d = runtime_dir()
    d.mkdir(parents=True, exist_ok=True)
    legacy_flat = data_dir() / "runtime" / "eduhub.db"
    legacy_root = data_dir() / "eduhub.db"
    env_db = d / "eduhub.db"
    if env_db.exists():
        return env_db
    if legacy_flat.exists():
        return legacy_flat
    if legacy_root.exists():
        return legacy_root
    return env_db


def migrate_legacy_runtime() -> None:
    """把旧版 runtime/eduhub.db 迁到 runtime/{env}/。"""
    data = data_dir()
    runtime = runtime_dir()
    runtime.mkdir(parents=True, exist_ok=True)
    legacy = data / "runtime"

    def take(src: Path, dest: Path) -> None:
        if not src.exists() or dest.exists():
            return
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            src.rename(dest)
        except PermissionError:
            print(f"skip locked {src}", flush=True)

    take(legacy / "eduhub.db", runtime / "eduhub.db")
    take(legacy / "eduhub.db-wal", runtime / "eduhub.db-wal")
    take(legacy / "eduhub.db-shm", runtime / "eduhub.db-shm")
    take(legacy / "problems", runtime / "problems")
    take(legacy / "tmp", runtime / "tmp")
    take(data / "eduhub.db", runtime / "eduhub.db")
    take(data / "eduhub.db-wal", runtime / "eduhub.db-wal")
    take(data / "eduhub.db-shm", runtime / "eduhub.db-shm")
    take(data / "problems", runtime / "problems")
    take(data / "tmp", runtime / "tmp")

    cache = cache_dir()
    cache.mkdir(parents=True, exist_ok=True)
    old_cache = data / "cache"
    take(old_cache / "gesp", cache / "gesp")
    take(old_cache / "crawls", cache / "crawls")
    take(old_cache / "adacpp-profile", cache / "adacpp-profile")
    take(data / "crawls", cache / "crawls")
