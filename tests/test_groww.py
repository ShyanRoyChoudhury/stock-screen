"""Unit tests for app.brokers.groww. No network calls: GrowwAPI is always a
fake test double (app.brokers.groww.GrowwAPI is monkeypatched), never the
real growwapi.GrowwAPI, so no HTTP request is ever issued.
"""

from datetime import date, time

import pytest

from app.brokers.base import BrokerAuthError, HoldingRecord, TradeRecord
from app.brokers.crypto import decrypt_json, encrypt_json
from app.brokers.groww import GrowwClient, _first_list, _parse_ts
from app.brokers.registry import client_for
from app.market_calendar import IST
from app.models import BrokerAccount

DAY = date(2026, 9, 22)
OTHER_DAY = date(2026, 9, 21)
VALID_TOTP_SECRET = "JBSWY3DPEHPK3PXP"


def _account(**creds) -> BrokerAccount:
    return BrokerAccount(
        user_id=1,
        broker="groww",
        label="primary",
        credentials_enc=encrypt_json(
            {"api_key": creds.get("api_key", "AKEY123"), "totp_secret": creds.get("totp_secret", VALID_TOTP_SECRET)}
        ),
    )


def make_fake_groww_api(
    *,
    order_pages: dict[int, list[dict]] | None = None,
    trade_pages: dict[str, dict[int, list[dict]]] | None = None,
    holdings_payload: dict | None = None,
    access_token_result: object = "tok-123",
):
    """Build a fresh fake GrowwAPI class (fresh per call, so call-tracking
    state never leaks between tests)."""
    order_pages = order_pages or {}
    trade_pages = trade_pages or {}
    holdings_payload = holdings_payload or {"holdings": []}

    class _FakeGrowwAPI:
        SEGMENT_CASH = "CASH"
        PRODUCT_CNC = "CNC"
        PRODUCT_MTF = "MTF"
        EXCHANGE_NSE = "NSE"

        def __init__(self, token):
            self.token = token
            self.order_calls: list[int] = []
            self.trade_calls: list[tuple[str, int]] = []

        @staticmethod
        def get_access_token(api_key, totp=None, secret=None):
            if isinstance(access_token_result, Exception):
                raise access_token_result
            return access_token_result

        def get_order_list(self, page=0, page_size=25, segment=None, timeout=None):
            self.order_calls.append(page)
            return {"order_list": order_pages.get(page, [])}

        def get_trade_list_for_order(
            self, groww_order_id, segment, page=0, page_size=25, timeout=None
        ):
            self.trade_calls.append((groww_order_id, page))
            pages = trade_pages[groww_order_id]  # KeyError => an unexpected order was queried
            return {"trade_list": pages.get(page, [])}

        def get_holdings_for_user(self, timeout=None):
            return holdings_payload

    return _FakeGrowwAPI


# ---------------------------------------------------------------------------
# registry resolution
# ---------------------------------------------------------------------------


def test_registry_resolves_groww(master_key, monkeypatch):
    monkeypatch.setattr(
        "app.brokers.groww.GrowwAPI", make_fake_groww_api(access_token_result="tok-x")
    )
    account = _account()
    client = client_for(account)
    assert isinstance(client, GrowwClient)
    assert client.broker == "groww"
    assert client.account is account


# ---------------------------------------------------------------------------
# authenticate()
# ---------------------------------------------------------------------------


def test_authenticate_stores_encrypted_token_and_mint_time(master_key, monkeypatch):
    monkeypatch.setattr(
        "app.brokers.groww.GrowwAPI", make_fake_groww_api(access_token_result="tok-secret")
    )
    account = _account()
    client = client_for(account)

    client.authenticate()

    assert account.access_token_enc is not None
    assert decrypt_json(account.access_token_enc) == {"token": "tok-secret"}
    assert account.token_minted_at is not None
    assert account.token_minted_at.tzinfo is not None
    assert client._api is not None


def test_authenticate_raises_broker_auth_error_on_api_exception(master_key, monkeypatch):
    from growwapi.groww.exceptions import GrowwAPIException

    monkeypatch.setattr(
        "app.brokers.groww.GrowwAPI",
        make_fake_groww_api(
            access_token_result=GrowwAPIException("bad totp", "400")
        ),
    )
    account = _account()
    client = client_for(account)

    with pytest.raises(BrokerAuthError, match="auth"):
        client.authenticate()
    # a failed authenticate() must never leave a token behind
    assert account.access_token_enc is None
    assert account.token_minted_at is None


def test_authenticate_raises_broker_auth_error_on_value_error(master_key, monkeypatch):
    monkeypatch.setattr(
        "app.brokers.groww.GrowwAPI",
        make_fake_groww_api(access_token_result=ValueError("boom")),
    )
    account = _account()
    client = client_for(account)

    with pytest.raises(BrokerAuthError, match="auth"):
        client.authenticate()


