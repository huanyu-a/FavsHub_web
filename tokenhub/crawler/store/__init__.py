"""Storage package (07 §5.2 ``store/``, task P0-7).

OWNERSHIP: skeleton author. Implementation owners must not edit it; call the
functions and report anything missing.

Contract entry point: :mod:`store.db` - the schema from 07 §8.4 plus
``crawl_state`` (tid watermark) and ``manual_queue`` (P0-9). Every statement is
parameterised, and ``token_keys`` is written through
:meth:`store.db.upsert_token_key` so ``UNIQUE(key_hash, base_url)`` dedupes
across cycles (07 §5.1 P0-7 acceptance: two runs, no duplicates).
"""
