from datetime import datetime

from pydantic import BaseModel, Field

from app.models.order import OrderStatus


class OrderItemCreate(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)


class OrderCreate(BaseModel):
    items: list[OrderItemCreate] = Field(min_length=1)
    pickup_name: str
    pickup_phone: str
    pickup_time: str


class OrderItemResponse(BaseModel):
    product_id: int
    name: str
    price: float
    quantity: int


class OrderResponse(BaseModel):
    id: int
    user_id: int
    items: list[OrderItemResponse]
    total: float
    pickup_name: str
    pickup_phone: str
    pickup_time: str
    status: OrderStatus
    created_at: datetime


class OrderStatusUpdate(BaseModel):
    status: OrderStatus
