# WebSocket Realtime + Help Chat — Design

## Context

The app has no realtime channel. Two needs share the same gap:

1. Customers cannot ask the shop a question, and the admin has no way to answer.
2. Order status changes (admin → customer) and new orders (customer → admin) only
   show up after a poll: both "Mis pedidos" and the admin orders tab call
   `pollWhileVisible` (`core/utils/poll.ts`, 10 s). That was an interim fix.

We add one WebSocket per logged-in user, carrying typed JSON events. The help chat
is its first feature and live order updates are its second, replacing the polling.

Stack facts this design relies on: FastAPI + sync SQLAlchemy + PostgreSQL (Alembic),
JWT auth (`decode_access_token`, role in the token and in `User.role`), Angular
standalone components with signals, token in `localStorage` (`token-storage.ts`).

## Goals

- A logged-in **customer** can open a help chat from a floating "¿Necesitas ayuda?"
  button (bottom-right, every page) and talk to the shop.
- The **admin** panel has a "Chat" tab listing customer conversations, with last
  message and unread counts, and can reply in real time.
- One conversation per customer, history persisted in the database.
- Order status changes and new orders reach the right screens instantly; the 10 s
  polling is removed.
- One connection per user (multiplexed events), authenticated, with automatic
  reconnection.

## Non-goals

- Attachments/images, "typing…" indicators, ticket open/close states, assigning a
  conversation to a specific admin, message editing/deletion.
- Multiple server processes. The connection registry is in memory; scaling out needs
  Redis pub/sub (see "Scaling note").
- Push/browser notifications when the tab is closed.
- End-to-end browser tests.

## Architecture

```
Browser (Angular)                         FastAPI
┌──────────────────┐   WS /ws           ┌────────────────────────┐
│ RealtimeService  │◄──────────────────►│ ws endpoint            │
│  (1 socket)      │  typed JSON events │  handshake → dispatch  │
├──────────────────┤                    ├────────────────────────┤
│ ChatService      │   REST (history)   │ ConnectionManager      │
│ OrdersComponent  │◄──────────────────►│  user_id → sockets     │
│ Admin (chat/ord) │                    ├────────────────────────┤
└──────────────────┘                    │ REST routers publish   │
                                        │ order events via the   │
                                        │ manager                │
                                        └────────────────────────┘
```

History and lists are fetched over REST; the socket only pushes live changes and
carries outgoing chat messages. Every feature is an event `type`, so adding events
later does not change the transport.

## Data model

New table `chat_message` (migration `0003`):

| column | type | notes |
|---|---|---|
| `id` | int PK | |
| `customer_id` | FK `user.id`, indexed | which thread the message belongs to |
| `sender_id` | FK `user.id` | the customer or the admin who wrote it |
| `body` | text | 1–1000 chars, stored as plain text |
| `created_at` | datetime, server default now | |
| `read_at` | datetime, nullable | set when the *other side* has read it |

There is no thread table: a customer's thread is `customer_id`. Index on
`(customer_id, id)`.

Read semantics: a customer's message is unread until **any** admin marks the thread
read; an admin's message is unread until the customer marks it read.

## WebSocket protocol — `/ws`

All frames are JSON objects with a `type`.

**Handshake.** The client opens the socket with no credentials and must send
`{"type":"auth","token":"<jwt>"}` as its first frame within 5 s. The server decodes the
token, loads the user from the database (role comes from the DB, not the token) and
replies `{"type":"ready","user":{"id":…,"role":…}}`. Failure closes the socket:

| close code | meaning |
|---|---|
| 4401 | missing/invalid token, unknown user, or handshake timeout |
| 4403 | `Origin` header not allowed |

The `Origin` header is checked before accepting, against the same allow-list as CORS
(`http://localhost:4200`), which becomes a shared constant. Nothing else is
processed before `ready`.

**Client → server**

| type | payload | rules |
|---|---|---|
| `chat.send` | `{body, customer_id?}` | customers always write to their own thread (any `customer_id` is ignored); admins must pass `customer_id` of an existing customer |
| `chat.read` | `{customer_id?}` | marks the other side's messages in the thread as read; same `customer_id` rules |

**Server → client**

| type | payload | recipients |
|---|---|---|
| `ready` | `{user}` | the connection |
| `chat.message` | `{message}` | the thread's customer and **all** connected admins |
| `chat.read` | `{customer_id, reader_role}` | the thread's customer and all admins |
| `order.created` | `{order}` | all admins |
| `order.updated` | `{order}` | the order's owner and all admins |
| `error` | `{code, detail}` | the sender; the socket stays open |

`message` uses the shape `{id, customer_id, sender_id, sender_role, body, created_at,
read_at}`; `order` uses the existing `OrderResponse` shape.

**Validation and limits.** `body` is trimmed and must be 1–1000 characters. Each
connection is limited to 20 client frames per 10 s (`error` code `rate_limited`
beyond that). Malformed frames and unknown types yield `error` codes `bad_request` /
`unknown_type`, never a disconnect. Recipients only ever receive events they are
allowed to see.

## REST endpoints

| method | path | who | returns |
|---|---|---|---|
| GET | `/chat/messages?limit=50&before_id=` | customer | own thread, oldest→newest |
| GET | `/chat/threads` | admin | `[{customer_id, customer_email, last_message, unread_count}]`, most recent first; `unread_count` counts unread customer messages |
| GET | `/chat/threads/{customer_id}/messages?limit=50&before_id=` | admin | that thread |