def test_authenticate_raises_broker_auth_error_on_bad_totp_secret(master_key, monkeypatch):
    """An invalid base32 TOTP secret fails locally in pyotp, before any API
    call is made — the fake's get_access_token asserts it's never reached."""

    def _unreachable(*args, **kwargs):
        raise AssertionError("get_access_token must not be called")

    fake_cls = make_fake_groww_api()
    fake_cls.get_access_token = staticmethod(_unreachable)
    monkeypatch.setattr("app.brokers.groww.GrowwAPI", fake_cls)

    account = _account(totp_secret="not-valid-base32!!")
    client = client_for(account)

    with pytest.raises(BrokerAuthError, match="auth"):
        client.authenticate()


# ---------------------------------------------------------------------------
# fetch_trades()
# ---------------------------------------------------------------------------

_ORDERS_PAGE_0 = [
    {
        "groww_order_id": "O1",
        "trading_symbol": "TCS",
        "order_status": "COMPLETE",
        "quantity": 10,
        "filled_quantity": 10,
        "average_fill_price": 3500.0,
        "exchange": "NSE",
        "segment": "CASH",
        "product": "CNC",
        "order_type": "MARKET",
        "transaction_type": "BUY",
    },
    {
        "groww_order_id": "O2",
        "trading_symbol": "TCS",
        "order_status": "COMPLETE",
        "quantity": 5,
        "filled_quantity": 5,
        "average_fill_price": 3600.0,
        "exchange": "NSE",
        "segment": "CASH",
        "product": "CNC",
        "order_type": "MARKET",
        "transaction_type": "SELL",
    },
    {
        # MIS (intraday) order, fully filled — must be skipped, delivery only
        "groww_order_id": "O3",
        "trading_symbol": "TCS",
        "order_status": "COMPLETE",
        "quantity": 2,
        "filled_quantity": 2,
        "exchange": "NSE",
        "segment": "CASH",
        "product": "MIS",
        "transaction_type": "BUY",
    },
    {
        # CNC but unfilled — must be skipped
        "groww_order_id": "O4",
        "trading_symbol": "INFY",
        "order_status": "OPEN",
        "quantity": 3,
        "filled_quantity": 0,
        "exchange": "NSE",
        "segment": "CASH",
        "product": "CNC",
        "transaction_type": "BUY",
    },
]

_TRADE_PAGES = {
    "O1": {
        0: [
            {
                "groww_trade_id": "T1",
                "groww_order_id": "O1",
                "exchange_trade_id": "E1",
                "trading_symbol": "TCS",
                "isin": "INE467B01029",
                "exchange": "NSE",
                "segment": "CASH",
                "product": "CNC",
                "transaction_type": "BUY",
                "price": 3500.0,
                "quantity": 10,
                "trade_status": "EXECUTED",
                "trade_date_time": "2026-09-22T10:15:00+05:30",
            },
            {
                # same order, different day => must be filtered out
                "groww_trade_id": "T1-other-day",
                "groww_order_id": "O1",
                "exchange_trade_id": "E1b",
                "trading_symbol": "TCS",
                "isin": "INE467B01029",
                "exchange": "NSE",
                "segment": "CASH",
                "product": "CNC",
                "transaction_type": "BUY",
                "price": 3480.0,
                "quantity": 2,
                "trade_status": "EXECUTED",
                "trade_date_time": "2026-09-21T15:20:00+05:30",
            },
        ],
        1: [],
    },
    "O2": {
        0: [
            {
                "groww_trade_id": "T2",
                "groww_order_id": "O2",
                "exchange_trade_id": "E2",
                "trading_symbol": "TCS",
                "isin": "INE467B01029",
                "exchange": "NSE",
                "segment": "CASH",
                "product": "CNC",
                "transaction_type": "SELL",
                "price": 3600.0,
                "quantity": 5,
                "trade_status": "EXECUTED",
                "trade_date_time": "2026-09-22T11:00:00+05:30",
            },
            {
                # rejected leg on the same day => must be filtered out
                "groww_trade_id": "T2-rejected",
                "groww_order_id": "O2",
                "exchange_trade_id": "E2b",
                "trading_symbol": "TCS",
                "isin": "INE467B01029",
                "exchange": "NSE",
                "segment": "CASH",
                "product": "CNC",
                "transaction_type": "SELL",
                "price": 3599.0,
                "quantity": 1,
                "trade_status": "REJECTED",
                "trade_date_time": "2026-09-22T11:05:00+05:30",
            },
        ],
        1: [],
    },
}


def _client_with_trades(master_key, monkeypatch):
    fake_cls = make_fake_groww_api(
        order_pages={0: _ORDERS_PAGE_0, 1: []},
        trade_pages=_TRADE_PAGES,
    )
    monkeypatch.setattr("app.brokers.groww.GrowwAPI", fake_cls)
    account = _account()
    client = client_for(account)
    client.authenticate()
    return client


