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


settings = Settings()
