"""Unit tests for :mod:`crypto` (07 §8.4 / §8.5).

Self-contained: the Fernet key is generated in-process, never read from a real
``.env``, and every credential material here uses the ``sk-TESTFAKE`` prefix.
"""
from __future__ import annotations

import hashlib
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import crypto  # noqa: E402

FAKE = "sk-TESTFAKEa1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6"


class MaskTests(unittest.TestCase):
    def test_keeps_first_six_and_last_four(self):
        masked = crypto.mask("abcdefghij1234")
        self.assertEqual(masked[:6], "abcdef")
        self.assertEqual(masked[-4:], "1234")
        self.assertEqual(len(masked), len("abcdefghij1234"))

    def test_never_returns_the_plaintext(self):
        for secret in (FAKE, "sk-TESTFAKEshort", "x" * 11):
            self.assertNotEqual(crypto.mask(secret), secret)
            self.assertNotIn(secret, crypto.mask(secret))

    def test_middle_is_star_filled(self):
        masked = crypto.mask("abcdefghij1234")
        self.assertEqual(masked[6:-4], "*" * (len(masked) - 10))

    def test_short_and_empty_are_fully_redacted(self):
        self.assertEqual(crypto.mask("sk-TEST"), "*******")
        self.assertEqual(crypto.mask(""), "")
        self.assertEqual(crypto.mask(None), "")

    def test_boundary_length_returns_all_stars(self):
        # 6 + 4 = 10 -> no character is safe to show.
        self.assertEqual(crypto.mask("0123456789"), "*" * 10)

    def test_constants_match_the_plan(self):
        self.assertEqual(crypto.MASK_PREFIX_LEN, 6)
        self.assertEqual(crypto.MASK_SUFFIX_LEN, 4)


class Sha256Tests(unittest.TestCase):
    def test_known_vector(self):
        self.assertEqual(
            crypto.sha256_hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        )

    def test_stable_and_lowercase_hex(self):
        digest = crypto.sha256_hex(FAKE)
        self.assertEqual(digest, crypto.sha256_hex(FAKE))
        self.assertEqual(len(digest), 64)
        self.assertEqual(digest, digest.lower())
        self.assertEqual(digest, hashlib.sha256(FAKE.encode("utf-8")).hexdigest())

    def test_empty_string_hashes_not_raises(self):
        self.assertEqual(
            crypto.sha256_hex(""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        )

    def test_different_keys_different_hashes(self):
        self.assertNotEqual(crypto.sha256_hex(FAKE), crypto.sha256_hex(FAKE + "x"))


class FernetTests(unittest.TestCase):
    def setUp(self):
        self.key = crypto.generate_fernet_key()

    def test_roundtrip(self):
        token = crypto.encrypt_secret(FAKE, self.key)
        self.assertEqual(crypto.decrypt_secret(token, self.key), FAKE)

    def test_ciphertext_does_not_contain_plaintext(self):
        token = crypto.encrypt_secret(FAKE, self.key)
        self.assertNotIn(FAKE, token)
        self.assertIsInstance(token, str)

    def test_ciphertext_is_non_deterministic_but_both_decrypt(self):
        a = crypto.encrypt_secret(FAKE, self.key)
        b = crypto.encrypt_secret(FAKE, self.key)
        self.assertNotEqual(a, b)  # Fernet embeds an IV + timestamp
        self.assertEqual(crypto.decrypt_secret(a, self.key), crypto.decrypt_secret(b, self.key))

    def test_wrong_key_cannot_decrypt(self):
        token = crypto.encrypt_secret(FAKE, self.key)
        from cryptography.fernet import InvalidToken

        with self.assertRaises(InvalidToken):
            crypto.decrypt_secret(token, crypto.generate_fernet_key())

    def test_tampered_token_rejected(self):
        token = crypto.encrypt_secret(FAKE, self.key)
        flipped = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")
        from cryptography.fernet import InvalidToken

        with self.assertRaises(InvalidToken):
            crypto.decrypt_secret(flipped, self.key)

    def test_str_key_and_bytes_key_both_accepted(self):
        as_str = self.key.decode("ascii")
        self.assertEqual(crypto.decrypt_secret(crypto.encrypt_secret(FAKE, as_str), self.key), FAKE)

    def test_missing_key_raises_without_touching_plaintext(self):
        saved = os.environ.pop("FERNET_KEY", None)
        try:
            with self.assertRaises(ValueError):
                crypto.encrypt_secret(FAKE, None)
        finally:
            if saved is not None:
                os.environ["FERNET_KEY"] = saved

    def test_empty_key_raises(self):
        with self.assertRaises(ValueError):
            crypto.get_fernet("")

    def test_generate_key_is_usable_by_fernet_directly(self):
        from cryptography.fernet import Fernet

        f = Fernet(crypto.generate_fernet_key())
        self.assertEqual(f.decrypt(f.encrypt(b"round")).decode(), "round")

    def test_get_fernet_returns_a_working_instance(self):
        # No caching in crypto.py - just verify the object it hands back works.
        f = crypto.get_fernet(self.key)
        self.assertEqual(f.decrypt(f.encrypt(b"round")).decode(), "round")

    def test_unicode_secret_survives(self):
        secret = "sk-TESTFAKE-中文-emoji-🔒"
        self.assertEqual(crypto.decrypt_secret(crypto.encrypt_secret(secret, self.key), self.key), secret)

    def test_none_plaintext_is_rejected(self):
        with self.assertRaises(ValueError):
            crypto.encrypt_secret(None, self.key)


if __name__ == "__main__":
    unittest.main()
