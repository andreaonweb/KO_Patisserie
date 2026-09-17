from sqlalchemy import text

from app.models import Order, OrderItem, OrderStatus, Product, ProductCategory, User, UserRole


def test_create_user(db_session) -> None:
    user = User(email="ana@test.com", hashed_password="hashed", role=UserRole.CUSTOMER)
    db_session.add(user)
    db_session.commit()
    assert user.id is not None
    assert user.role == UserRole.CUSTOMER


def test_create_product(db_session) -> None:
    product = Product(
        name="Mochi de Fresa",
        price=3.5,
        description="Tierno mochi relleno de anko y fresas frescas.",
        emoji="🍓",
        category=ProductCategory.MOCHI,
    )
    db_session.add(product)
    db_session.commit()
    assert product.id is not None
    assert product.is_new is False


def test_create_order_with_items(db_session) -> None:
    user = User(email="ana@test.com", hashed_password="hashed")
    db_session.add(user)
    db_session.commit()

    order = Order(
        user_id=user.id,
        pickup_name="Ana",
        pickup_phone="600111222",
        pickup_time="Hoy 18:00",
        total=7.0,
        items=[OrderItem(product_id=1, name="Mochi de Fresa", price=3.5, quantity=2)],
    )
    db_session.add(order)
    db_session.commit()

    assert order.id is not None
    assert order.status == OrderStatus.PENDIENTE
    assert len(order.items) == 1
    assert order.items[0].order_id == order.id


def test_enum_values_persisted_lowercase(db_session) -> None:
    user = User(email="test@test.com", hashed_password="hashed", role=UserRole.CUSTOMER)
    db_session.add(user)
    db_session.commit()

    product = Product(
        name="Test Product",
        price=5.0,
        description="Test",
        emoji="🍰",
        category=ProductCategory.CAKE,
    )
    db_session.add(product)
    db_session.commit()

    order = Order(
        user_id=user.id,
        pickup_name="Test",
        pickup_phone="123456",
        pickup_time="Today",
        status=OrderStatus.LISTO,
        total=5.0,
    )
    db_session.add(order)
    db_session.commit()

    user_role_raw = db_session.execute(text("SELECT role FROM \"user\" WHERE id = :id"), {"id": user.id}).scalar()
    assert user_role_raw == "customer"

    product_category_raw = db_session.execute(text("SELECT category FROM product WHERE id = :id"), {"id": product.id}).scalar()
    assert product_category_raw == "cake"

    order_status_raw = db_session.execute(text("SELECT status FROM \"order\" WHERE id = :id"), {"id": order.id}).scalar()
    assert order_status_raw == "listo"
