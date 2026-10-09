"""Test packages for the crawler (07 §5.1).

Discovery rule that matters: ``python -m unittest discover -s crawler`` only
walks into sub-directories that are importable packages, so this ``__init__``
must exist for the per-module suites (``tests/test_probe_*.py``) to run at all.
It stays import-free, exactly like ``crawler/__init__.py``: the test modules
bootstrap ``crawler/`` onto ``sys.path`` themselves because every module in this
tree uses flat intra-package imports (``from interfaces import ...``).
"""