Order creation (`POST /orders`) and status change (`PATCH /orders/{id}/status`) keep
their behavior and additionally publish `order.created` / `order.updated`.

## Backend components

- `app/core/realtime.py` — `ConnectionManager`: `user_id → set[WebSocket]`,
  `connect/disconnect`, `send_to_user`, `send_to_admins`. Admin membership is tracked
  from the role loaded at handshake.
- `app/api/ws.py` — the `/ws` endpoint: origin check, handshake, receive loop,
  dispatch to handlers, per-connection rate limit. Each handled frame uses its own
  short-lived `SessionLocal()`.
- `app/models/chat.py` + `app/schemas/chat.py` — model and Pydantic schemas.
- `app/api/chat.py` — the REST endpoints above.
- Publishing from REST: the order endpoints are sync (`def`, run in the threadpool),
  so they publish through the manager with `anyio.from_thread.run(...)`. Failure to
  publish must never fail the HTTP request (log and continue).

## Frontend components

- **`core/services/realtime.service.ts`** — the only code that touches `WebSocket`.
  Connects when a user is logged in, sends `auth`, exposes an `events` observable
  (typed union) and a `status` signal (`connecting | open | closed`). Reconnects with
  exponential backoff 1 s → 30 s. It does **not** retry after close code 4401; it
  clears the token and sends the user to `/auth`. Closes on logout. Emits a
  `reconnected` signal so consumers refetch what they may have missed.
- **`core/services/chat.service.ts`** — signals for the customer thread, the admin
  thread list, the active admin thread, and unread totals. Loads history over REST,
  applies `chat.message`/`chat.read` events, de-duplicates by message `id`, and
  exposes `send(body, customerId?)` and `markRead(customerId?)`. `send` refuses when
  the socket is not open (no offline queue).
- **`shared/components/chat-widget`** — floating button (lucide message icon +
  "¿Necesitas ayuda?") shown only for logged-in **customers**. Opens a ~360×480 panel:
  message list (auto-scroll), textarea + send, "Reconectando…" notice with send
  disabled when the socket is down, unread badge while closed. `aria-live` on the
  list, Escape closes. Mounted once in `App`.
- **Admin "Chat" tab** in `AdminComponent`: thread list (email, last message, unread
  badge) and the active conversation with a reply box; threads reorder by latest
  activity; unread total badge on the tab. Split into small standalone components so
  `admin.ts` does not grow further.
- **Live orders.** `OrdersComponent` and the admin orders tab load once over REST,
  then apply `order.created` / `order.updated`, and reload on `reconnected`.
  `core/utils/poll.ts` and its usages are removed. The admin's local status override
  (`statusOverrides`) is no longer needed once events carry the new status and is
  removed with it.
- Message text is always rendered as text (Angular interpolation), never as HTML.

## Errors

- Bad/oversized/unknown frames → `error` event, connection stays open.
- Sending while disconnected → send button disabled and a visible notice; nothing is
  silently dropped.
- Duplicates (reconnects, several tabs) are ignored by message `id`.
- Publishing an order event fails → logged; the HTTP response is unaffected.
- Token expiry (4401) → clear token, redirect to `/auth`, no reconnect loop.

## Testing

**Backend** (pytest + FastAPI `TestClient` websocket support, in-memory SQLite like
the existing tests):
- handshake: valid token, invalid token, missing/late auth (timeout), unknown user,
  disallowed origin;
- permissions: customer cannot write to or read another customer's thread; admin
  needs a valid `customer_id`; role taken from the DB;
- delivery: customer message reaches that customer and every admin but no other
  customer; admin reply reaches the thread's customer; several tabs of one user;
- read receipts and unread counts; REST history and pagination; thread list ordering;
- `body` validation and the rate limit;
- `POST /orders` emits `order.created` to admins; status `PATCH` emits `order.updated`
  to owner + admins, and not to unrelated customers.

**Frontend** (Vitest, as today): `RealtimeService` with a fake `WebSocket`
(handshake, backoff reconnect, no retry on 4401, `reconnected`, logout closes);
`ChatService` (de-dup, unread, send-while-closed); the widget (visible only for
customers, badge, disabled while offline); admin chat list ordering and unread;
orders components applying events and reloading on reconnect.

## Delivery — one branch per feature

Each branch is cut from `dev` after the previous one is merged.

1. `feat/ws-core` — `/ws` endpoint, `ConnectionManager`, handshake/origin/rate limit,
   shared CORS origin constant (backend); `RealtimeService` (frontend).
2. `feat/chat-backend` — `chat_message` model, migration `0003`, REST endpoints,
   `chat.send` / `chat.read` handling and events.
3. `feat/chat-widget` — `ChatService` (customer side) and the floating widget.
4. `feat/chat-admin` — admin "Chat" tab (thread list, conversation, unread).
5. `feat/ws-orders` — publish order events, live orders in both screens, remove
   polling and `statusOverrides`.

## Scaling note

`ConnectionManager` lives in process memory, so this only works with a single
uvicorn process. With several workers, an event published in one process would not
reach sockets held by another. The manager's interface (`send_to_user`,
`send_to_admins`) is deliberately small so a Redis pub/sub backend can replace it
later without touching the handlers.
