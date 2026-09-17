from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.models.order import Order, OrderItem
from app.models.product import Product
from app.models.user import User, UserRole
from app.schemas.order import OrderCreate, OrderItemResponse, OrderResponse, OrderStatusUpdate

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


@router.get("", response_model=list[OrderResponse])
def list_orders(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> list[OrderResponse]:
    query = db.query(Order).order_by(Order.created_at.desc(), Order.id.desc())
    if current_user.role != UserRole.ADMIN:
        query = query.filter(Order.user_id == current_user.id)
    return [_to_response(o) for o in query.all()]


@router.get("/{order_id}", response_model=OrderResponse)
def get_order(
    order_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> OrderResponse:
    order = db.get(Order, order_id)
    if order is None or (order.user_id != current_user.id and current_user.role != UserRole.ADMIN):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido no encontrado")
    return _to_response(order)


@router.patch("/{order_id}/status", response_model=OrderResponse)
def update_order_status(
    order_id: int,
    body: OrderStatusUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> OrderResponse:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido no encontrado")
    order.status = body.status
    db.commit()
    db.refresh(order)
    return _to_response(order)
