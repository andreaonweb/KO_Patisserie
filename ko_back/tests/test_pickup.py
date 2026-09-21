import pytest

from app.core.pickup import validate_pickup_time

ORDER = {"pickup_name": "Ana", "pickup_phone": "600111222"}


@pytest.mark.parametrize(
    "value",
    [
        "2026-09-22T08:30",  # martes, apertura
        "2026-09-22T19:30",  # martes, último tramo
        "2026-09-26T09:00",  # sábado, apertura
        "2026-09-27T20:30",  # domingo, último tramo
    ],
)
def test_accepts_slots_inside_opening_hours(value) -> None:
    assert validate_pickup_time(value) == value


@pytest.mark.parametrize(
    "value",
    [
        "Hoy 18:00",  # texto libre
        "2026-09-22 18:00",  # formato incorrecto
        "2026-09-28T12:00",  # lunes, cerrado
        "2026-09-22T08:00",  # martes antes de abrir
        "2026-09-22T20:00",  # martes, a la hora de cierre
        "2026-09-26T08:30",  # sábado antes de abrir
        "2026-09-27T21:00",  # domingo, a la hora de cierre
        "2026-09-22T18:10",  # no es un tramo de 30 min
    ],
)
def test_rejects_invalid_slots(value) -> None:
    with pytest.raises(ValueError):
        validate_pickup_time(value)


def test_api_rejects_free_text_pickup_time(client, customer_token, db_session) -> None:
    from app.models.product import Product, ProductCategory

    product = Product(name="Mochi", price=3.5, description="d", emoji="", category=ProductCategory.MOCHI)
    db_session.add(product)
    db_session.commit()
    response = client.post(
        "/orders",
        json={"items": [{"product_id": product.id, "quantity": 1}], **ORDER, "pickup_time": "cuando quiera"},
        headers={"Authorization": f"Bearer {customer_token}"},
    )
    assert response.status_code == 422
