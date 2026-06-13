from functools import lru_cache
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    db_host: str = Field(default="localhost", alias="DB_HOST")
    db_port: int = Field(default=1433, alias="DB_PORT")
    db_name: str = Field(default="iot_monitoring", alias="DB_NAME")
    db_user: str = Field(default="sa", alias="DB_USER")
    db_password: str = Field(default="", alias="DB_PASSWORD")
    db_driver: str = Field(default="ODBC Driver 18 for SQL Server", alias="DB_DRIVER")
    db_trust_server_certificate: bool = Field(default=True, alias="DB_TRUST_SERVER_CERTIFICATE")

    cors_origins: str = Field(
        default="http://127.0.0.1:5500,http://localhost:5500,http://127.0.0.1:8000",
        alias="CORS_ORIGINS",
    )

    api_title: str = Field(default="Comparative Environmental Monitoring API", alias="API_TITLE")
    api_version: str = Field(default="1.0.0", alias="API_VERSION")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    # Telegram bot settings
    telegram_bot_token: str = Field(default="", alias="TELEGRAM_BOT_TOKEN")
    telegram_alert_chat_ids: str = Field(default="", alias="TELEGRAM_ALERT_CHAT_IDS")
    telegram_data_timeout_minutes: int = Field(default=5, alias="TELEGRAM_DATA_TIMEOUT_MINUTES")

    # Database backup directory (host path for Python file operations)
    db_backup_dir: str = Field(default=r"C:\SQLBackups", alias="DB_BACKUP_DIR")
    # SQL Server-side backup path (container path when using Docker)
    db_backup_dir_sql: str = Field(default="", alias="DB_BACKUP_DIR_SQL")
    # Daily auto-backup time in HH:MM format (24h, server local time)
    db_backup_time: str = Field(default="02:00", alias="DB_BACKUP_TIME")

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False)

    @property
    def cors_origin_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
