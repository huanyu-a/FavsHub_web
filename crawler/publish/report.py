"""Daily report (07 §5.2 ``publish/report.py``, tasks P0-8 / P0-9).

Owner: publisher owner. Contract stub - signature complete, body raises
``NotImplementedError``.

Seven days of these reports are the P0 gate data (07 §5.5), so the numbers they
carry are the deliverable of the whole phase. 07 §5.1 P0-8 fixes the contents:
新帖数 / 分类分布 / 新 key / 状态变化 / 异常, plus the manual-queue additions from
P0-9 (a simulated low-confidence sample must show up here - acceptance 5.1 P0-9).
"""
from __future__ import annotations

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


class DailyReport(Reporter):
    """Renders and persists one report per cycle under ``cfg.report_dir``."""

    def __init__(self, cfg):
        self.cfg = cfg

    def build(self, stats: Dict) -> str:
        """Plain-text report over ``CycleResult.as_dict()``.

        ``stats`` is the cycle summary; the report is written even when a stage
        was pending, because a blank cycle is itself gate data (07 §5.5: 产量为 0
        不是失败，是闸门结论).
        """
        raise NotImplementedError("P0-8: implement report rendering")

    def write(self, text: str) -> str:
        """Persist one dated file and return its path.

        Filename shape ``YYYY-MM-DD-HHMM.txt`` under ``cfg.report_dir`` (07 §5.2
        ``data/reports/``). 07 §8.5 red lines apply: no plaintext key, no
        ``error_message_raw``.
        """
        raise NotImplementedError("P0-8: implement dated report persistence")
