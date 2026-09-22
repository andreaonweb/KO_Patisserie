import logging

import cloudinary
import cloudinary.uploader
from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.deps import require_admin
from app.models.user import User

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 5 * 1024 * 1024
CLOUDINARY_FOLDER = "ko_patisserie/products"

router = APIRouter(prefix="/uploads", tags=["uploads"])

cloudinary.config(
    cloud_name=settings.cloudinary_cloud_name,
    api_key=settings.cloudinary_api_key,
    api_secret=settings.cloudinary_api_secret,
    secure=True,
)


class UploadResponse(BaseModel):
    url: str


def _detect_extension(head: bytes) -> str | None:
    """Detecta el formato por los primeros bytes, sin fiarse del nombre ni del content-type."""
    if head.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp"
    return None


@router.post("/products", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_product_image(file: UploadFile, _admin: User = Depends(require_admin)) -> UploadResponse:
    data = await file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="La imagen supera los 5 MB")
    extension = _detect_extension(data[:12])
    if extension is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Formato no válido: usa JPG, PNG o WebP")

    try:
        result = await run_in_threadpool(
            cloudinary.uploader.upload,
            data,
            folder=CLOUDINARY_FOLDER,
            resource_type="image",
        )
    except Exception as exc:  # pragma: no cover - error de red/credenciales del proveedor
        logger.exception("Fallo al subir imagen a Cloudinary")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="No se pudo subir la imagen al proveedor de almacenamiento"
        ) from exc

    return UploadResponse(url=result["secure_url"])
