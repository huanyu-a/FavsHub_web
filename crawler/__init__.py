"""tokenhub forum-benefit crawler (P0, docs/07-最终执行方案.md §五).

This file is deliberately **import-free**: it only marks ``crawler`` as a package
so that ``python -m unittest discover -s crawler`` can resolve the start
directory as an importable package under every invocation form (implicit
top-level, ``-t .``, or a dotted module name). A bare directory is not importable
when the discovery top-level differs from the start dir (CPython
``unittest.loader.discover`` raises "Start directory is not importable").

No runtime imports are performed here on purpose. Every module in this tree uses
**flat** intra-package imports (``import crypto``, ``from store import db``,
``from interfaces import ...``), which rely on ``crawler/`` being on ``sys.path``
: ``main.py`` adds it explicitly (``sys.path.insert(0, os.path.dirname(...))``),
the test modules add it themselves, and ``unittest`` adds it as the discovery
top-level. Importing siblings from this ``__init__`` would run before that path
is guaranteed and break the ``python crawler/main.py --once`` entry point, so it
must stay empty of imports.
"""
