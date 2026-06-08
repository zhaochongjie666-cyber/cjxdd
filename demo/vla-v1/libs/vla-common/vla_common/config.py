"""vla-common 配置 (pydantic-settings)."""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """VLA 平台配置 (12-factor: 全部从 env 读)."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # === 数据库 ===
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "vla"
    postgres_user: str = "vla"
    postgres_password: str = "vla_dev_password"

    # === 测试/开发用 SQLite (Scaffold 阶段无 Docker 时) ===
    database_url: str | None = None

    # === Kafka ===
    kafka_bootstrap_servers: str = "localhost:9092"

    # === Redis ===
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_password: str = ""

    # === MinIO ===
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "vla_minio"
    minio_secret_key: str = "vla_minio_dev"

    # === Auth ===
    api_key_header: str = "X-API-Key"
    jwt_secret: str = "dev_jwt_secret_change_in_prod"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60

    # === 通用 ===
    env: str = "dev"
    log_level: str = "INFO"
    service_name: str = "vla-svc"

    @property
    def database_url_resolved(self) -> str:
        """DATABASE_URL 优先 (测试覆盖), 否则拼 PG URL.

        同步模式 (Alembic 兼容), 异步驱动后续用 postgresql+asyncpg.
        """
        if self.database_url:
            return self.database_url
        return (
            f"postgresql+psycopg2://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
