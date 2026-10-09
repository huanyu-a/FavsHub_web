"""Credential extraction package (07 §5.2 ``extract/``, task P0-5).

OWNERSHIP: ``extract/`` belongs to the extractor owner. Never edit
``interfaces.py``, ``store/``, ``crypto.py``, ``config.py``, ``main.py``,
``alert.py`` or ``fixtures/``.

Contract entry point: :class:`extract.credentials.LayeredExtractor`, which
implements :class:`interfaces.CredentialExtractor`. The layered patterns, the
prefix -> provider hints and the pairing confidence levels all come from
:mod:`interfaces` (transcribed verbatim from 07 §8.2) - import them, never
retype them.

This stage only ever sees posts the classifier called **B**. A C
(reply-gated) post must never be pushed through here: 07 §5.3 and D2 forbid
touching gated content, and ``main.run_cycle`` enforces that by routing C
straight to a guide row.
"""
