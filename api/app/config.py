from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    secret_key: str
    media_root: str = "/data/media"
    allowed_origins: str = "http://localhost:3000"
    max_upload_mb: int = 20
    sync_batch_size: int = 100
    mcp_enabled: bool = False
    admin_email: str = "admin@questbee.local"
    admin_password: str = "changeme"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]


settings = Settings()
