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
