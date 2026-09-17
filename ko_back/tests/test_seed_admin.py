from app.models.user import User, UserRole
from app.scripts.seed_admin import ADMIN_EMAIL, seed_admin


def test_seed_admin_creates_admin_user(db_session) -> None:
    seed_admin(db_session)
    admins = db_session.query(User).filter(User.email == ADMIN_EMAIL).all()
    assert len(admins) == 1
    assert admins[0].role == UserRole.ADMIN


def test_seed_admin_is_idempotent(db_session) -> None:
    seed_admin(db_session)
    seed_admin(db_session)
    admins = db_session.query(User).filter(User.email == ADMIN_EMAIL).all()
    assert len(admins) == 1
