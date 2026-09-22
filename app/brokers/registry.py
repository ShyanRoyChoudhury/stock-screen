"""Maps a BrokerAccount.broker string to a concrete BrokerClient factory.

Broker implementations register themselves with `@register("<broker>")` on
import (see app.brokers.crypto for the credential encryption they rely on).
No concrete client is registered yet in this phase — the Groww client lands
in a later phase — so `client_for` currently 501s for every broker.
"""

from typing import Callable

from fastapi import HTTPException

from app.brokers.base import BrokerClient
from app.brokers.crypto import decrypt_json
from app.models import BrokerAccount

_CLIENTS: dict[str, Callable[[BrokerAccount, dict], BrokerClient]] = {}


def register(broker: str):
    def decorator(factory: Callable[[BrokerAccount, dict], BrokerClient]):
        _CLIENTS[broker] = factory
        return factory

    return decorator


def client_for(account: BrokerAccount) -> BrokerClient:
    factory = _CLIENTS.get(account.broker)
    if factory is None:
        raise HTTPException(501, f"no client registered for broker {account.broker}")
    credentials = decrypt_json(account.credentials_enc)
    return factory(account, credentials)
