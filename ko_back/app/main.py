from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.products import router as products_router

app = FastAPI(title="Ko Pâtisserie API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(products_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