def test_fetch_trades_maps_kept_orders_and_filters_day_and_status(master_key, monkeypatch):
    client = _client_with_trades(master_key, monkeypatch)

    records = client.fetch_trades(DAY)

    assert len(records) == 2
    by_side = {r.side: r for r in records}
    assert set(by_side) == {"BUY", "SELL"}

    buy = by_side["BUY"]
    assert isinstance(buy, TradeRecord)
    assert buy.broker_trade_id == "T1"
    assert buy.broker_order_id == "O1"
    assert buy.exchange_trade_id == "E1"
    assert buy.exchange == "NSE"
    assert buy.segment == "CASH"
    assert buy.product == "CNC"
    assert buy.tradingsymbol == "TCS"
    assert buy.isin == "INE467B01029"
    assert buy.quantity == 10
    assert buy.price == 3500.0
    assert buy.trade_ts.tzinfo is IST
    assert buy.trade_ts.astimezone(IST).date() == DAY

    sell = by_side["SELL"]
    assert sell.broker_trade_id == "T2"
    assert sell.broker_order_id == "O2"
    assert sell.quantity == 5
    assert sell.price == 3600.0
    assert sell.trade_ts.astimezone(IST).date() == DAY

    # MIS and unfilled orders were never queried for trades at all
    queried_order_ids = {oid for oid, _ in client._api.trade_calls}
    assert queried_order_ids == {"O1", "O2"}


def test_fetch_trades_stops_paging_on_empty_page(master_key, monkeypatch):
    client = _client_with_trades(master_key, monkeypatch)

    client.fetch_trades(DAY)

    # order list: page 0 (3 eligible-ish + non-eligible orders), page 1 empty => stop
    assert client._api.order_calls == [0, 1]
    # trades per order: page 0 has data, page 1 empty => stop, per order
    assert client._api.trade_calls == [("O1", 0), ("O1", 1), ("O2", 0), ("O2", 1)]


def test_fetch_trades_returns_empty_for_a_day_with_no_matching_trades(master_key, monkeypatch):
    client = _client_with_trades(master_key, monkeypatch)

    assert client.fetch_trades(date(2026, 9, 20)) == []


def test_fetch_trades_day_filter_also_picks_up_the_other_day(master_key, monkeypatch):
    """Sanity check on the day guard itself: the trade fixture dated
    OTHER_DAY is excluded from DAY's results (asserted above) precisely
    because it belongs to OTHER_DAY, not because it's dropped outright."""
    client = _client_with_trades(master_key, monkeypatch)

    records = client.fetch_trades(OTHER_DAY)

    assert len(records) == 1
    assert records[0].broker_trade_id == "T1-other-day"


# ---------------------------------------------------------------------------
# fetch_holdings()
# ---------------------------------------------------------------------------


def test_fetch_holdings_maps_rows(master_key, monkeypatch):
    holdings_payload = {
        "holdings": [
            {
                "isin": "INE467B01029",
                "trading_symbol": "TCS",
                "quantity": 10,
                "average_price": 3500.0,
                "t1_quantity": 2,
                "last_price": 3550.0,
            },
            {
                "isin": "INE002A01018",
                "trading_symbol": "RELIANCE",
                "quantity": 4,
                "average_price": 2500.0,
                # no t1_quantity, no last_price
            },
        ]
    }
    fake_cls = make_fake_groww_api(holdings_payload=holdings_payload)
    monkeypatch.setattr("app.brokers.groww.GrowwAPI", fake_cls)
    account = _account()
    client = client_for(account)
    client.authenticate()

    records = client.fetch_holdings()

    assert len(records) == 2
    tcs, reliance = records
    assert isinstance(tcs, HoldingRecord)
    assert tcs.isin == "INE467B01029"
    assert tcs.tradingsymbol == "TCS"
    assert tcs.quantity == 10
    assert tcs.t1_quantity == 2
    assert tcs.average_price == 3500.0
    assert tcs.last_price == 3550.0

    assert reliance.isin == "INE002A01018"
    assert reliance.quantity == 4
    assert reliance.t1_quantity is None
    assert reliance.last_price is None


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------


def test_first_list_prefers_the_named_key():
    payload = {"order_list": [1, 2], "other": "x"}
    assert _first_list(payload, "order_list") == [1, 2]


def test_first_list_falls_back_to_first_list_valued_entry():
    payload = {"status": "ok", "results": [{"a": 1}]}
    assert _first_list(payload, "order_list") == [{"a": 1}]


def test_first_list_returns_empty_when_no_list_present():
    assert _first_list({"status": "ok"}, "order_list") == []


def test_parse_ts_naive_string_assumed_ist():
    ts = _parse_ts("2026-09-22T10:15:00", DAY)
    assert ts.tzinfo is IST
    assert ts.hour == 10 and ts.minute == 15


def test_parse_ts_epoch_millis_converted_from_utc():
    # 2026-09-22T04:45:00Z == 2026-09-22T10:15:00+05:30
    epoch_ms = 1790052300000
    ts = _parse_ts(epoch_ms, DAY)
    assert ts.tzinfo is IST
    assert ts.hour == 10
    assert ts.minute == 15


def test_parse_ts_missing_falls_back_to_pre_close():
    from datetime import datetime

    ts = _parse_ts(None, DAY)
    assert ts == datetime.combine(DAY, time(15, 29), tzinfo=IST)
