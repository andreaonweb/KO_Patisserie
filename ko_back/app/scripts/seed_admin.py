from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.user import User, UserRole

ADMIN_EMAIL = "admin@email.com"
ADMIN_PASSWORD = "admin123"

CUSTOMER_EMAIL = "cliente@email.com"
CUSTOMER_PASSWORD = "cliente123"


def seed_admin(db: Session) -> None:
    existing = db.query(User).filter(User.email == ADMIN_EMAIL).first()
    if existing is not None:
        return
    admin = User(email=ADMIN_EMAIL, hashed_password=hash_password(ADMIN_PASSWORD), role=UserRole.ADMIN)
    db.add(admin)
    db.commit()


def seed_customer(db: Session) -> None:
    existing = db.query(User).filter(User.email == CUSTOMER_EMAIL).first()
    if existing is not None:
        return
    customer = User(email=CUSTOMER_EMAIL, hashed_password=hash_password(CUSTOMER_PASSWORD), role=UserRole.CUSTOMER)
    db.add(customer)
    db.commit()


def main() -> None:
    db = SessionLocal()
    try:
        seed_admin(db)
        seed_customer(db)
    finally:
        db.close()


if __name__ == "__main__":
    main()
