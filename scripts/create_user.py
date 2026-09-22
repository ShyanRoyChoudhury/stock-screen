"""Create a User and print their API key.

The raw API key is generated here, shown exactly once, and never stored —
only its sha256 hash lands in the database (see app.auth). If it's lost,
the only recovery is creating a new key for the user.

Run: .venv/bin/python scripts/create_user.py --name <name> [--email <email>]
"""

import argparse
import sys

from sqlalchemy import select

sys.path.insert(0, ".")
from app.auth import hash_api_key, new_api_key  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import User  # noqa: E402

parser = argparse.ArgumentParser()
parser.add_argument("--name", required=True)
parser.add_argument("--email")
args = parser.parse_args()

with SessionLocal() as session:
    if args.email:
        existing = session.scalar(select(User).where(User.email == args.email))
        if existing:
            print(f"a user with email {args.email} already exists (id={existing.id})")
            sys.exit(1)

    raw_key = new_api_key()
    user = User(name=args.name, email=args.email, api_key_hash=hash_api_key(raw_key))
    session.add(user)
    session.commit()
    session.refresh(user)

    print(f"created user id={user.id} name={user.name!r} email={user.email!r}")
    print()
    print(f"API key (shown once, cannot be recovered): {raw_key}")
