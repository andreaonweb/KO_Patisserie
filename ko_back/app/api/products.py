from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_admin
from app.models.product import Product
from app.models.user import User
from app.schemas.product import ProductResponse, ProductWrite

router = APIRouter(prefix="/products", tags=["products"])


def _to_response(product: Product) -> ProductResponse:
    return ProductResponse(
        id=product.id,
        name=product.name,
        price=product.price,
        description=product.description,
        emoji=product.emoji,
        category=product.category,
        is_new=product.is_new,
        created_at=product.created_at,
    )


@router.get("", response_model=list[ProductResponse])
def list_products(db: Session = Depends(get_db)) -> list[ProductResponse]:
    return [_to_response(p) for p in db.query(Product).all()]


@router.post("", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
def create_product(
    body: ProductWrite, db: Session = Depends(get_db), _admin: User = Depends(require_admin)
) -> ProductResponse:
    product = Product(**body.model_dump())
    db.add(product)
    db.commit()
    db.refresh(product)
    return _to_response(product)


@router.put("/{product_id}", response_model=ProductResponse)
def update_product(
    product_id: int,
    body: ProductWrite,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ProductResponse:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Producto no encontrado")
    for field, value in body.model_dump().items():
        setattr(product, field, value)
    db.commit()
    db.refresh(product)
    return _to_response(product)


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(
    product_id: int, db: Session = Depends(get_db), _admin: User = Depends(require_admin)
) -> None:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Producto no encontrado")
    db.delete(product)
    db.commit()
