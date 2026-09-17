from app.core.config import Settings


def test_settings_default_database_url() -> None:
    assert Settings().database_url == "postgresql+psycopg://ko:ko@localhost:5434/ko_patisserie"


def test_settings_reads_database_url_from_env(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://x:y@otherhost:5432/other")
    assert Settings().database_url == "postgresql+psycopg://x:y@otherhost:5432/other"
