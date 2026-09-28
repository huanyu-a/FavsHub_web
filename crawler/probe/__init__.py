"""Liveness probing package (07 §5.2 ``probe/``, tasks P0-6).

OWNERSHIP: ``probe/`` - probe owner. Never edit ``interfaces.py``, ``store/``,
``crypto.py``, ``config.py``, ``fixtures/``.

Two halves: :mod:`probe.prober` performs the ladder 0-4 requests, :mod:`probe.verdict`
turns one HTTP response into a verdict and folds it into the state machine.
The false-positive rules of 07 §8.3 live in :mod:`probe.verdict`.
"""
