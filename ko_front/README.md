# 🌸 Shirayuki Pâtisserie · 白雪パティスリー

Aplicación web de pastelería japonesa artesanal, construida con **Angular 18+** usando la API moderna de señales (Signals).

---

## 📸 Preview
<img width="558" height="713" alt="image" src="https://github.com/user-attachments/assets/5cc14dcb-d230-4d1a-91d1-8a66152cfd29" />
<br>
<img width="1917" height="840" alt="image" src="https://github.com/user-attachments/assets/9e5c756e-903c-4a16-80bd-a38397543307" />
<br>
<img width="1914" height="900" alt="image" src="https://github.com/user-attachments/assets/4bcdd2dc-08d8-4699-8470-364d0ed07c6b" />
<br>
<img width="1919" height="885" alt="image" src="https://github.com/user-attachments/assets/eaeff42c-bea3-4d27-a114-1b46710be175" />
<br>
<img width="1919" height="907" alt="image" src="https://github.com/user-attachments/assets/e9322c1e-e3e0-4cf4-b4af-6ecdad1bec73" />
<br>
<img width="1915" height="903" alt="image" src="https://github.com/user-attachments/assets/e0271531-c0d2-4b2a-a696-757dd690469a" />
<br>



## ✨ Características

- Catálogo de productos con tarjetas interactivas
- Carrito de compra reactivo con panel lateral deslizante
- Gestión de cantidades por producto (añadir, disminuir, eliminar)
- Autenticación de usuario (login / logout)
- Panel de administración (`/admin`) con CRUD de productos (crear, editar, borrar) usando **Reactive Forms**, persistido en **Firestore**
- Navegación entre páginas con Angular Router
- Arquitectura basada en **Signals** y **computed values**
- Paradas de bus cercanas en tiempo real via **API i-Bus de TMB**

---

## 🛠️ Tecnologías

| Tecnología | Versión |
|---|---|
| Angular | 18+ |
| TypeScript | 5+ |
| Angular Signals | API nativa |
| Angular Router | Standalone |
| Angular Reactive Forms | API nativa |
| Firebase / Firestore | @angular/fire |
| HttpClient | Angular nativo |
| SCSS | — |
| API i-Bus TMB | v1 |

---

## 📁 Estructura del proyecto

```
src/
├── app/
│   ├── core/
│   │   ├── models/
│   │   │   ├── product.model.ts       # Interfaz Product y CartItem
│   │   │   └── bus-stop.model.ts      # Interfaz BusStop y BusArrival
│   │   └── services/
│   │       ├── auth.service.ts        # Autenticación
│   │       ├── cart.service.ts        # Carrito reactivo con Signals
│   │       ├── product.service.ts     # CRUD de productos en Firestore
│   │       └── bus.service.ts         # Paradas cercanas + tiempo real TMB
│   ├── pages/
│   │   ├── home/                      # Página de inicio + sección buses
│   │   ├── menu/                      # Catálogo de productos
│   │   ├── admin/                     # CRUD de productos con Reactive Forms
│   │   └── about/                     # Página nosotras
│   └── shared/
│       └── components/
│           ├── navbar/                # Navbar + panel lateral del carrito
│           └── product-card/          # Tarjeta de producto
└── public/
    └── images/
        └── dulces-japoneses.jpg       # Imagen hero
```

---


## 🚀 Instalación y uso

```bash
# Clonar el repositorio
git clone https://github.com/andreaonweb/project_m1.git
cd project_m1

# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
ng serve
```

Abre el navegador en `http://localhost:4200`

---
## 🔑 Variables de entorno

Copia el archivo de ejemplo y rellena tus credenciales:

```bash
cp src/environments/environment.example.ts src/environments/environment.ts
```

Necesitarás credenciales de:
- [Firebase Console](https://console.firebase.google.com)
- [TMB Developer Portal](https://developer.tmb.cat)

---

## 🛒 CartService

El carrito gestiona el estado con Signals. Cada producto almacena su cantidad, evitando duplicados:

```typescript
add(product)       // añade 1 unidad, o incrementa si ya existe
remove(id)         // descuenta 1 unidad, elimina si llega a 0
removeAll(id)      // elimina el producto completamente
getItems()         // devuelve ReadonlySignal<CartItem[]>
```

---

## 🛠️ ProductService · CRUD de productos

Panel de administración en `/admin` (protegido, requiere sesión iniciada) para gestionar el catálogo con un formulario reactivo:

```typescript
create(product)     // crea un producto nuevo en Firestore
update(id, changes)  // actualiza un producto existente
remove(id)           // borra un producto
seedIfEmpty(list)    // carga productos de ejemplo si la colección está vacía
```

Los productos se guardan en Firestore y `products` se expone como un `Signal<Product[]>`, compartido entre `/admin` y `/menu` — cualquier alta, edición o borrado se refleja al instante en el catálogo público.

---

## 🚌 BusService · API TMB

Muestra las paradas de bus más cercanas a la pastelería con tiempos de llegada en tiempo real usando la API i-Bus de TMB.

```typescript
loadNearbyStops()  // carga paradas cercanas y lanza llamadas de tiempo real
```

Requiere credenciales de [developer.tmb.cat](https://developer.tmb.cat):

```typescript
const APP_ID  = 'tu_app_id';
const APP_KEY = 'tu_app_key';
```

---

## 🌸 Páginas

| Ruta | Descripción |
|---|---|
| `/home` | Bienvenida, características y paradas de bus cercanas |
| `/menu` | Catálogo de productos con carrito integrado |
| `/admin` | CRUD de productos (crear, editar, borrar) con Reactive Forms |
| `/about` | Información sobre el equipo |
| `/auth` | Inicio de sesión |

---

## 📝 Licencia

Proyecto de aprendizaje · hecho con 🍡 y mucho matcha.
