import pytest

from app.models.chat import ChatMessage
from app.models.user import User, UserRole
from app.services import chat


def _user(db, email: str, role: UserRole = UserRole.CUSTOMER) -> User:
    user = User(email=email, hashed_password="x", role=role)
    db.add(user)
    db.commit()
    return user


@pytest.fixture
def people(db_session):
    return {
        "ana": _user(db_session, "ana@test.com"),
        "bea": _user(db_session, "bea@test.com"),
        "admin": _user(db_session, "admin@test.com", UserRole.ADMIN),
    }


def test_normalize_body_trims_and_validates() -> None:
    assert chat.normalize_body("  hola  ") == "hola"
    for bad in ["", "   ", None, 5, "x" * 1001]:
        with pytest.raises(ValueError):
            chat.normalize_body(bad)
    assert chat.normalize_body("x" * 1000) == "x" * 1000


def test_is_customer(db_session, people) -> None:
    assert chat.is_customer(db_session, people["ana"].id)
    assert not chat.is_customer(db_session, people["admin"].id)
    assert not chat.is_customer(db_session, 9999)


def test_add_message_persists_and_reports_sender_role(db_session, people) -> None:
    message = chat.add_message(db_session, people["ana"].id, people["admin"].id, "hola")
    response = chat.to_response(message)
    assert response.sender_role == "admin"
    assert response.customer_id == people["ana"].id
    assert response.read_at is None


def test_list_messages_is_oldest_first_and_paginates(db_session, people) -> None:
    ids = [chat.add_message(db_session, people["ana"].id, people["ana"].id, f"m{i}").id for i in range(5)]
    chat.add_message(db_session, people["bea"].id, people["bea"].id, "otra")

    latest = chat.list_messages(db_session, people["ana"].id, limit=3)
    assert [m.body for m in latest] == ["m2", "m3", "m4"]

    older = chat.list_messages(db_session, people["ana"].id, limit=3, before_id=latest[0].id)
    assert [m.body for m in older] == ["m0", "m1"]
    assert older[0].id == ids[0]


def test_admin_reading_marks_only_the_customers_messages(db_session, people) -> None:
    from_customer = chat.add_message(db_session, people["ana"].id, people["ana"].id, "duda")
    from_admin = chat.add_message(db_session, people["ana"].id, people["admin"].id, "respuesta")

    chat.mark_read(db_session, people["ana"].id, UserRole.ADMIN)
    db_session.expire_all()

    assert db_session.get(ChatMessage, from_customer.id).read_at is not None
    assert db_session.get(ChatMessage, from_admin.id).read_at is None


def test_customer_reading_marks_only_the_admins_messages(db_session, people) -> None:
    from_customer = chat.add_message(db_session, people["ana"].id, people["ana"].id, "duda")
    from_admin = chat.add_message(db_session, people["ana"].id, people["admin"].id, "respuesta")

    chat.mark_read(db_session, people["ana"].id, UserRole.CUSTOMER)
    db_session.expire_all()

    assert db_session.get(ChatMessage, from_admin.id).read_at is not None
    assert db_session.get(ChatMessage, from_customer.id).read_at is None


def test_list_threads_orders_by_latest_activity_and_counts_unread(db_session, people) -> None:
    chat.add_message(db_session, people["ana"].id, people["ana"].id, "a1")
    chat.add_message(db_session, people["ana"].id, people["ana"].id, "a2")
    chat.add_message(db_session, people["bea"].id, people["bea"].id, "b1")
    chat.add_message(db_session, people["ana"].id, people["admin"].id, "respuesta a ana")

    threads = chat.list_threads(db_session)

    assert [t.customer_email for t in threads] == ["ana@test.com", "bea@test.com"]
    assert threads[0].last_message.body == "respuesta a ana"
    assert threads[0].unread_count == 2  # solo cuentan los mensajes del cliente
    assert threads[1].unread_count == 1


def test_list_threads_is_empty_without_messages(db_session) -> None:
    assert chat.list_threads(db_session) == []
