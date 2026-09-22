import json

from cryptography.fernet import Fernet

from app.config import settings


class MasterKeyMissing(RuntimeError):
    def __init__(self):
        super().__init__(
            "BROKER_MASTER_KEY is not set. Generate one with: "
            ".venv/bin/python -c "
            '"from cryptography.fernet import Fernet; '
            'print(Fernet.generate_key().decode())" '
            "and set BROKER_MASTER_KEY in the environment or .env."
        )


def _fernet() -> Fernet:
    if settings.broker_master_key is None:
        raise MasterKeyMissing()
    return Fernet(settings.broker_master_key.get_secret_value())


def encrypt_json(data: dict) -> str:
    return _fernet().encrypt(json.dumps(data).encode()).decode()


def decrypt_json(token: str) -> dict:
    return json.loads(_fernet().decrypt(token.encode()).decode())
