"""Orígenes de navegador permitidos: los comparten CORS y el handshake del websocket.

Configurable vía la variable de entorno ALLOWED_ORIGINS (lista separada por comas),
para poder apuntar a los dominios reales del frontend en producción sin tocar código.
"""

from app.core.config import settings

ALLOWED_ORIGINS = [origin.strip() for origin in settings.allowed_origins.split(",") if origin.strip()]
