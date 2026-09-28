"""Cron entry point: CLI + ``run_cycle`` orchestration (07 §5.2 / §四, P0-1).

Mirrors the ``sync-nexus.py`` conventions the plan copies (07 §三 / D7):
``--print-config`` / ``--dry-run`` / ``--once`` plus a ``.env.example``.

Run from the repository root (this is a required entry point):

    python crawler/main.py --print-config
    python crawler/main.py --dry-run
    python crawler/main.py --once

The stage order is the one fixed by 07 §四:
discover -> enrich -> classify -> extract -> probe -> store -> publish ->
cleanup -> alert. In the P0 skeleton every stage module is a contract stub that
raises ``NotImplementedError``; an unimplemented stage is recorded in
``CycleResult.pending`` and the cycle finishes cleanly with exit code 0 so the
CLI, the DB schema and the cron plumbing are verifiable before the four
implementers land their code. Once a stage is implemented it simply stops
raising and starts contributing to the cycle.
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
    CONFIDENCE_LOW,
    REASON_LOW_CONFIDENCE_CLASSIFY,
    REASON_LOW_CONFIDENCE_PAIRING,
    REASON_UNKNOWN_5_ROUNDS,
    FeedEntry,
    ProbeState,
)
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
    credentials: int = 0
    stored_keys: int = 0
    stored_guides: int = 0
    probe_outcomes: int = 0
    feed_entries: int = 0
    manual_added: int = 0
    probe_log_pruned: int = 0
    dead_due: int = 0
    #: Stage names that raised ``NotImplementedError`` (skeleton placeholders).
    pending: List[str] = field(default_factory=list)
    #: Non-fatal problems worth an alert (07 §四 "解析失败即告警降级").
    warnings: List[str] = field(default_factory=list)
    alerts_sent: int = 0

    def as_dict(self) -> Dict[str, Any]:
        out = dict(self.__dict__)
        out["categories"] = dict(self.categories)
        return out

    def to_json(self) -> str:
        return json.dumps(self.as_dict(), ensure_ascii=False, indent=2, sort_keys=True)


def build_components(cfg: AppConfig, transport: Any = None) -> Dict[str, Any]:
    """Instantiate the eight pipeline stages from their contract classes.

    ``transport`` is only threaded into the alerter so tests can fake DingTalk
    without monkey-patching.
    """
    from classify.engine import RuleEngine
    from extract.credentials import LayeredExtractor
    from probe.prober import HttpProber
    from probe.verdict import StateMachine
    from publish.feed import RssFeed
    from publish.report import DailyReport
    from sources.linux_sb import LinuxSbAdapter

    return {
        # The adapter takes plain values (not the whole AppConfig) so it can be
        # unit-tested with a fake config object.
        "adapter": LinuxSbAdapter(cfg.agg_api_base, cfg.ua, cfg.forums),
        "classifier": RuleEngine(cfg),
        "extractor": LayeredExtractor(cfg),
        "prober": HttpProber(cfg),
        "machine": StateMachine(cfg),
        "feed": RssFeed(cfg),
        "reporter": DailyReport(cfg),
        "alerter": build_alerter(cfg.dingtalk_webhook, transport=transport),
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
            item = parts["classifier"].classify(full)
            classified.append(item)
            result.categories[item.category] = result.categories.get(item.category, 0) + 1
            if item.low_confidence and not cfg.dry_run:
                db.enqueue_manual(
                    conn,
                    reason=REASON_LOW_CONFIDENCE_CLASSIFY,
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
                    result.stored_guides += _store_guide(conn, item)
                continue
            found = parts["extractor"].extract(item.post)
            if found:
                pairs_by_tid[item.post.tid] = list(found)
                result.credentials += len(found)
                # 07 §5.1 P0-9: a "low" pairing (one URL + N keys, or vice versa)
                # is never auto-published; it goes to the manual queue.
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
        for item in classified:
            pairs = pairs_by_tid.get(item.post.tid, [])
            for pair in pairs:
                if cfg.dry_run:
                    outcome = parts["prober"].probe(pair)
                    result.probe_outcomes += 1
                    db.insert_probe_log(conn, outcome)  # in-memory DB only
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
                    unknown_rounds=db.count_unknown_streak(conn, cid),
                )
                try:
                    outcome = parts["prober"].probe(pair)
                except NotImplementedError:
                    raise
                except Exception as exc:  # 07 §四 "探测异常" -> alert, keep going
                    result.warnings.append(
                        f"probe tid={pair.source_tid} failed: {type(exc).__name__}: {exc}"
                    )
                    continue
                result.probe_outcomes += 1
                decision = parts["machine"].next(previous, outcome)
                db.insert_probe_log(conn, outcome)
                db.update_verdict(
                    conn, cid, decision.verdict, decision.consecutive_failures,
                    last_probe_at=outcome.probed_at or db.now_ts(),
                )
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

        # ------------------------------------------------------------------
        # dead re-probe set (07 §8.3 "dead 每天复探 1 次可挽回") - reported here,
        # probed by the probe owner's scheduler in P1; the filter is the contract.
        # ------------------------------------------------------------------
        result.dead_due = len(db.select_dead_for_reprobe(conn))

        # ------------------------------------------------------------------
        # ⑥⑦ publish - full snapshot rebuild (07 §四 ⑥⑦, P0-8 / §8.5)
        # ------------------------------------------------------------------
        stage = "publish"
        entries = _feed_entries(conn)
        result.feed_entries = len(entries)
        xml = parts["feed"].build(entries)
        report = parts["reporter"].build(result.as_dict())
        if not cfg.dry_run:
            parts["feed"].write(xml)
            parts["reporter"].write(report)

        # ------------------------------------------------------------------
        # cleanup - probe_log 90d (07 §5.1 P0-7, 06 修订)
        # ------------------------------------------------------------------
        stage = "cleanup"
        if not cfg.dry_run:
            result.probe_log_pruned = db.prune_probe_log(conn)
            if posts:
                db.set_watermark(conn, adapter.source_id, max(p.tid for p in posts))
        result.watermark_after = db.get_watermark(conn, adapter.source_id)

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
            "models": "[]",
            "source": "reply_visible_guide",
            "confidence": "high",
            "verdict": "unknown",
            "consecutive_failures": 0,
            "last_probe_at": None,
            "deal_status": "published",
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
            "note": pair.evidence,
        },
    )


def _feed_entries(conn: Any) -> List[FeedEntry]:
    """Rebuild the publishable snapshot straight from the DB (07 §四 ⑦).

    ``select_publishable`` already drops ``dead`` (D3) and ``hidden`` (D12); only
    masked / guide-safe columns are turned into entries, so a plaintext key can
    not reach the feed even by accident (07 §8.5 rule 1).
    """
    entries: List[FeedEntry] = []
    for row in db.select_publishable(conn):
        guide = row["source"] == "reply_visible_guide"
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
    if args.as_json:
        print(result.to_json())
    else:
        print(
            f"[{'dry-run' if cfg.dry_run else 'once'}] "
            f"discovered={result.discovered} enriched={result.enriched} "
            f"degraded={result.enrich_degraded} categories={dict(result.categories)} "
            f"credentials={result.credentials} keys_stored={result.stored_keys} "
            f"guides_stored={result.stored_guides} probes={result.probe_outcomes} "
            f"feed_entries={result.feed_entries} manual+={result.manual_added} "
            f"pruned={result.probe_log_pruned} dead_due={result.dead_due} "
            f"watermark={result.watermark_before}->{result.watermark_after}"
        )
        if result.pending:
            print("pending stages (contract stubs, not implemented yet): "
                  + ", ".join(result.pending))
        for warning in result.warnings[:10]:
            print(f"  warn: {warning}", file=sys.stderr)
    if args.verbose:
        print(result.to_json())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
