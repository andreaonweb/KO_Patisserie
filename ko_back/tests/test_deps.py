import pytest
from fastapi import HTTPException

from app.core.deps import require_admin
from app.models.user import User, UserRole


def test_require_admin_allows_admin() -> None:
    admin = User(id=1, email="admin@test.com", role=UserRole.ADMIN)
    assert require_admin(current_user=admin) is admin


def test_require_admin_rejects_customer() -> None:
    customer = User(id=2, email="cliente@test.com", role=UserRole.CUSTOMER)
    with pytest.raises(HTTPException) as exc_info:
        require_admin(current_user=customer)
    assert exc_info.value.status_code == 403
