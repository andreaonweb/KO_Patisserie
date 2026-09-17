from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.order import Order, OrderItem
from app.models.product import Product
from app.models.user import User
from app.schemas.order import OrderCreate, OrderItemResponse, OrderResponse

router = APIRouter(prefix="/orders", tags=["orders"])


def _to_response(order: Order) -> OrderResponse:
    return OrderResponse(
        id=order.id,
        user_id=order.user_id,
        items=[
            OrderItemResponse(product_id=i.product_id, name=i.name, price=i.price, quantity=i.quantity)
            for i in order.items
        ],
        total=order.total,
        pickup_name=order.pickup_name,
        pickup_phone=order.pickup_phone,
        pickup_time=order.pickup_time,
        status=order.status,
        created_at=order.created_at,
    )


@router.post("", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
def create_order(
    body: OrderCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> OrderResponse:
    items: list[OrderItem] = []
    for line in body.items:
        product = db.get(Product, line.product_id)
        if product is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Producto {line.product_id} no encontrado",
            )
        items.append(
            OrderItem(product_id=product.id, name=product.name, price=product.price, quantity=line.quantity)
        )
    total = sum(item.price * item.quantity for item in items)
    order = Order(
        user_id=current_user.id,
        items=items,
        total=total,
        pickup_name=body.pickup_name,
        pickup_phone=body.pickup_phone,
        pickup_time=body.pickup_time,
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    return _to_response(order)
