"""Cron entry point: CLI + ``run_cycle`` orchestration (07 §5.2 / §四, P0-1).

Mirrors the ``sync-nexus.py`` conventions the plan copies (07 §三 / D7):
``--print-config`` / ``--dry-run`` / ``--once`` plus a ``.env.example``.

Run from the repository root (this is a required entry point):

    python crawler/main.py --print-config
    python crawler/main.py --dry-run
    python crawler/main.py --once

The stage order is the one fixed by 07 §四:
discover -> enrich -> classify -> extract -> probe -> store -> publish ->
cleanup -> alert. All P0 stages are implemented; ``run_cycle`` keeps the
skeleton's pending-stage protocol (an injected stub stage that raises
``NotImplementedError`` is recorded in ``CycleResult.pending`` and the cycle
still finishes with exit code 0).

Cycle contract highlights (07 §四 / §8.1 / §8.3):
  * C posts are stored as ``reply_visible_guide`` rows with zero key data (D2);
  * D posts are recorded into ``manual_queue`` (``card_or_paid_benefit_info``)
    and are never extracted nor probed (07 §8.1 D row);
  * suspected-valuable E posts and low-confidence pairings go to the manual
    queue (P0-9), with the reason mapped from the category;
  * fresh keys are stored (masked + hash + Fernet ciphertext) then probed;
    the persisted stock is re-probed on the 07 §8.3 cadence (non-dead every
    cron round, dead once per day);
  * the full feed/report snapshot is rebuilt from the store every cycle and
    the probe_log is pruned beyond 90 days (06 修订).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

# ``python crawler/main.py`` puts crawler/ in sys.path, but make direct execution
# from the repository root independent of that detail.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import crypto  # noqa: E402
from alert import build_alerter  # noqa: E402
from config import AppConfig, load_config  # noqa: E402
from interfaces import (  # noqa: E402
    CATEGORY_C,
    CATEGORY_D,
    CATEGORY_E,
    CONFIDENCE_LOW,
    CredentialPair,
    KEY_SOURCE_POST,
    REASON_CARD_OR_PAID_BENEFIT_INFO,
    REASON_LOW_CONFIDENCE_CLASSIFY,
    REASON_LOW_CONFIDENCE_PAIRING,
    REASON_SUSPECTED_VALUABLE_E,
    REASON_UNKNOWN_5_ROUNDS,
    FeedEntry,
    ProbeState,
)
from extract.models import find_model_mentions  # noqa: E402
from store import db  # noqa: E402

__all__ = ["CycleResult", "build_components", "run_cycle", "main"]

#: 07 §四 ①-⑦ stage names, in the fixed execution order.
STAGES: Tuple[str, ...] = (
    "discover",
    "enrich",
    "classify",
    "extract",
    "probe",
    "store",
    "publish",
    "cleanup",
)


@dataclass
class CycleResult:
    """Machine-readable summary of one cycle (also what ``--json`` prints)."""

    dry_run: bool = False
    watermark_before: int = 0
    watermark_after: int = 0
    discovered: int = 0
    enriched: int = 0
    enrich_degraded: int = 0
    categories: Dict[str, int] = field(default_factory=dict)
    #: Hits per matched rule (``B`` / ``C`` / ``D-badge`` / ``A1`` ...) - the
    #: "matched rules" line of the daily report (07 §5.1 P0-8).
    rules: Dict[str, int] = field(default_factory=dict)
    credentials: int = 0
    stored_keys: int = 0
    stored_guides: int = 0
    #: Upserted credentials grouped by pairing confidence (07 §8.2).
    stored_by_confidence: Dict[str, int] = field(default_factory=dict)
    #: B-class posts whose extraction produced nothing (report "0 凭证 B 帖").
    b_without_credentials: int = 0
    probe_outcomes: int = 0
    #: Probe outcomes grouped by raw verdict label (07 §8.3 探测异常率 input).
    probe_verdicts: Dict[str, int] = field(default_factory=dict)
    #: Probe attempts that raised (counted, never fatal for the cycle).
    probe_errors: int = 0
    #: Masked-level verdict transitions this cycle (report "状态变化"; 07 §8.3).
    verdict_changes: List[Dict[str, Any]] = field(default_factory=list)
    feed_entries: int = 0
    manual_added: int = 0
    #: Manual-queue rows still pending at publish time (report "待办").
    manual_pending: int = 0
    probe_log_pruned: int = 0
    #: Reply-visible guide rows deleted by the 24h TTL (site-owner request,
    #: 2026-10-08 - stale unlock instructions lose their value quickly).
    guide_rows_pruned: int = 0
    dead_due: int = 0
    #: True when discovery had to fall back to the sitemap (07 §5.4 ⑥).
    aggregator_fallback: bool = False
    #: 07 §5.5 gate snapshot taken at publish time (see ``_gate_snapshot``).
    gate: Dict[str, Any] = field(default_factory=dict)
    finished_at: int = 0
    #: Stage names that raised ``NotImplementedError`` (skeleton placeholders).
    pending: List[str] = field(default_factory=list)
    #: Non-fatal problems worth an alert (07 §四 "解析失败即告警降级").
    warnings: List[str] = field(default_factory=list)
    alerts_sent: int = 0

    def as_dict(self) -> Dict[str, Any]:
        out = dict(self.__dict__)
        for key in ("categories", "rules", "stored_by_confidence", "probe_verdicts", "gate"):
            out[key] = dict(getattr(self, key))
        return out

    def to_json(self) -> str:
        return json.dumps(self.as_dict(), ensure_ascii=False, indent=2, sort_keys=True)


def build_components(cfg: AppConfig, transport: Any = None) -> Dict[str, Any]:
    """Instantiate the eight pipeline stages from their contract classes.

    ``transport`` is only threaded into the alerter so tests can fake DingTalk
    without monkey-patching.

    Seam fix (the sources owner's CONTRACT-ISSUE, sources/linux_sb.py module
    docstring): the alerter is built first and handed to the adapter as
    ``alerter=alerter``, so the mandatory sitemap-fallback alert (07 §5.4 ⑥)
    has a real sink instead of only queuing on ``adapter.pending_alerts``.
    With ``DINGTALK_WEBHOOK`` unset the alerter degrades to a local log file
    (07 D4 keeps the channel set closed; alerts must still survive locally);
    ``--dry-run`` persists nothing, so it keeps the no-op sink.
    """
    from classify.engine import RuleEngine
    from extract.credentials import LayeredExtractor
    from probe.prober import HttpProber
    from probe.verdict import StateMachine
    from publish.feed import RssFeed
    from publish.report import DailyReport
    from sources.linux_sb import LinuxSbAdapter

    if cfg.dry_run:
        alerter = build_alerter("")
    else:
        alerter = build_alerter(
            cfg.dingtalk_webhook,
            transport=transport,
            log_path=cfg.alert_log_path,
        )
    prober = HttpProber(cfg)

    return {
        # The adapter takes plain values (not the whole AppConfig) so it can be
        # unit-tested with a fake config object; extra knobs stay keyword-only.
        "adapter": LinuxSbAdapter(cfg.agg_api_base, cfg.ua, cfg.forums,
                                  alerter=alerter),
        "classifier": RuleEngine(cfg),
        # 07 §5.1 P0-5 deliverable "探针消歧（§8.2）": the extractor must own the
        # prober so a 1-key/N-URL low pairing is resolved by single-shot
        # GET /v1/models probes ("取第一个非 401") instead of being silently
        # collapsed to its first candidate.
        "extractor": LayeredExtractor(cfg, prober=prober),
        "prober": prober,
        "machine": StateMachine(cfg),
        "feed": RssFeed(cfg),
        "reporter": DailyReport(cfg),
        "alerter": alerter,
    }


def _mark_pending(result: CycleResult, stage: str, exc: NotImplementedError) -> None:
    if stage not in result.pending:
        result.pending.append(stage)
    result.warnings.append(f"{stage}: {exc}")


def _open_conn(cfg: AppConfig) -> Any:
    """Write DB for a real run; existing DB read-only-ish for ``--dry-run``.

    ``--dry-run`` deliberately does not create ``crawler/data/`` when it is
    absent, so a rehearsal cannot leave artifacts behind.
    """
    if cfg.dry_run:
        if os.path.exists(cfg.db_path):
            conn = db.connect(cfg.db_path)
        else:
            conn = db.connect_in_memory()
        db.init_db(conn)
        return conn
    cfg.ensure_data_dir()
    conn = db.connect(cfg.db_path)
    db.init_db(conn)
    return conn


def run_cycle(cfg: AppConfig, conn: Any = None,
              components: Optional[Dict[str, Any]] = None) -> CycleResult:
    """Execute one P0 cycle in 07 §四 order.

    Never raises for an unimplemented stage - the skeleton must be runnable
    end to end (``python crawler/main.py --once`` from the repo root).
    """
    result = CycleResult(dry_run=cfg.dry_run)
    own_conn = conn is None
    if conn is None:
        conn = _open_conn(cfg)
    parts = components or build_components(cfg)
    alerter = parts["alerter"]
    adapter = parts["adapter"]

    try:
        # ------------------------------------------------------------------
        # ① discover - tid watermark cursor (07 §四 ①, P0-2)
        # ------------------------------------------------------------------
        stage = "discover"
        watermark = db.get_watermark(conn, adapter.source_id)
        result.watermark_before = watermark
        posts = adapter.discover(watermark)
        result.discovered = len(posts)

        # ------------------------------------------------------------------
        # ② enrich - JSON-LD full body (07 §四 ②, P0-3)
        # ------------------------------------------------------------------
        stage = "enrich"
        fulls = []
        for post in posts:
            try:
                full = adapter.enrich(post)
            except NotImplementedError:
                raise
            except Exception as exc:  # 07 §九: "解析失败即告警降级"
                result.warnings.append(f"enrich tid={post.tid} degraded: {exc}")
                continue
            fulls.append(full)
            if full.enriched:
                result.enriched += 1
            else:
                result.enrich_degraded += 1
        # The adapter records its own operational warnings (transport retries,
        # sitemap fallback switch): drain them into the cycle summary so the
        # report "异常" section and the end-of-cycle alert see them.
        _drain_source_warnings(result, adapter)

        # ------------------------------------------------------------------
        # ③ classify - B -> C -> D -> A -> E (07 §四 ③, P0-4)
        # ------------------------------------------------------------------
        stage = "classify"
        # D10: the generic rule set plus whatever this source contributes (linux.sb:
        # C and D). Both are stubs in P0-1, so this raises NotImplementedError and
        # the stage is recorded as pending - which is the point of the skeleton.
        from classify.rules_common import common_rules

        parts["classifier"].register(list(common_rules()) + list(adapter.classify_rules()))
        classified = []
        for full in fulls:
            try:
                item = parts["classifier"].classify(full)
            except NotImplementedError:
                raise
            except Exception as exc:  # one bad post must not kill the cycle
                result.warnings.append(f"classify tid={full.tid} degraded: {exc}")
                continue
            classified.append(item)
            result.categories[item.category] = result.categories.get(item.category, 0) + 1
            result.rules[item.matched_rule] = result.rules.get(item.matched_rule, 0) + 1
            if not cfg.dry_run:
                # D class is record-only (07 §8.1 D row: 标题+链接+价格 进「福利
                # 情报」, no extraction, no probe) -> P0-9 files the whole class
                # under ``card_or_paid_benefit_info`` (the classify owner's
                # CONTRACT-ISSUE: badge hits carry no ``low_confidence`` flag,
                # but the disposition applies to the class).
                if item.category == CATEGORY_D:
                    _enqueue_card_record(conn, item)
                    result.manual_added += 1
                elif item.low_confidence:
                    # P0-9 reason mapping: suspected-valuable E vs generic
                    # low-confidence classification (07 §5.1 P0-9 / MANUAL_REASONS).
                    reason = (REASON_SUSPECTED_VALUABLE_E
                              if item.category == CATEGORY_E
                              else REASON_LOW_CONFIDENCE_CLASSIFY)
                    db.enqueue_manual(
                        conn,
                        reason=reason,
                        source_id=full.source_id,
                        source_tid=full.tid,
                        detail=f"rule={item.matched_rule} category={item.category} {item.note}".strip(),
                    )
                    result.manual_added += 1

        # ------------------------------------------------------------------
        # ④ extract - credentials (B) + guide records (C) (07 §四 ④, P0-5 / D2)
        # ------------------------------------------------------------------
        stage = "extract"
        pairs_by_tid: Dict[int, List[Any]] = {}
        for item in classified:
            if item.category == CATEGORY_C:
                if not cfg.dry_run:
                    try:
                        result.stored_guides += _store_guide(conn, item)
                    except NotImplementedError:
                        raise
                    except Exception as exc:
                        result.warnings.append(
                            f"store guide tid={item.post.tid} failed: {type(exc).__name__}: {exc}"
                        )
                continue
            if item.category == CATEGORY_D:
                # 07 §8.1 D row: 只记录，不提取不探测 - already queued in ③.
                continue
            try:
                found = parts["extractor"].extract(item.post)
            except NotImplementedError:
                raise
            except Exception as exc:  # extractor blow-up degrades, never fatal
                result.warnings.append(
                    f"extract tid={item.post.tid} failed: {type(exc).__name__}: {exc}"
                )
                continue
            if item.category == "B" and not found:
                # Report input "0 凭证 B 帖": recall loss or 200-char truncation.
                result.b_without_credentials += 1
            if found:
                pairs_by_tid[item.post.tid] = list(found)
                result.credentials += len(found)
                # 07 §5.1 P0-9: a "low" pairing (one URL + N keys, or vice versa)
                # is never auto-published - it goes to the manual queue here and
                # _feed_entries withholds it from the feed until a human clears
                # it (enforced, not just claimed; see the CONFIDENCE_LOW skip).
                if not cfg.dry_run:
                    for pair in found:
                        if pair.confidence == CONFIDENCE_LOW:
                            db.enqueue_manual(
                                conn,
                                reason=REASON_LOW_CONFIDENCE_PAIRING,
                                source_id=pair.source_id,
                                source_tid=pair.source_tid,
                                key_hash=pair.hash(),
                                detail=f"base_url={pair.base_url} evidence={pair.evidence}".strip(),
                            )
                            result.manual_added += 1

        # ------------------------------------------------------------------
        # ⑤ probe - ladder + state machine (07 §四 ⑤, P0-6)
        # ------------------------------------------------------------------
        stage = "probe"
        probed_ids = set()      # rows probed in THIS cycle: never probed twice
        seen_pairs = set()      # (key_hash, base_url) already stored+probed
        for item in classified:
            pairs = pairs_by_tid.get(item.post.tid, [])
            for pair in pairs:
                # The same (key, base_url) shared by several posts of one cycle
                # is ONE credential with ONE row (UNIQUE(key_hash, base_url)):
                # store and probe it exactly once, so a debounced/duplicate
                # answer can never count as a second independent observation
                # (07 §8.3 "dead 需连续 2 次一致 invalid" counts real probes).
                pair_identity = (pair.hash(), pair.base_url)
                if pair_identity in seen_pairs:
                    continue
                if cfg.dry_run:
                    # Rehearsal: probe (read-only HTTP) but persist NOTHING,
                    # even when --dry-run opened the existing DB file.
                    outcome = parts["prober"].probe(pair)
                    result.probe_outcomes += 1
                    _count_probe(result, outcome)
                    seen_pairs.add(pair_identity)
                    continue
                # Persist first so the row id and the previous cross-cycle state
                # are available: "dead 需连续 2 次一致" counts ACROSS cycles
                # (07 §8.3), so the machine must see yesterday's counters.
                try:
                    cid = _store_credential(conn, cfg, item, pair)
                except Exception as exc:  # e.g. FERNET_KEY unset - never store plaintext
                    result.warnings.append(
                        f"store tid={pair.source_tid} skipped: {type(exc).__name__}: {exc}"
                    )
                    continue
                row = db.get_token_key(conn, cid)
                previous = ProbeState(
                    verdict=(row["verdict"] if row else "unknown"),
                    consecutive_failures=(row["consecutive_failures"] if row else 0),
                    last_probe_at=(row["last_probe_at"] if row else 0) or 0,
                    unknown_rounds=db.count_undecided_streak(conn, cid),
                )
                try:
                    outcome = parts["prober"].probe(pair)
                except NotImplementedError:
                    raise
                except Exception as exc:  # 07 §四 "探测异常" -> alert, keep going
                    result.probe_errors += 1
                    result.warnings.append(
                        f"probe tid={pair.source_tid} failed: {type(exc).__name__}: {exc}"
                    )
                    continue
                # Seam fix (the probe owner's CONTRACT-ISSUE 3): probe_log rows
                # join the audit trail by ``token_keys.id``; the prober can only
                # mint ``pair.hash()``, so the cycle stamps the real row id in.
                outcome.credential_id = cid
                result.probe_outcomes += 1
                _count_probe(result, outcome)
                decision = parts["machine"].next(previous, outcome)
                db.insert_probe_log(conn, outcome)
                db.update_verdict(
                    conn, cid, decision.verdict, decision.consecutive_failures,
                    last_probe_at=outcome.probed_at or db.now_ts(),
                )
                _record_transition(result, previous.verdict, decision, cid, pair)
                if decision.escalate:
                    db.enqueue_manual(
                        conn,
                        reason=REASON_UNKNOWN_5_ROUNDS,
                        source_id=pair.source_id,
                        source_tid=pair.source_tid,
                        credential_id=cid,
                        key_hash=pair.hash(),
                        detail=f"verdict={decision.verdict} unknown_rounds={decision.unknown_rounds}",
                    )
                    result.manual_added += 1
                result.stored_keys += 1
                result.stored_by_confidence[pair.confidence] = (
                    result.stored_by_confidence.get(pair.confidence, 0) + 1
                )
                probed_ids.add(cid)
                seen_pairs.add(pair_identity)

        # ------------------------------------------------------------------
        # re-probe existing stock (07 §8.3 复探节奏): non-dead rows ride every
        # 3-hourly cron round; dead rows only once per day (D3 挽回窗口).
        # ------------------------------------------------------------------
        result.dead_due = len(db.select_dead_for_reprobe(conn))
        if not cfg.dry_run:
            for row in db.select_reprobe_candidates(conn):
                if row["id"] in probed_ids:
                    continue  # stored + probed earlier in this very cycle
                if not cfg.fernet_key:
                    # 07 §8.5: without the key the ciphertext is unreadable and
                    # the plaintext must never be reconstructed another way.
                    result.warnings.append("reprobe skipped: FERNET_KEY unset (07 §8.5)")
                    break
                previous = ProbeState(
                    verdict=row["verdict"] or "unknown",
                    consecutive_failures=int(row["consecutive_failures"] or 0),
                    last_probe_at=int(row["last_probe_at"] or 0),
                    unknown_rounds=db.count_undecided_streak(conn, row["id"]),
                )
                outcome = _reprobe_row(cfg, parts, result, row, previous)
                if outcome is None:
                    continue
                decision = parts["machine"].next(previous, outcome)
                db.insert_probe_log(conn, outcome)
                db.update_verdict(
                    conn, row["id"], decision.verdict, decision.consecutive_failures,
                    last_probe_at=outcome.probed_at or db.now_ts(),
                )
                _record_transition(result, previous.verdict, decision, row["id"], None,
                                   key_masked=row["key_masked"],
                                   base_url=row["base_url"],
                                   source_tid=row["source_tid"])
                if decision.escalate:
                    # unknown 连续 5 轮未决 -> 人工队列 (07 §8.3); same rule as
                    # the fresh-key loop above, now for the re-probed stock.
                    db.enqueue_manual(
                        conn,
                        reason=REASON_UNKNOWN_5_ROUNDS,
                        source_id=row["source_id"] or "",
                        source_tid=row["source_tid"],
                        credential_id=row["id"],
                        key_hash=row["key_hash"] or "",
                        detail=f"verdict={decision.verdict} unknown_rounds={decision.unknown_rounds}",
                    )
                    result.manual_added += 1

        # ------------------------------------------------------------------
        # cleanup - probe_log 90d + guide rows 24h + watermark advance
        # (07 §5.1 P0-7, 06 修订; guide TTL added 2026-10-08). The guide prune
        # DOES delete token_keys rows (reply_visible_guide only); dead B-class
        # rows are intentionally kept here for the state machine - the push
        # pipeline filters them out instead.
        # ------------------------------------------------------------------
        stage = "cleanup"
        if not cfg.dry_run:
            result.probe_log_pruned = db.prune_probe_log(conn)
            result.guide_rows_pruned = db.prune_expired_guide_rows(conn)
            if posts:
                db.set_watermark(conn, adapter.source_id, max(p.tid for p in posts))
        result.watermark_after = db.get_watermark(conn, adapter.source_id)

        # ------------------------------------------------------------------
        # ⑥⑦ publish - full snapshot rebuild (07 §四 ⑥⑦, P0-8 / §8.5)
        # ------------------------------------------------------------------
        stage = "publish"
        result.manual_pending = len(db.list_manual(conn))
        result.gate = _gate_snapshot(conn)
        entries = _feed_entries(conn)
        result.feed_entries = len(entries)
        result.finished_at = db.now_ts()
        try:
            xml = parts["feed"].build(entries)
            report = parts["reporter"].build(result.as_dict())
            if not cfg.dry_run:
                parts["feed"].write(xml)
                parts["reporter"].write(report)
        except NotImplementedError:
            raise
        except Exception as exc:  # a publish failure is a warning + alert, not a crash
            result.warnings.append(f"publish failed: {type(exc).__name__}: {exc}")

        # ------------------------------------------------------------------
        # alert - operational failures (07 §四 "运维告警")
        # ------------------------------------------------------------------
        if result.warnings and not cfg.dry_run:
            if alerter.notify(
                f"[warning] cycle had {len(result.warnings)} degraded step(s): "
                + "; ".join(result.warnings[:5])
            ):
                result.alerts_sent += 1
    except NotImplementedError as exc:
        _mark_pending(result, stage, exc)
    finally:
        if own_conn:
            conn.close()
    return result


# ---------------------------------------------------------------------------
# store helpers (owned by the skeleton; they are the only writers)
# ---------------------------------------------------------------------------


def _drain_source_warnings(result: "CycleResult", adapter: Any) -> None:
    """Fold the source adapter's operational warnings into the cycle summary.

    Defensive ``getattr``: injected fakes in unit tests may not carry the
    attributes. ``pending_alerts`` are source-switch alerts that had no sink;
    with the alerter now wired into the adapter they are duplicates by design,
    but the drain still guarantees nothing is lost (07 §5.4 ⑥ evidence).
    """
    drained = list(getattr(adapter, "warnings", None) or [])
    drained.extend(getattr(adapter, "pending_alerts", None) or [])
    for message in drained:
        result.warnings.append(str(message))
    if any("aggregator unreachable" in str(message) for message in drained):
        result.aggregator_fallback = True


def _enqueue_card_record(conn: Any, item: Any) -> None:
    """File one D-class post into ``manual_queue`` as 福利情报 (07 §5.1 P0-9).

    07 §8.1 D row: 站内付费不是白嫖 -> 只记录标题+链接+价格，不提取不探测. The
    price comes from the ``.virtual-card-price`` box of the topic HTML, which
    enrichment sniffed into ``FullPost.virtual_card_price`` (02 §A.5: the box is
    page markup, absent from the JSON-LD ``articleBody``); the body-text scan is
    only a fallback for callers that built the FullPost by hand.
    """
    price = getattr(item.post, "virtual_card_price", "") or ""
    if not price:
        try:
            from classify.rules_linux_sb import card_price

            price = card_price(item.post.article_body or item.post.text or "") or ""
        except Exception:  # presentation detail only - never worth a cycle failure
            price = ""
    raw = item.post.raw
    detail = f"rule={item.matched_rule} {raw.title} | {raw.url}"
    if price:
        detail += f" | price={price}"
    db.enqueue_manual(
        conn,
        reason=REASON_CARD_OR_PAID_BENEFIT_INFO,
        source_id=raw.source_id,
        source_tid=raw.tid,
        detail=detail,
    )


def _count_probe(result: "CycleResult", outcome: Any) -> None:
    """Tally one raw probe verdict label (07 §8.3 探测异常率 input)."""
    label = getattr(outcome, "verdict", "") or "unknown"
    result.probe_verdicts[label] = result.probe_verdicts.get(label, 0) + 1


def _record_transition(result: "CycleResult", old_verdict: str, decision: Any,
                       credential_id: str, pair: Any = None, key_masked: str = "",
                       base_url: str = "", source_tid: Any = None) -> None:
    """Remember a masked-level verdict change for the report (07 §8.3 状态变化).

    Masked fields only - the plaintext key never enters the summary, and
    ``error_message_raw`` is never consulted here (07 §8.5 rules 1/3).
    """
    new_verdict = getattr(decision, "verdict", "")
    if (old_verdict or "unknown") == new_verdict:
        return
    if pair is not None:
        key_masked = key_masked or pair.mask()
        base_url = base_url or pair.base_url
        source_tid = source_tid if source_tid is not None else pair.source_tid
    result.verdict_changes.append({
        "key_masked": key_masked or "(masked)",
        "base_url": base_url or "-",
        "from": old_verdict or "unknown",
        "to": new_verdict,
        "failures": int(getattr(decision, "consecutive_failures", 0) or 0),
        "source_tid": source_tid,
    })


def _reprobe_row(cfg: AppConfig, parts: Dict[str, Any],
                 result: "CycleResult", row: Any, previous: ProbeState) -> Any:
    """Re-probe one persisted credential row; ``None`` when it must be skipped.

    The plaintext lives only in the Fernet ciphertext (07 §8.5 rule 2), so the
    re-probe decrypts it transiently to rebuild the :class:`CredentialPair` the
    prober needs; nothing decrypted is ever persisted. A row whose decrypted
    key no longer matches ``key_hash`` is tampered or legacy - it is skipped
    with a warning, never guessed at.
    """
    import json as _json

    cid = row["id"]
    try:
        key = crypto.decrypt_secret(row["key_encrypted"], cfg.fernet_key)
    except Exception as exc:
        result.warnings.append(
            f"reprobe id={cid[:8]} decrypt failed: {type(exc).__name__}"
        )
        return None
    try:
        models = tuple(_json.loads(row["models"] or "[]"))
    except ValueError:
        models = ()
    pair = CredentialPair(
        key=key,
        base_url=row["base_url"] or "",
        provider=row["provider"] or "",
        models=models,
        confidence=row["confidence"] or CONFIDENCE_LOW,
        origin=row["source"] or KEY_SOURCE_POST,
        source_id=row["source_id"] or "",
        source_tid=int(row["source_tid"] or 0),
    )
    if pair.hash() != (row["key_hash"] or ""):
        result.warnings.append(f"reprobe id={cid[:8]} key_hash mismatch; skipped")
        return None
    try:
        outcome = parts["prober"].probe(pair)
    except NotImplementedError:
        raise
    except Exception as exc:  # 07 §四 "探测异常" -> alert, keep going
        result.probe_errors += 1
        result.warnings.append(
            f"reprobe id={cid[:8]} failed: {type(exc).__name__}: {exc}"
        )
        return None
    outcome.credential_id = cid
    result.probe_outcomes += 1
    _count_probe(result, outcome)
    return outcome


def _gate_snapshot(conn: Any) -> Dict[str, Any]:
    """The 07 §5.5 gate numbers the daily report answers its three questions from."""
    try:
        return dict(db.token_key_stats(conn))
    except Exception as exc:  # reporting must not depend on the store being up
        return {"error": f"{type(exc).__name__}: {exc}"}


def _store_guide(conn: Any, item: Any) -> int:
    """Persist one C-class guide row: link + claim instruction, zero key data.

    07 §8.4 says the C-class guide reuses ``token_keys`` with ``key_hash`` left
    empty, but ``UNIQUE(key_hash, base_url)`` would then collapse every guide
    row onto one record. This writer therefore stores a credential-free
    ``guide_key_hash(source_id, tid)`` sentinel so guide rows are distinct. See
    ARCHITECTURE.md "Known contract tension" - the DDL itself is unchanged.
    """
    raw = item.post.raw
    db.upsert_token_key(
        conn,
        {
            "id": db.new_id(),
            "source_id": raw.source_id,
            "source_tid": raw.tid,
            "source_url": raw.url,
            "source_title": raw.title,
            "source_author": raw.author_name,
            "key_masked": "",
            "key_hash": db.guide_key_hash(raw.source_id, raw.tid),
            "key_encrypted": None,
            "base_url": "",
            "provider": "",
            # 模型名取自公开标题，不含任何 key 数据：指引行也要让用户看见
            # 「值不值得去回帖」，否则站点上已提取的 chips 永远不渲染（2026-10-09）。
            "models": db.models_to_json(find_model_mentions(raw.title or "")),
            "source": "reply_visible_guide",
            "confidence": "high",
            "verdict": "unknown",
            "consecutive_failures": 0,
            "last_probe_at": None,
            "deal_status": "published",
            "post_time": raw.post_time or "",
            "note": "去论坛回复本主题后即可查看（D2 指引，不提取不存储 key）",
        },
    )
    return 1


def _store_credential(conn, cfg: AppConfig, item, pair) -> str:
    """Hash + encrypt + upsert one credential; return its row id (07 §8.4 / §8.5).

    ``key_encrypted`` is the only lawful home of the plaintext key, so
    ``FERNET_KEY`` must be configured before a B-class post can be stored.
    Re-upserting a known pair keeps its verdict / deal_status / history intact -
    see :func:`store.db.upsert_token_key` for the column-ownership rules.
    """
    encrypted = crypto.encrypt_secret(pair.key, cfg.fernet_key)
    return db.upsert_token_key(
        conn,
        {
            "id": db.new_id(),
            "source_id": pair.source_id,
            "source_tid": pair.source_tid,
            "source_url": item.post.raw.url,
            "source_title": item.post.raw.title,
            "source_author": item.post.raw.author_name,
            "key_masked": pair.mask(),
            "key_hash": pair.hash(),
            "key_encrypted": encrypted,
            "base_url": pair.base_url,
            "provider": pair.provider,
            "models": db.models_to_json(pair.models),
            "source": pair.origin,
            "confidence": pair.confidence,
            "post_time": item.post.raw.post_time or "",
            "note": pair.evidence,
        },
    )


def _feed_entries(conn: Any) -> List[FeedEntry]:
    """Rebuild the publishable snapshot straight from the DB (07 §四 ⑦).

    ``select_publishable`` already drops ``dead`` (D3) and ``hidden`` (D12); only
    masked / guide-safe columns are turned into entries, so a plaintext key can
    not reach the feed even by accident (07 §8.5 rule 1). A ``confidence='low'``
    pairing is additionally withheld from the auto-published feed: it is an
    unreviewed guess (07 §8.2 low tier: 1 URL + N keys or vice versa) that P0-9
    files into ``manual_queue`` for a human decision — the row stays in the
    store (the P1 page may show it) but the feed comment "never auto-published"
    is enforced here, not just claimed.
    """
    entries: List[FeedEntry] = []
    for row in db.select_publishable(conn):
        guide = row["source"] == "reply_visible_guide"
        if not guide and row["confidence"] == CONFIDENCE_LOW:
            continue  # P0-9: manual review first - never auto-published
        entries.append(
            FeedEntry(
                source_id=row["source_id"],
                source_tid=row["source_tid"] or 0,
                source_url=row["source_url"],
                title=row["source_title"],
                category="C" if guide else "B",
                verdict=row["verdict"],
                confidence=row["confidence"],
                provider=row["provider"],
                base_url=row["base_url"],
                key_masked="" if guide else row["key_masked"],
                guide_text=row["note"] if guide else "",
                published_at=int(row["first_seen_at"] or 0),
            )
        )
    return entries


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="main.py",
        description="tokenhub forum benefit crawler (P0, 07 §五).",
    )
    p.add_argument("--print-config", action="store_true",
                   help="print the resolved config (secrets masked) and exit")
    p.add_argument("--dry-run", action="store_true",
                   help="run the cycle but persist nothing")
    p.add_argument("--once", action="store_true",
                   help="run exactly one cycle (what cron invokes)")
    p.add_argument("--env", default=None, metavar="PATH", help="path to the .env file")
    p.add_argument("--json", dest="as_json", action="store_true",
                   help="emit the cycle summary as JSON")
    p.add_argument("-v", "--verbose", action="store_true")
    return p


def _print_result(result: "CycleResult", as_json: bool) -> None:
    """Emit the cycle summary - every outbound line passes :func:`alert.scrub`.

    The CLI is the fourth outbound channel (07 §8.5): feed, report and alert
    bodies already scrub credential-shaped strings; the cron log must not
    become the one path where a raw key from an embedded exception text could
    surface, so the JSON dump, the summary line and each stderr warning are
    scrubbed here as well.
    """
    import alert

    if as_json:
        print(alert.scrub(result.to_json()))
        return
    print(alert.scrub(
        f"[{'dry-run' if result.dry_run else 'once'}] "
        f"discovered={result.discovered} enriched={result.enriched} "
        f"degraded={result.enrich_degraded} categories={dict(result.categories)} "
        f"credentials={result.credentials} keys_stored={result.stored_keys} "
        f"guides_stored={result.stored_guides} probes={result.probe_outcomes} "
        f"probe_verdicts={dict(result.probe_verdicts)} "
        f"transitions={result.verdict_changes} "
        f"feed_entries={result.feed_entries} manual+={result.manual_added} "
        f"manual_pending={result.manual_pending} "
        f"pruned={result.probe_log_pruned} guide_pruned={result.guide_rows_pruned} dead_due={result.dead_due} "
        f"fallback={'yes' if result.aggregator_fallback else 'no'} "
        f"alerts={result.alerts_sent} "
        f"watermark={result.watermark_before}->{result.watermark_after}"
    ))
    if result.pending:
        print("pending stages (contract stubs, not implemented yet): "
              + ", ".join(result.pending))
    for warning in result.warnings[:10]:
        print(f"  warn: {alert.scrub(warning)}", file=sys.stderr)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    cfg = load_config(env_path=args.env, dry_run=bool(args.dry_run))

    if args.print_config:
        print(json.dumps(cfg.redacted(), ensure_ascii=False, indent=2, sort_keys=True))
        return 0

    if not (args.dry_run or args.once):
        build_parser().print_help()
        print("\nERROR: choose a mode: --print-config | --dry-run | --once", file=sys.stderr)
        return 2

    # FERNET_KEY handling (07 §8.5: a credential is only ever stored encrypted).
    # Unset is a warning, not a hard stop: with the P0-1 stage stubs no credential
    # can exist yet, and ``--once`` must stay runnable from the repo root. When a
    # credential does show up without a key, the store step degrades (warning +
    # alert, row skipped) - it never falls back to plaintext.
    if not cfg.fernet_key:
        print(
            "warning: FERNET_KEY is unset - any credential found this cycle will be "
            "skipped, never stored in the clear (07 §8.5). Generate one with: "
            "python -c \"import crypto;print(crypto.generate_fernet_key().decode())\"",
            file=sys.stderr,
        )
    else:
        try:
            crypto.get_fernet(cfg.fernet_key)  # fail fast on a malformed key
        except Exception as exc:
            print(f"ERROR: FERNET_KEY is configured but unusable: {exc}", file=sys.stderr)
            return 3

    result = run_cycle(cfg)
    _print_result(result, as_json=bool(args.as_json))
    if args.verbose:
        import alert

        print(alert.scrub(result.to_json()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
