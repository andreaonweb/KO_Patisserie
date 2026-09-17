from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+psycopg://ko:ko@localhost:5434/ko_patisserie"
    jwt_secret: str = "dev-secret-change-in-production"


settings = Settings()
