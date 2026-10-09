"""Daily report (07 §5.2 ``publish/report.py``, tasks P0-8 / P0-9).

Owner: publisher owner. IMPLEMENTED for P0-8 (signatures and the contract
constraints below unchanged).

Seven days of these reports are the P0 gate data (07 §5.5), so the numbers they
carry are the deliverable of the whole phase. 07 §5.1 P0-8 fixes the contents:
新帖数 / 分类分布 / 新 key / 状态变化 / 异常, plus the manual-queue additions from
P0-9 (a simulated low-confidence sample must show up here - acceptance 5.1 P0-9).

``stats`` is ``main.CycleResult.as_dict()`` (plus the gate snapshot ``main``
computes from the store), so every section degrades gracefully to a zero when a
key is absent - a blank cycle is itself gate data (07 §5.5: 产量为 0 不是失败，
是闸门结论).

Security (07 §8.5): the report is an operator-facing file, but the same red
line applies - no plaintext key, no ``error_message_raw``. ``build`` only reads
masked-level fields (``key_masked``, verdicts, counts) and the finished text is
scrubbed once more through :func:`alert.scrub` before it is returned, so a
credential-shaped string arriving inside a warning cannot survive.
"""
from __future__ import annotations

import os
import tempfile
import time
from typing import Dict, List

from interfaces import Reporter

#: Section headers the report must contain, in order (07 §5.1 P0-8 + P0-9).
REPORT_SECTIONS: List[str] = [
    "新帖数 (discovered / enriched / degraded)",
    "分类分布 (B/C/D/A/E + matched rules)",
    "新 key (stored / confidence 分布)",
    "状态变化 (verdict transitions, dead 挽回, 连续失败计数)",
    "异常 (enrich 降级 / 0 凭证 B 帖 / 探测异常率 / 聚合源回退)",
    "人工队列 (manual_queue 新增与待办)",
]

#: Probe error rate above which the report should shout (07 §四 "探测异常率" alert).
#: Not a 07 number - it is a reporting threshold the publisher owner may tune.
PROBE_ERROR_RATE_ALERT = 0.2

#: Gate questions from 07 §5.5 the report must make answerable from its numbers:
#: (1) real key output volume, (2) how many gated keys were missed = C count minus
#: leaked hits, (3) the false-positive rate of the verdict table.
GATE_FIELDS: Dict[str, str] = {
    "key_output_volume": "cumulative B rows with verdict in (valid, quota, limited)",
    "gated_leak_miss": "C row count minus rows with source='aggregator_leak'",
    "verdict_false_positive_rate": "dead rows / rows that had 2 consistent invalids",
}

#: 07 §5.5 gate key 1: verdicts that count as "the key works".
GATE_OUTPUT_VERDICTS = ("valid", "quota", "limited")


def _int(stats: Dict, key: str) -> int:
    try:
        return int(stats.get(key) or 0)
    except (TypeError, ValueError):
        return 0


def _dict(stats: Dict, key: str) -> Dict:
    value = stats.get(key)
    return dict(value) if isinstance(value, dict) else {}


def _probe_error_rate(stats: Dict) -> float:
    """Share of probe outcomes that produced no evidence (07 §四 探测异常率).

    ``unknown`` outcomes and in-cycle probe exceptions over all outcomes. With
    no outcomes at all the rate is defined as 0.0 (nothing went wrong).
    """
    verdicts = _dict(stats, "probe_verdicts")
    total = sum(verdicts.values())
    if total <= 0:
        return 0.0
    bad = verdicts.get("unknown", 0) + _int(stats, "probe_errors")
    return bad / total


def _verdict_change_line(change: Dict) -> str:
    masked = str(change.get("key_masked") or "(masked)")
    base = str(change.get("base_url") or "-")
    old = str(change.get("from") or "unknown")
    new = str(change.get("to") or "unknown")
    failures = _int(change, "failures")
    tid = change.get("source_tid")
    where = f" tid={tid}" if tid else ""
    return f"- {masked} @ {base}{where} : {old} -> {new} (failures={failures})"


