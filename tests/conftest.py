import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import delete, select, update

import app.config as config_module
from app.auth import hash_api_key, new_api_key
from app.db import SessionLocal
from app.main import app
from app.models import (
    BrokerAccount,
    BrokerHoldingSnapshot,
    BrokerTrade,
    Position,
    PositionEvaluation,
    SellAllocation,
    User,
)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def master_key(monkeypatch):
    """Give the process a broker master key for the duration of the test."""
    monkeypatch.setattr(
        config_module.settings,
        "broker_master_key",
        SecretStr(Fernet.generate_key().decode()),
    )
    yield


@pytest.fixture
def test_user():
    """Insert a fresh User with a usable API key; tear down everything it
    touched (evaluations, sell_allocations, positions, broker_trades,
    holdings, broker_accounts, then the user) when the test finishes.

    positions <-> broker_trades is a circular FK (Position.entry_trade_id ->
    broker_trades.id, BrokerTrade.position_id -> positions.id), so
    broker_trades.position_id is nulled out before positions are deleted.
    """
    raw_key = new_api_key()
    with SessionLocal() as session:
        user = User(
            name="Test User",
            email=f"test-{raw_key[-12:]}@example.invalid",
            api_key_hash=hash_api_key(raw_key),
        )
        session.add(user)
        session.commit()
        user_id = user.id

    yield {"id": user_id, "key": raw_key}

    with SessionLocal() as session:
        position_ids = select(Position.id).where(Position.user_id == user_id)
        session.execute(
            delete(PositionEvaluation).where(
                PositionEvaluation.position_id.in_(position_ids)
            )
        )
        session.execute(
            delete(SellAllocation).where(SellAllocation.position_id.in_(position_ids))
        )
        session.execute(
            update(BrokerTrade)
            .where(BrokerTrade.user_id == user_id)
            .values(position_id=None)
        )
        session.execute(delete(Position).where(Position.user_id == user_id))
        session.execute(delete(BrokerTrade).where(BrokerTrade.user_id == user_id))
        session.execute(
            delete(BrokerHoldingSnapshot).where(
                BrokerHoldingSnapshot.user_id == user_id
            )
        )
        session.execute(delete(BrokerAccount).where(BrokerAccount.user_id == user_id))
        session.execute(delete(User).where(User.id == user_id))
        session.commit()


@pytest.fixture
def auth(test_user):
    return {"X-API-Key": test_user["key"]}
