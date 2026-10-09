"""Publishing package (07 §5.2 ``publish/``, tasks P0-8 / P0-9).

OWNERSHIP: ``publish/`` is currently the skeleton author's; the publisher owner
takes it over when P0-8 starts. It is the only stage allowed to produce files
under ``crawler/data/`` (feed.xml, reports/), and everything it writes is
public-facing by construction, so 07 §8.5 applies to every byte:

  * the feed carries ``key_masked`` (first 6 + last 4) only - never a plaintext
    key, and never a ``key_encrypted`` token (:func:`store.db.select_publishable`
    is the read path that makes that structural);
  * ``verdict='dead'`` rows are excluded from the feed but stay on the page,
    greyed and filterable (D3);
  * ``deal_status='hidden'`` rows are excluded everywhere (D12);
  * ``error_message_raw`` from ``probe_log`` must never be rendered (07 §8.5).

Contract entry points: :class:`publish.feed.RssFeed` (RSS 2.0, atomic write) and
:class:`publish.report.DailyReport`.
"""
