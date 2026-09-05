#!/usr/bin/env python3
"""
Generate a signing keypair, and mint license keys with it.

    python keygen.py init                     # once, ever
    python keygen.py issue app1: 200          # mint 200 keys

`init` writes two files:

    keys/private-key.pem   NEVER share, never commit, back it up offline
    keys/public-key.json   paste this into your extension

Losing the private key means you can never issue another valid license for
that extension. Leaking it means anyone can — and since verification is
offline, you cannot revoke what they mint. Treat it like a root CA key.

Requires:  pip install cryptography
"""

import base64
import json
import os
import secrets
import sys
from datetime import datetime, timezone

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

KEY_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "keys")
PRIVATE_PEM = os.path.join(KEY_DIR, "private-key.pem")
PUBLIC_JSON = os.path.join(KEY_DIR, "public-key.json")

# URL-safe and unambiguous. The payload is random, not encoded data — it
# carries no meaning, it just has to be unique and signable.
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
PAYLOAD_LEN = 12


def b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def cmd_init() -> None:
    if os.path.exists(PRIVATE_PEM):
        sys.exit(
            "Refusing to overwrite %s\n"
            "A new keypair would invalidate every license already issued.\n"
            "Delete it deliberately if that is really what you want." % PRIVATE_PEM
        )

    os.makedirs(KEY_DIR, exist_ok=True)
    private = ec.generate_private_key(ec.SECP256R1())

    with open(PRIVATE_PEM, "wb") as fh:
        fh.write(
            private.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )
    try:
        os.chmod(PRIVATE_PEM, 0o600)
    except OSError:
        pass  # Windows

    numbers = private.public_key().public_numbers()
    jwk = {
        "kty": "EC",
        "crv": "P-256",
        "x": b64u(numbers.x.to_bytes(32, "big")),
        "y": b64u(numbers.y.to_bytes(32, "big")),
        "ext": True,
        "key_ops": ["verify"],
    }
    with open(PUBLIC_JSON, "w", encoding="utf-8") as fh:
        json.dump(jwk, fh, indent=2)
        fh.write("\n")

    print("private key  %s   <- never share, never commit, back up offline" % PRIVATE_PEM)
    print("public  key  %s   <- embed this in your extension" % PUBLIC_JSON)
    print()
    print(json.dumps(jwk, indent=2))


def load_private():
    if not os.path.exists(PRIVATE_PEM):
        sys.exit("No private key yet. Run:  python keygen.py init")
    with open(PRIVATE_PEM, "rb") as fh:
        return serialization.load_pem_private_key(fh.read(), password=None)


def sign(private, payload: str) -> str:
    """
    Sign, then convert DER -> raw r||s.

    This conversion is the step everyone gets wrong. `cryptography` returns a
    DER-encoded signature; Web Crypto's ECDSA verify expects raw r||s, fixed
    at 32 bytes each for P-256. Hand it DER and verify() returns false with no
    error and no explanation.
    """
    der = private.sign(payload.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    return b64u(r.to_bytes(32, "big") + s.to_bytes(32, "big"))


def cmd_issue(prefix: str, count: int) -> None:
    private = load_private()
    os.makedirs(KEY_DIR, exist_ok=True)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    safe = "".join(c for c in prefix if c.isalnum()) or "keys"
    out = os.path.join(KEY_DIR, "licenses-%s-%s.csv" % (safe, stamp))

    with open(out, "w", encoding="utf-8", newline="") as fh:
        fh.write("key,used_by,used_at,sale_id\n")
        for _ in range(count):
            payload = prefix + "".join(secrets.choice(ALPHABET) for _ in range(PAYLOAD_LEN))
            fh.write("%s.%s,,,\n" % (payload, sign(private, payload)))

    # Deliberately not printed. Keys are bearer tokens; anything on a terminal
    # ends up in scrollback, screenshots, and CI logs.
    print("%d keys written to %s" % (count, out))
    print("The keys are not shown here on purpose. Open the file.")


def main() -> None:
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)

    if args[0] == "init":
        cmd_init()
    elif args[0] == "issue":
        if len(args) != 3:
            sys.exit("usage: python keygen.py issue <prefix> <count>\n"
                     "   eg: python keygen.py issue app1: 200")
        try:
            count = int(args[2])
        except ValueError:
            sys.exit("count must be a number")
        if count < 1 or count > 100000:
            sys.exit("count must be between 1 and 100000")
        cmd_issue(args[1], count)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
