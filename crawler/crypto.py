"""Secret handling: Fernet encryption, masking, hashing (07 8.4 / 8.5).

Owned by the skeleton author. Implementers must treat this as read-only and
route every credential through :func:`encrypt_secret` before it is written to
SQLite, and through :func:`mask` / :func:`sha256_hex` for display / dedupe.

Red lines enforced here (07 8.5):
  * the plaintext key is only ever accepted as an argument and returned to the
    caller that must encrypt it immediately;
  * :func:`mask` never reproduces the whole key (first 6 + last 4, 07 8.4);
  * :func:`sha256_hex` is the dedupe hash stored in ``token_keys.key_hash``.

Only ``cryptography`` (Fernet) plus the standard library are used. The Fernet
key comes from the ``FERNET_KEY`` environment variable (server ``.env``, kept
with the same care as the PAT; never in git / pages / logs).
"""
from __future__ import annotations

import hashlib
import os
from typing import Optional, Union

from cryptography.fernet import Fernet

__all__ = [
    "MASK_PREFIX_LEN",
    "MASK_SUFFIX_LEN",
    "generate_fernet_key",
    "get_fernet",
    "encrypt_secret",
    "decrypt_secret",
    "mask",
    "mask_full",
    "sha256_hex",
]

#: ``key_masked`` shows the first 6 + last 4 characters (07 8.4).
MASK_PREFIX_LEN = 6
MASK_SUFFIX_LEN = 4


def generate_fernet_key() -> bytes:
    """Return a fresh url-safe base64 Fernet key (for ``.env`` bootstrapping)."""
    return Fernet.generate_key()


def _coerce_key(key: Optional[Union[str, bytes]]) -> bytes:
    if key is None:
        key = os.environ.get("FERNET_KEY", "").strip()
    if isinstance(key, str):
        key = key.encode("ascii", "ignore")
    if not key:
        raise ValueError(
            "FERNET_KEY is not configured. Set it in the environment / .env "
            "(generate with python -c \"from crypto import generate_fernet_key;print(generate_fernet_key().decode())\")."
        )
    return key


def get_fernet(key: Optional[Union[str, bytes]] = None) -> Fernet:
    """Build a :class:`Fernet` instance from ``key`` or the ``FERNET_KEY`` env."""
    return Fernet(_coerce_key(key))


def encrypt_secret(plaintext: str, key: Optional[Union[str, bytes]] = None) -> str:
    """Encrypt a plaintext secret into a str token safe for a SQLite TEXT column."""
    if plaintext is None:
        raise ValueError("cannot encrypt None")
    token = get_fernet(key).encrypt(plaintext.encode("utf-8"))
    return token.decode("ascii")


def decrypt_secret(token: Union[str, bytes], key: Optional[Union[str, bytes]] = None) -> str:
    """Decrypt a token produced by :func:`encrypt_secret` back to plaintext."""
    if isinstance(token, str):
        token = token.encode("ascii")
    return get_fernet(key).decrypt(token).decode("utf-8")


def mask(secret: str) -> str:
    """Masked display form: first 6 + ``*`` fill + last 4 (07 8.4).

    Never returns the full value. Short / empty secrets are fully redacted so a
    partial reveal cannot happen for, say, a malformed credential.
    """
    if not secret:
        return ""
    total = len(secret)
    if total <= MASK_PREFIX_LEN + MASK_SUFFIX_LEN:
        # Too short to show any useful fragment safely -> fully redact.
        return "*" * total
    prefix = secret[:MASK_PREFIX_LEN]
    suffix = secret[-MASK_SUFFIX_LEN:]
    fill = "*" * (total - MASK_PREFIX_LEN - MASK_SUFFIX_LEN)
    return f"{prefix}{fill}{suffix}"


def mask_full(secret: Optional[str]) -> str:
    """Redact an entire secret - for config values, not for credentials.

    :func:`mask` deliberately reveals the first 6 + last 4 characters because
    07 §8.4 wants ``key_masked`` to be recognisable to a human. That is the wrong
    shape for a Fernet key or a webhook URL, where any visible character is a
    leak (07 §8.5), so ``--print-config`` uses this instead.
    """
    if not secret:
        return ""
    return "*" * len(secret)


def sha256_hex(secret: str) -> str:
    """Lowercase hex sha256 of the secret; used for ``token_keys.key_hash`` dedupe."""
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()
