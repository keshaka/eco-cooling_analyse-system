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

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False)

    @property
    def cors_origin_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
