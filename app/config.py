from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = (
        "postgresql+psycopg://stockscreen:stockscreen@localhost:5433/stockscreen"
    )
    # Yahoo caps hourly history at 730 days. Sent as an explicit start date,
    # not period="730d": Yahoo resolves the period form to the listing date
    # for recently listed symbols and then rejects the request outright.
    # 728 keeps a safety margin from the boundary.
    hourly_backfill_days: int = 728
    daily_backfill_period: str = "5y"
    fetch_delay_seconds: float = 0.5
    # Incremental runs re-fetch this many days before the last stored candle;
    # the upsert dedupes and picks up any revisions Yahoo published.
    incremental_overlap_days: int = 2
    # Fernet key encrypting broker_accounts.credentials_enc / access_token_enc.
    # Unset until a deployment generates one; app.brokers.crypto raises on use.
    broker_master_key: SecretStr | None = None
    # Timeout for outbound Groww API calls, in seconds.
    groww_request_timeout: int = 30
    # How many trading sessions after a fill to search for a matching signal.
    match_window_sessions: int = 5
    # Max % gap between a signal's entry and the fill price to still match.
    match_max_price_gap_pct: float = 5.0
    # ATR multiple for the chandelier trailing stop on matched positions.
    chandelier_atr_multiple: float = 2.5
    # Sessions an unmatched swing position runs before it's flagged for review.
    swing_review_after_sessions: int = 30
    # Sessions ahead of an upcoming corporate action to start warning on it.
    upcoming_action_warn_sessions: int = 5


settings = Settings()
