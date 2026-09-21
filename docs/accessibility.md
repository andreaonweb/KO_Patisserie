# Accesibilidad (WCAG 2.2, nivel AA)

Auditoría del frontend y decisiones tomadas. Objetivo: cumplir el nivel AA, con especial atención al tamaño de letra.

## Tamaños de letra (1.4.4 Cambio de tamaño del texto)

- **Todo el texto está en `rem`** (base 16 px), no en `px`. Así respeta el tamaño de letra que el usuario configura en su navegador, además del zoom.
- **Suelo de 12 px** (`0.75rem`) para cualquier texto. Antes había 35 usos entre 8,5 y 11,5 px (etiquetas, insignias, pie de página).
- El texto corrido pequeño (descripciones, notas) sube de 13–13,5 px a **14 px** (`0.875rem`).
- Los títulos con `clamp()` también están en `rem`.
- Regla para código nuevo: `font-size` siempre en `rem`; no bajar de `0.75rem`.

## Contraste

| Requisito | Antes | Ahora |
|---|---|---|
| Texto normal, 4,5:1 (1.4.3) | El rosa `#a35d76` sobre rosa pálido daba 4,10:1 (estados hover) | `$rose` = `#9a5470` → 4,64:1 sobre rosa pálido y 5,22:1 sobre crema |
| Bordes de campos de formulario, 3:1 (1.4.11) | `#f0dde5` sobre crema: 1,25:1 | `$border-input` = `#857878` → ≥ 3,6:1 sobre crema, blanco y rosa pálido |
| Placeholder | gris por defecto del navegador (~4,4:1) | `$text-muted` (5,75:1) |

El resto de pares de la paleta (texto principal, atenuado, verde, insignias de estado, botones, pie de página) ya cumplía 4,5:1.
Los tokens están en `ko_front/src/styles/variables.scss`.

## Reflujo (1.4.10)

Sin scroll horizontal a 320 px de ancho en todas las páginas y paneles. Se corrigió:
- las rejillas con `minmax(NNNpx, 1fr)` fijo → `minmax(min(100%, NNNpx), 1fr)`;
- la barra de navegación: por debajo de 900 px las pestañas se sustituyen por un botón de hamburguesa, a la izquierda del logo, que abre un menú lateral (diálogo modal con foco atrapado, `Escape` para cerrar y foco devuelto al botón); en pantallas ≤ 480 px el botón del carrito muestra un icono y su nombre accesible sigue siendo "Abrir carrito, N artículos";
- el panel de admin: pestañas, filas de producto y paginación pasan a varias líneas (antes un botón quedaba recortado e inalcanzable);
- el panel del chat ya cabe en pantallas estrechas.

## Teclado y foco

- **Carrito lateral y chat de ayuda:** el foco entra al abrirlos, se atrapa el tabulador en el carrito (es modal), `Escape` los cierra y el foco vuelve al botón que los abrió (2.4.3).
- **Botón del chat:** su nombre accesible es su texto visible, "¿Necesitas ayuda?" (2.5.3 Etiqueta en el nombre).
- **Pestañas del admin:** eran `role="tab"` sin el patrón de teclado que exige ese rol; ahora son un grupo de botones con `aria-pressed`.
- El contorno de foco global (`:focus-visible`, verde, 5,9:1) ya existía.

## Otros

- **Títulos de página únicos** por ruta (2.4.2), p. ej. "Carta · KŌ Pâtisserie".
- **Cambios de estado anunciados** (4.1.3): un aviso `role="status"` comunica "N artículos en el carrito" al añadir productos.
- **Movimiento reducido:** con `prefers-reduced-motion` se desactivan animaciones, transiciones y el desplazamiento suave (también en el botón "Cómo llegar").
- Conversación del chat: el hilo activo lleva `aria-current`.

## Cómo volver a comprobarlo

1. **Tamaños:** en la consola del navegador, recorrer los nodos de texto visibles y comprobar que `getComputedStyle(el).fontSize` ≥ `12px`.
2. **Reflujo:** cargar cada ruta en un `iframe` de 320 px de ancho y comprobar `document.documentElement.scrollWidth <= clientWidth`, y que ningún botón, enlace o campo quede fuera de un contenedor con `overflow: hidden`.
3. **Contraste:** calcular la razón de luminancia de los pares texto/fondo nuevos (4,5:1 texto normal, 3:1 componentes) antes de añadir un color a `variables.scss`.
4. **Tests:** `navbar.spec.ts`, `chat-widget.spec.ts` y `app.routes.spec.ts` cubren el foco, el nombre accesible y los títulos.

## Pendiente / no verificado

- No se ha pasado un lector de pantalla real (NVDA / VoiceOver): las comprobaciones de foco y nombres se hicieron por DOM.
- El checkout y la confirmación no se midieron a 320 px (el checkout redirige con el carrito vacío).
- Las 3 zonas con presupuesto de estilos en aviso (`home.scss`, `admin.scss`, `navbar.scss`) siguen por debajo del límite de error de 8 kB.
