from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.auth import router as auth_router
from app.api.chat import router as chat_router
from app.api.orders import router as orders_router
from app.api.products import router as products_router
from app.api.uploads import UPLOAD_DIR, UPLOAD_URL_PREFIX, router as uploads_router
from app.api.ws import router as ws_router
from app.core.origins import ALLOWED_ORIGINS

app = FastAPI(title="Ko Pâtisserie API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(products_router)
app.include_router(orders_router)
app.include_router(uploads_router)
app.include_router(ws_router)
app.include_router(chat_router)

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount(UPLOAD_URL_PREFIX, StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
