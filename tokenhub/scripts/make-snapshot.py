"""Make a clean (checkpointed) snapshot of the crawler SQLite DB.

SQLite WAL databases cannot be copied file-by-file while hot; the standard
library ``Connection.backup`` gives a consistent snapshot instead. Kept to the
tokenhub/scripts folder next to run-round.cmd (local crawl box only).
Stdlib only, prints counters, never key material (docs/07 §8.5).
"""
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "crawler" / "data" / "tokenhub.db"
DST = ROOT / "crawler" / "data" / "snapshot.db"

src = sqlite3.connect(str(SRC))
dst = sqlite3.connect(str(DST))
src.backup(dst)
dst.close()
src.close()

c = sqlite3.connect(f"file:{DST.as_posix()}?mode=ro", uri=True)
published = c.execute("SELECT COUNT(*) FROM token_keys WHERE deal_status='published'").fetchone()[0]
watermark = c.execute("SELECT COALESCE(MAX(last_tid), 0) FROM crawl_state").fetchone()[0]
c.close()
print(f"snapshot: {published} published rows, watermark {watermark}")
