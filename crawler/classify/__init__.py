"""Classifier package (07 5.2 ``classify/``, task P0-4).

OWNERSHIP: ``classify/`` - classifier owner. Never edit ``interfaces.py``,
``store/``, ``crypto.py``, ``config.py``, ``fixtures/``.

Decision order is fixed by 07 8.1: **B -> C -> D -> A -> E**, and B must be
tested before C (tid 23295 proves a credential can sit inside a reply-gate, so
it is B, not C). Low-confidence results go to ``manual_queue``.
"""
