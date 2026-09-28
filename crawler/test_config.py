"""Unit tests for :mod:`config` (07 §5.2 / P0-1 CLI conventions).

Everything runs against temporary files and a saved/restored ``os.environ``, so
no test depends on a real ``crawler/.env`` or on server secrets.
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest

# Put this module's own directory (crawler/, where config.py and crypto.py live)
# first on sys.path, so flat imports resolve under every discovery form -
# implicit top-level AND ``-t .`` (package discovery, where unittest instead
# inserts the repo root). Matches test_store_db.py / test_fixtures_safety.py.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config  # noqa: E402
from config import (  # noqa: E402
    ENV_KEYS,
    SECRET_KEYS,
    AppConfig,
    load_config,
    parse_env_text,
    parse_forums,
    to_bool,
)

FAKE_FERNET = "mZk3s0ExampleFernetKeyExampleKeyExample1234567890="  # not a real key
FAKE_WEBHOOK = "https://oapi.dingtalk.com/robot/send?access_token=sk-TESTFAKEfake0token"


class BoolAndForumParsingTests(unittest.TestCase):
    def test_to_bool_truthy_forms(self):
        for value in ("1", "true", "TRUE", "Yes", "on", " true "):
            self.assertTrue(to_bool(value), value)

    def test_to_bool_falsy_forms(self):
        for value in ("0", "false", "no", "off", "", "  ", "maybe"):
            self.assertFalse(to_bool(value), value)

    def test_to_bool_none_is_false(self):
        self.assertFalse(to_bool(None))

    def test_parse_forums_uses_the_plan_default(self):
        self.assertEqual(parse_forums("2,8,3"), [2, 8, 3])

    def test_parse_forums_tolerates_spaces_and_blanks(self):
        self.assertEqual(parse_forums(" 2 , 8 ,, 3 "), [2, 8, 3])

    def test_parse_forums_drops_junk(self):
        self.assertEqual(parse_forums("2,abc,,8.5,3"), [2, 3])

    def test_parse_forums_empty_inputs(self):
        self.assertEqual(parse_forums(""), [])
        self.assertEqual(parse_forums(None), [])


class EnvParsingTests(unittest.TestCase):
    def test_plain_pairs(self):
        parsed = parse_env_text("A=1\nB=2")
        self.assertEqual(parsed, {"A": "1", "B": "2"})

    def test_comments_and_blank_lines_ignored(self):
        parsed = parse_env_text("# header\n\n   \nDB_PATH=/tmp/x.db  # trailing kept")
        self.assertEqual(list(parsed), ["DB_PATH"])

    def test_export_prefix_stripped(self):
        self.assertEqual(parse_env_text("export UA=curl/8"), {"UA": "curl/8"})

    def test_quotes_removed(self):
        parsed = parse_env_text('A="double"\nB=\'single\'')
        self.assertEqual(parsed, {"A": "double", "B": "single"})

    def test_equals_inside_value_kept(self):
        parsed = parse_env_text("DINGTALK_WEBHOOK=https://x/y?access_token=a=b")
        self.assertEqual(parsed["DINGTALK_WEBHOOK"], "https://x/y?access_token=a=b")

    def test_line_without_equals_ignored(self):
        self.assertEqual(parse_env_text("JUST_A_KEY\nB=1"), {"B": "1"})

    def test_empty_value_allowed(self):
        self.assertEqual(parse_env_text("FERNET_KEY="), {"FERNET_KEY": ""})

    def test_crlf_body(self):
        self.assertEqual(parse_env_text("A=1\r\nB=2\r\n"), {"A": "1", "B": "2"})


class LoadConfigTests(unittest.TestCase):
    def setUp(self):
        self.saved = {k: os.environ.get(k) for k in ENV_KEYS}
        self.tmp = tempfile.TemporaryDirectory()
        for key in ENV_KEYS:
            os.environ.pop(key, None)

    def tearDown(self):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.tmp.cleanup()

    def _write_env(self, body: str) -> str:
        path = os.path.join(self.tmp.name, ".env")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(body)
        return path

    def test_defaults_when_nothing_configured(self):
        cfg = load_config(env_path=os.path.join(self.tmp.name, "missing.env"))
        self.assertEqual(cfg.forums, [2, 8, 3])          # 07 §5.2 FORUMS=2,8,3
        self.assertFalse(cfg.enable_paid_probe)           # 07 §8.3 level 4 default off
        self.assertFalse(cfg.enable_account_farm)         # 07 §7.1 P2 default off
        self.assertEqual(cfg.fernet_key, "")
        self.assertIn("tux298.com", cfg.agg_api_base)     # 07 §三 aggregator

    def test_file_values_are_read(self):
        path = self._write_env(
            "AGG_API_BASE=https://example/api/latest\n"
            "UA=python-urllib/3.11\n"
            "FORUMS=2\n"
            "DB_PATH=" + os.path.join(self.tmp.name, "db.sqlite") + "\n"
            "ENABLE_PAID_PROBE=true\n"
            "FERNET_KEY=" + FAKE_FERNET + "\n"
        )
        cfg = load_config(env_path=path)
        self.assertEqual(cfg.agg_api_base, "https://example/api/latest")
        self.assertEqual(cfg.ua, "python-urllib/3.11")
        self.assertEqual(cfg.forums, [2])
        self.assertTrue(cfg.enable_paid_probe)
        self.assertEqual(cfg.fernet_key, FAKE_FERNET)

    def test_process_environment_wins_over_file(self):
        path = self._write_env("UA=from-file\n")
        os.environ["UA"] = "from-environ"
        self.assertEqual(load_config(env_path=path).ua, "from-environ")

    def test_dry_run_flag_is_carried(self):
        cfg = load_config(env_path=os.path.join(self.tmp.name, "none"), dry_run=True)
        self.assertTrue(cfg.dry_run)

    def test_missing_env_file_is_not_an_error(self):
        cfg = load_config(env_path=os.path.join(self.tmp.name, "nope.env"))
        self.assertIsInstance(cfg, AppConfig)

    def test_forums_non_numeric_dropped(self):
        path = self._write_env("FORUMS=2,x,8\n")
        self.assertEqual(load_config(env_path=path).forums, [2, 8])


class RedactionTests(unittest.TestCase):
    def _cfg(self) -> AppConfig:
        return AppConfig(
            agg_api_base="https://example/api/latest",
            ua="UA/1",
            forums=[2, 8, 3],
            db_path="/tmp/tokenhub.db",
            dingtalk_webhook=FAKE_WEBHOOK,
            enable_paid_probe=False,
            enable_account_farm=False,
            fernet_key=FAKE_FERNET,
        )

    def test_secrets_never_appear_in_redacted_output(self):
        blob = str(self._cfg().redacted())
        self.assertNotIn(FAKE_FERNET, blob)
        self.assertNotIn("sk-TESTFAKEfake0token", blob)
        self.assertNotIn("access_token", blob)

    def test_secrets_are_fully_starred(self):
        out = self._cfg().redacted()
        self.assertEqual(out["FERNET_KEY"], "*" * len(FAKE_FERNET))
        self.assertEqual(out["DINGTALK_WEBHOOK"], "*" * len(FAKE_WEBHOOK))

    def test_unset_secrets_are_labelled(self):
        cfg = self._cfg()
        cfg.fernet_key = ""
        cfg.dingtalk_webhook = ""
        out = cfg.redacted()
        self.assertEqual(out["FERNET_KEY"], "(unset)")
        self.assertEqual(out["DINGTALK_WEBHOOK"], "(unset)")

    def test_non_secret_fields_are_readable(self):
        out = self._cfg().redacted()
        self.assertEqual(out["FORUMS"], "2,8,3")
        self.assertEqual(out["ENABLE_PAID_PROBE"], "false")
        self.assertEqual(out["DB_PATH"], "/tmp/tokenhub.db")

    def test_repr_of_config_hides_the_fernet_key(self):
        self.assertNotIn(FAKE_FERNET, repr(self._cfg()))

    def test_declared_secret_keys_exist(self):
        self.assertIn("FERNET_KEY", SECRET_KEYS)
        self.assertIn("DINGTALK_WEBHOOK", SECRET_KEYS)
        for key in SECRET_KEYS:
            self.assertIn(key, ENV_KEYS)

    def test_print_config_variable_set_matches_the_plan(self):
        # 07 §5.2 .env.example lists exactly these seven, plus FERNET_KEY (§8.4).
        self.assertEqual(
            set(ENV_KEYS),
            {
                "AGG_API_BASE",
                "UA",
                "DB_PATH",
                "FORUMS",
                "DINGTALK_WEBHOOK",
                "ENABLE_PAID_PROBE",
                "ENABLE_ACCOUNT_FARM",
                "FERNET_KEY",
            },
        )


class PathTests(unittest.TestCase):
    def test_derived_paths_live_next_to_the_db(self):
        cfg = AppConfig("", "", [], os.path.join("/data", "tokenhub.db"), "", False, False)
        self.assertEqual(cfg.feed_path, os.path.join("/data", "feed.xml"))
        self.assertEqual(cfg.report_dir, os.path.join("/data", "reports"))

    def test_ensure_data_dir_creates_both_dirs(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = os.path.join(tmp, "data", "tokenhub.db")
            cfg = AppConfig("", "", [], db, "", False, False)
            cfg.ensure_data_dir()
            self.assertTrue(os.path.isdir(os.path.dirname(db)))
            self.assertTrue(os.path.isdir(cfg.report_dir))

    def test_ensure_data_dir_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = AppConfig("", "", [], os.path.join(tmp, "d", "t.db"), "", False, False)
            cfg.ensure_data_dir()
            cfg.ensure_data_dir()


if __name__ == "__main__":
    unittest.main()
