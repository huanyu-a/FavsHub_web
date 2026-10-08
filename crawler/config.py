"""Configuration loading: ``.env`` parsing + ``--print-config`` (07 5.2 / P0-1).

Owned by the skeleton author. Implements only the standard library (no
``python-dotenv``): requirements are ``cryptography`` and stdlib. Follows the
sync-nexus.py ``--dry-run`` / ``--print-config`` / ``.env.example`` convention
(07 3, D7).

The variable set is taken verbatim from 07 5.2 ``.env.example``:
``AGG_API_BASE`` / ``UA`` / ``DB_PATH`` / ``FORUMS=2,8,3`` / ``DINGTALK_WEBHOOK``
/ ``ENABLE_PAID_PROBE=false`` / ``ENABLE_ACCOUNT_FARM=false`` (P2 slots), plus
``FERNET_KEY`` which :mod:`crypto` requires (07 8.4).

``--print-config`` output is always sanitized: secrets (``FERNET_KEY``,
``DINGTALK_WEBHOOK``) are never printed in the clear (07 8.5).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from crypto import mask_full as _mask_full

CRAWLER_DIR = os.path.dirname(os.path.abspath(__file__))

#: Environment variable names recognised (07 5.2 .env.example).
ENV_KEYS: List[str] = [
    "AGG_API_BASE",
    "UA",
    "DB_PATH",
    "FORUMS",
    "DINGTALK_WEBHOOK",
    "ENABLE_PAID_PROBE",
    "ENABLE_ACCOUNT_FARM",
    "FERNET_KEY",
]

#: Secrets that must be redacted by :func:`load_config` / ``--print-config``.
SECRET_KEYS: List[str] = ["FERNET_KEY", "DINGTALK_WEBHOOK"]

_DEFAULTS: Dict[str, str] = {
    # Aggregator discovery API (07 3: "必须带 UA 否则 403"; limit 100; forum ids).
    "AGG_API_BASE": "https://linuxsb.tux298.com/api/latest",
    # A browser-like UA; the aggregator rejects the default curl/python UA (02 A.3).
    "UA": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
          "Chrome/120.0 Safari/537.36",
    "DB_PATH": os.path.join(CRAWLER_DIR, "data", "tokenhub.db"),
    "FORUMS": "2,8,3",
    "DINGTALK_WEBHOOK": "",
    "ENABLE_PAID_PROBE": "false",
    "ENABLE_ACCOUNT_FARM": "false",
    "FERNET_KEY": "",
}


def to_bool(value: Optional[str]) -> bool:
    """Parse the ``.env`` boolean convention (true/1/yes/on are truthy)."""
    if value is None:
        return False
    return value.strip().lower() in ("1", "true", "yes", "on")


def parse_forums(value: Optional[str]) -> List[int]:
    """Parse a comma separated forum id list, dropping blanks and junk."""
    forums: List[int] = []
    for part in (value or "").split(","):
        part = part.strip()
        if part.lstrip("+").isdigit():
            forums.append(int(part))
    return forums


def parse_env_text(text: str) -> Dict[str, str]:
    """Parse a ``.env`` file body into a dict (stdlib only).

    Supports ``KEY=value``, optional ``export`` prefix, ``#`` comments, blank
    lines, and single/double quoted values. Values keep internal ``=`` intact.
    """
    result: Dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if key:
            result[key] = value
    return result


def _read_env_file(path: str) -> Dict[str, str]:
    if not path or not os.path.isfile(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return parse_env_text(fh.read())


@dataclass
class AppConfig:
    """Typed configuration handed to ``run_cycle``."""

    agg_api_base: str
    ua: str
    forums: List[int]
    db_path: str
    dingtalk_webhook: str
    enable_paid_probe: bool
    enable_account_farm: bool
    fernet_key: str = field(repr=False, default="")
    #: When True the cycle computes but persists nothing (``--dry-run``).
    dry_run: bool = False

    @property
    def feed_path(self) -> str:
        return os.path.join(os.path.dirname(self.db_path) or CRAWLER_DIR, "feed.xml")

    @property
    def report_dir(self) -> str:
        return os.path.join(os.path.dirname(self.db_path) or CRAWLER_DIR, "reports")

    @property
    def alert_log_path(self) -> str:
        """Local degrade-to-log sink when ``DINGTALK_WEBHOOK`` is unset.

        Lives next to the DB (07 §5.2 ``data/`` is the only place files are
        written), so a ``--dry-run`` rehearsal against ``:memory:`` still
        resolves to ``crawler/`` and can be overridden by pointing ``DB_PATH``
        elsewhere.
        """
        return os.path.join(os.path.dirname(self.db_path) or CRAWLER_DIR, "alerts.log")

    def ensure_data_dir(self) -> None:
        """Create the ``data/`` dir (07 5.2: tokenhub.db / feed.xml / reports/)."""
        directory = os.path.dirname(self.db_path) or CRAWLER_DIR
        os.makedirs(directory, exist_ok=True)
        os.makedirs(self.report_dir, exist_ok=True)

    def redacted(self) -> Dict[str, str]:
        """A copy safe to print: secrets replaced by their masked form."""
        out: Dict[str, str] = {
            "AGG_API_BASE": self.agg_api_base,
            "UA": self.ua,
            "FORUMS": ",".join(str(f) for f in self.forums),
            "DB_PATH": self.db_path,
            "ENABLE_PAID_PROBE": str(self.enable_paid_probe).lower(),
            "ENABLE_ACCOUNT_FARM": str(self.enable_account_farm).lower(),
            # Fully redacted: revealing even a prefix of the Fernet key or the
            # webhook would leak a live secret (07 §8.5).
            "FERNET_KEY": _mask_full(self.fernet_key) if self.fernet_key else "(unset)",
            "DINGTALK_WEBHOOK": _mask_full(self.dingtalk_webhook) if self.dingtalk_webhook else "(unset)",
            "DRY_RUN": str(self.dry_run).lower(),
        }
        return out


def load_config(env_path: Optional[str] = None, dry_run: bool = False) -> AppConfig:
    """Build :class:`AppConfig` from ``.env`` (if present) overridden by env vars.

    Precedence: process environment > ``.env`` file > built-in defaults. The
    default ``.env`` location is ``crawler/.env``; pass ``env_path`` to override.
    """
    if env_path is None:
        env_path = os.path.join(CRAWLER_DIR, ".env")
    file_vals = _read_env_file(env_path)

    def resolve(key: str) -> str:
        # os.environ wins so the server crontab / CI can override without a file.
        env_val = os.environ.get(key)
        if env_val is not None and env_val != "":
            return env_val
        if key in file_vals:
            return file_vals[key]
        return _DEFAULTS.get(key, "")

    return AppConfig(
        agg_api_base=resolve("AGG_API_BASE"),
        ua=resolve("UA"),
        forums=parse_forums(resolve("FORUMS")),
        db_path=resolve("DB_PATH"),
        dingtalk_webhook=resolve("DINGTALK_WEBHOOK"),
        enable_paid_probe=to_bool(resolve("ENABLE_PAID_PROBE")),
        enable_account_farm=to_bool(resolve("ENABLE_ACCOUNT_FARM")),
        fernet_key=resolve("FERNET_KEY"),
        dry_run=dry_run,
    )
