import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.core.deps import require_admin
from app.models.user import User

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"
UPLOAD_URL_PREFIX = "/uploads"
MAX_IMAGE_BYTES = 5 * 1024 * 1024

router = APIRouter(prefix="/uploads", tags=["uploads"])


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

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{extension}"
    (UPLOAD_DIR / filename).write_bytes(data)
    return UploadResponse(url=f"{UPLOAD_URL_PREFIX}/{filename}")
