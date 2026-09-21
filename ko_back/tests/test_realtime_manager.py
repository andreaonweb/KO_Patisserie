import asyncio

from app.core.realtime import ConnectionManager


class FakeSocket:
    def __init__(self, fail: bool = False) -> None:
        self.sent: list[dict] = []
        self.fail = fail

    async def send_json(self, event: dict) -> None:
        if self.fail:
            raise RuntimeError("closed")
        self.sent.append(event)


def test_send_to_user_reaches_every_tab_of_that_user() -> None:
    manager = ConnectionManager()
    tab1, tab2 = FakeSocket(), FakeSocket()
    manager.connect(1, False, tab1)
    manager.connect(1, False, tab2)

    asyncio.run(manager.send_to_user(1, {"type": "x"}))

    assert tab1.sent == [{"type": "x"}]
    assert tab2.sent == [{"type": "x"}]


def test_send_to_user_ignores_other_users() -> None:
    manager = ConnectionManager()
    mine, other = FakeSocket(), FakeSocket()
    manager.connect(1, False, mine)
    manager.connect(2, False, other)

    asyncio.run(manager.send_to_user(1, {"type": "x"}))

    assert other.sent == []


def test_send_to_admins_reaches_only_admins() -> None:
    manager = ConnectionManager()
    admin, customer = FakeSocket(), FakeSocket()
    manager.connect(1, True, admin)
    manager.connect(2, False, customer)

    asyncio.run(manager.send_to_admins({"type": "x"}))

    assert admin.sent == [{"type": "x"}]
    assert customer.sent == []


def test_disconnecting_the_last_tab_removes_admin_membership() -> None:
    manager = ConnectionManager()
    admin = FakeSocket()
    manager.connect(1, True, admin)
    manager.disconnect(1, admin)

    asyncio.run(manager.send_to_admins({"type": "x"}))

    assert admin.sent == []


def test_a_dead_socket_is_dropped_without_breaking_the_others() -> None:
    manager = ConnectionManager()
    dead, alive = FakeSocket(fail=True), FakeSocket()
    manager.connect(1, False, dead)
    manager.connect(1, False, alive)

    asyncio.run(manager.send_to_user(1, {"type": "x"}))
    asyncio.run(manager.send_to_user(1, {"type": "y"}))

    assert alive.sent == [{"type": "x"}, {"type": "y"}]
    assert dead.sent == []
