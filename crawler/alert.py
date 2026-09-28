"""Operational alerting (07 5.2 ``alert.py``; 07 4 "运维告警：钉钉，复用既有实践").

P0 alert triggers named by 07: aggregator source unreachable, parse failure,
abnormal probe error rate, Turnstile failure (P2). D4 rules out any new
notification channel, so this is the only outbound sink besides the daily
report.

The webhook URL carries a ``access_token`` query parameter, so it counts as a
secret: it is never logged in full (``DingTalkAlerter.__repr__`` masks it) and
it is masked by ``config.AppConfig.redacted()``.

Stdlib only (``urllib.request``); ``transport`` is injectable so tests never
touch the network.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Callable, Optional

# Single source of truth for the credential shapes: docs/07 8.2, exported by
# interfaces.py. Do NOT re-declare them here.
from interfaces import (
    GENERIC_CREDENTIAL_RE,
    GOOGLE_CREDENTIAL_RE,
    PRIMARY_CREDENTIAL_RE,
)

#: A transport is ``POST(url, payload_bytes) -> response_body_str``.
Transport = Callable[[str, bytes], str]

#: Anything that looks like a credential must never leave the process in an
#: alert body (07 8.5: no plaintext key in any outbound channel).
_KEY_RES = [
    re.compile(pattern)
    for pattern in (PRIMARY_CREDENTIAL_RE, GENERIC_CREDENTIAL_RE, GOOGLE_CREDENTIAL_RE)
]


def scrub(text: str) -> str:
    """Replace anything shaped like a credential with a masked placeholder."""
    out = text or ""
    for rx in _KEY_RES:
        out = rx.sub(lambda m: (m.group(0)[:6] + "***REDACTED***"), out)
    return out


def _default_transport(url: str, payload: bytes) -> str:
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310 - fixed webhook
        return resp.read().decode("utf-8", "replace")


class Alerter:
    """Interface used by the rest of the crawler (so it can be swapped/stubbed)."""

    def notify(self, message: str) -> bool:  # pragma: no cover - interface
        raise NotImplementedError


class NullAlerter(Alerter):
    """No-op sink used when ``DINGTALK_WEBHOOK`` is unset (local dev / tests)."""

    def notify(self, message: str) -> bool:
        return False

    def __repr__(self) -> str:
        return "NullAlerter()"


class DingTalkAlerter(Alerter):
    """Push one text message to the existing server-side DingTalk webhook."""

    def __init__(self, webhook_url: str, transport: Optional[Transport] = None):
        if not webhook_url:
            raise ValueError("webhook_url is required")
        self.webhook_url = webhook_url
        self._transport = transport or _default_transport
        self.last_error = ""

    def __repr__(self) -> str:  # the URL is a secret
        from crypto import mask_full

        # The webhook URL carries access_token=... so it is redacted whole.
        return f"DingTalkAlerter(webhook={mask_full(self.webhook_url)!r})"

    def notify(self, message: str) -> bool:
        """Send ``message``. Returns True on DingTalk ``errcode == 0``.

        Never raises: alerting is best-effort and must not break a crawl cycle.
        """
        body = scrub(message)[:3000]
        payload = json.dumps(
            {"msgtype": "text", "text": {"content": f"[tokenhub-crawler] {body}"}},
            ensure_ascii=False,
        ).encode("utf-8")
        try:
            raw = self._transport(self.webhook_url, payload)
        except Exception as exc:  # network / HTTP / transport errors
            self.last_error = f"{type(exc).__name__}: {scrub(str(exc))}"
            return False
        try:
            parsed = json.loads(raw)
        except ValueError:
            self.last_error = f"non-JSON response: {scrub(raw)[:200]}"
            return False
        if parsed.get("errcode", 0) != 0:
            self.last_error = scrub(str(parsed))[:200]
            return False
        self.last_error = ""
        return True


def build_alerter(webhook_url: str, transport: Optional[Transport] = None) -> Alerter:
    """Return a :class:`DingTalkAlerter` when configured, else ``NullAlerter``."""
    if not webhook_url:
        return NullAlerter()
    return DingTalkAlerter(webhook_url, transport=transport)
