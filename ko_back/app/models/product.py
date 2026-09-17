import enum
from datetime import datetime

from sqlalchemy import Boolean, Enum, Float, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base


class ProductCategory(str, enum.Enum):
    MOCHI = "mochi"
    DONUT = "donut"
    CAKE = "cake"
    DRINK = "drink"


class Product(Base):
    __tablename__ = "product"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String)
    price: Mapped[float] = mapped_column(Float)
    description: Mapped[str] = mapped_column(String)
    emoji: Mapped[str] = mapped_column(String)
    category: Mapped[ProductCategory] = mapped_column(Enum(ProductCategory))
    is_new: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
