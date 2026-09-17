from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.user import User, UserRole

ADMIN_EMAIL = "admin@email.com"
ADMIN_PASSWORD = "admin123"


def seed_admin(db: Session) -> None:
    existing = db.query(User).filter(User.email == ADMIN_EMAIL).first()
    if existing is not None:
        return
    admin = User(email=ADMIN_EMAIL, hashed_password=hash_password(ADMIN_PASSWORD), role=UserRole.ADMIN)
    db.add(admin)
    db.commit()


def main() -> None:
    db = SessionLocal()
    try:
        seed_admin(db)
    finally:
        db.close()


if __name__ == "__main__":
    main()
