from datetime import datetime

from pydantic import BaseModel

from app.models.product import ProductCategory


class ProductWrite(BaseModel):
    name: str
    price: float
    description: str
    emoji: str
    image_url: str | None = None
    category: ProductCategory
    is_new: bool = False


class ProductResponse(BaseModel):
    id: int
    name: str
    price: float
    description: str
    emoji: str
    image_url: str | None = None
    category: ProductCategory
    is_new: bool
    created_at: datetime