class DailyReport(Reporter):
    """Renders and persists one report per cycle under ``cfg.report_dir``."""

    def __init__(self, cfg):
        self.cfg = cfg

    def build(self, stats: Dict) -> str:
        """Markdown report over ``CycleResult.as_dict()``.

        ``stats`` is the cycle summary; the report is written even when a stage
        was pending, because a blank cycle is itself gate data (07 §5.5: 产量为 0
        不是失败，是闸门结论). Section headers come from :data:`REPORT_SECTIONS`
        verbatim, in contract order, rendered as ``##`` headings.
        """
        import alert  # local import: the outbound scrub red line lives there

        gate = _dict(stats, "gate")
        by_verdict = _dict(gate, "by_verdict")
        by_source = _dict(gate, "by_source")
        categories = _dict(stats, "categories")
        rules = _dict(stats, "rules")
        confidence = _dict(stats, "stored_by_confidence")
        probe_verdicts = _dict(stats, "probe_verdicts")
        changes = stats.get("verdict_changes") if isinstance(stats.get("verdict_changes"), list) else []
        warnings = stats.get("warnings") if isinstance(stats.get("warnings"), list) else []
        finished = _int(stats, "finished_at")
        stamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(finished)) if finished \
            else time.strftime("%Y-%m-%d %H:%M:%S")

        dead_recoveries = sum(
            1 for change in changes
            if str(change.get("from")) == "dead" and str(change.get("to")) in GATE_OUTPUT_VERDICTS
        )
        output_volume = sum(by_verdict.get(v, 0) for v in GATE_OUTPUT_VERDICTS)
        guides = by_source.get("reply_visible_guide", 0)
        leaks = by_source.get("aggregator_leak", 0)
        error_rate = _probe_error_rate(stats)

        lines: List[str] = []
        add = lines.append
        add(f"# tokenhub P0 日报  {stamp}  (dry_run={stats.get('dry_run', False)})")
        add("")
        add(f"## {REPORT_SECTIONS[0]}")
        add(f"- discovered={_int(stats, 'discovered')} "
            f"enriched={_int(stats, 'enriched')} "
            f"degraded={_int(stats, 'enrich_degraded')}")
        add(f"- watermark: {_int(stats, 'watermark_before')} -> {_int(stats, 'watermark_after')}")
        add("")
        add(f"## {REPORT_SECTIONS[1]}")
        add("- " + " ".join(f"{cat}={categories.get(cat, 0)}" for cat in ("B", "C", "D", "A", "E")))
        add(f"- matched rules: " + (", ".join(f"{k}={v}" for k, v in sorted(rules.items())) or "(none)"))
        add("")
        add(f"## {REPORT_SECTIONS[2]}")
        add(f"- credentials_found={_int(stats, 'credentials')} "
            f"keys_stored={_int(stats, 'stored_keys')} guides_stored={_int(stats, 'stored_guides')}")
        add("- confidence: " + " ".join(
            f"{level}={confidence.get(level, 0)}" for level in ("high", "medium", "low")))
        add("")
        add(f"## {REPORT_SECTIONS[3]}")
        if changes:
            lines.extend(_verdict_change_line(change) for change in changes)
        else:
            add("- (no verdict transitions this cycle)")
        add(f"- dead 挽回 (dead -> valid/quota/limited): {dead_recoveries}")
        add("")
        add(f"## {REPORT_SECTIONS[4]}")
        add(f"- warnings={len(warnings)} enrich_degraded={_int(stats, 'enrich_degraded')} "
            f"B 帖零凭证={_int(stats, 'b_without_credentials')}")
        verdict_summary = ", ".join(f"{k}={v}" for k, v in sorted(probe_verdicts.items())) or "(none)"
        add(f"- probe outcomes: {verdict_summary} ; probe errors={_int(stats, 'probe_errors')} ; "
            f"探测异常率={error_rate:.1%}"
            + ("  <-- above alert threshold!" if error_rate > PROBE_ERROR_RATE_ALERT else ""))
        add(f"- 聚合源回退 (sitemap fallback): {'yes' if stats.get('aggregator_fallback') else 'no'}")
        add(f"- probe_log pruned(90d)={_int(stats, 'probe_log_pruned')} "
            f"dead_due(24h)={_int(stats, 'dead_due')}")
        for warning in warnings[:10]:
            add(f"  - warn: {str(warning)[:200]}")
        add("")
        add(f"## {REPORT_SECTIONS[5]}")
        add(f"- manual_queue += {_int(stats, 'manual_added')} ; pending={_int(stats, 'manual_pending')}")
        add("")
        add("## 闸门数据 (07 §5.5)")
        add(f"- key_output_volume={output_volume} ({'+'.join(GATE_OUTPUT_VERDICTS)} cumulative)")
        add(f"- gated_leak_miss={guides - leaks} (C guides={guides} - aggregator_leak={leaks})")
        add(f"- verdict_false_positive_rate: dead={by_verdict.get('dead', 0)} / "
            f"with>=2 consecutive invalids={_int(gate, 'with_two_consecutive_invalids')}")
        add("")
        add(f"pending stages: {', '.join(stats.get('pending', []) or []) or '(none)'}")
        add("")
        return alert.scrub("\n".join(lines))

    def write(self, text: str) -> str:
        """Persist one dated file and return its path.

        Filename shape ``YYYY-MM-DD-HHMM.txt`` under ``cfg.report_dir`` (07 §5.2
        ``data/reports/``); written atomically (temp file in the same directory
        + ``os.replace``) so a concurrent reader never sees a half-written
        report - same contract as the feed. 07 §8.5 red lines apply: no
        plaintext key, no ``error_message_raw`` (enforced by the scrub in
        :meth:`build`).
        """
        report_dir = getattr(self.cfg, "report_dir", "") or os.path.join(
            os.path.dirname(os.path.abspath(__file__)), os.pardir, "data", "reports")
        os.makedirs(report_dir, exist_ok=True)
        path = os.path.join(report_dir, time.strftime("%Y-%m-%d-%H%M.txt"))
        payload = text if text.endswith("\n") else text + "\n"
        fd, tmp_path = tempfile.mkstemp(dir=report_dir, prefix=".report-", suffix=".txt")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(payload)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp_path, path)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
        return path
