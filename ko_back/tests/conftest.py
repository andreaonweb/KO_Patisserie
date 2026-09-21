from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.core.database import Base, get_db, get_session_factory
from app.core.realtime import manager
from app.main import app
from app.scripts.seed_admin import ADMIN_EMAIL, ADMIN_PASSWORD, seed_admin


@pytest.fixture
def db_engine() -> Generator[Engine, None, None]:
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def db_session(db_engine: Engine) -> Generator[Session, None, None]:
    session = sessionmaker(bind=db_engine)()
    yield session
    session.close()


@pytest.fixture
def client(db_session: Session, db_engine: Engine) -> Generator[TestClient, None, None]:
    session_factory = sessionmaker(bind=db_engine, autoflush=False)

    def override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_session_factory] = lambda: session_factory
    manager.reset()
    yield TestClient(app)
    app.dependency_overrides.clear()
    manager.reset()


@pytest.fixture
def admin_token(client: TestClient, db_session: Session) -> str:
    seed_admin(db_session)
    response = client.post("/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    return response.json()["access_token"]


@pytest.fixture
def customer_token(client: TestClient) -> str:
    response = client.post("/auth/register", json={"email": "cliente@test.com", "password": "secret123"})
    return response.json()["access_token"]
