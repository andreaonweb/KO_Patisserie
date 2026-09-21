import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { RealtimeService } from './realtime.service';
import { ChatService, mergeMessages, messageFromApi } from './chat.service';
import type { AppUser } from '../models/user.model';
import type { ChatMessageApi, ChatThreadApi } from '../models/chat.model';
import type { ServerEvent } from '../models/realtime.model';

class FakeRealtime {
  status = signal<'open' | 'connecting' | 'closed'>('open');
  events = new Subject<ServerEvent>();
  reconnected = new Subject<void>();
  events$ = this.events.asObservable();
  reconnected$ = this.reconnected.asObservable();
  send = vi.fn().mockReturnValue(true);
}

const api = (over: Partial<ChatMessageApi> = {}): ChatMessageApi => ({
  id: 1,
  customer_id: 5,
  sender_id: 5,
  sender_role: 'customer',
  body: 'hola',
  created_at: '2026-09-21T10:00:00',
  read_at: null,
  ...over,
});

const messagesUrl = `${environment.apiUrl}/chat/messages`;

function setup(role: AppUser['role'] | null = 'customer') {
  const user = signal<AppUser | undefined>(role ? { id: 5, email: 'c@x.com', role } : undefined);
  const realtime = new FakeRealtime();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { currentUser: user } },
      { provide: RealtimeService, useValue: realtime },
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  const service = TestBed.inject(ChatService);
  TestBed.tick();
  return { service, http, realtime, user };
}

async function loaded(rows: ChatMessageApi[]) {
  const ctx = setup();
  ctx.http.expectOne(r => r.url === messagesUrl).flush(rows);
  await vi.waitFor(() => expect(ctx.service.customerMessages()).toHaveLength(rows.length));
  return ctx;
}

describe('ChatService (customer)', () => {
  it('loads the customer thread on login', async () => {
    const { service } = await loaded([api({ id: 1 }), api({ id: 2, sender_id: 1, sender_role: 'admin', body: 'hola!' })]);
    expect(service.customerMessages().map(m => m.body)).toEqual(['hola', 'hola!']);
    expect(service.customerMessages()[1].senderRole).toBe('admin');
  });

  it('does not load anything without a user', () => {
    const { http } = setup(null);
    http.expectNone(r => r.url === messagesUrl);
  });

  it('appends live messages for its own thread and ignores duplicates', async () => {
    const { service, realtime } = await loaded([api({ id: 1 })]);
    const event: ServerEvent = { type: 'chat.message', message: api({ id: 2, sender_role: 'admin', sender_id: 1 }) };
    realtime.events.next(event);
    realtime.events.next(event);
    expect(service.customerMessages().map(m => m.id)).toEqual([1, 2]);
  });

  it('ignores messages of another thread', async () => {
    const { service, realtime } = await loaded([api({ id: 1 })]);
    realtime.events.next({ type: 'chat.message', message: api({ id: 9, customer_id: 77 }) });
    expect(service.customerMessages()).toHaveLength(1);
  });

  it('counts unread admin messages until the customer reads them', async () => {
    const { service, realtime } = await loaded([api({ id: 1 }), api({ id: 2, sender_id: 1, sender_role: 'admin' })]);
    expect(service.customerUnread()).toBe(1);
    realtime.events.next({ type: 'chat.read', customer_id: 5, reader_role: 'customer' });
    expect(service.customerUnread()).toBe(0);
  });

  it('markRead() only sends when there is something unread', async () => {
    const { service, realtime } = await loaded([api({ id: 1 })]);
    service.markRead();
    expect(realtime.send).not.toHaveBeenCalled();

    realtime.events.next({ type: 'chat.message', message: api({ id: 2, sender_id: 1, sender_role: 'admin' }) });
    service.markRead();
    expect(realtime.send).toHaveBeenCalledWith({ type: 'chat.read' });
  });

  it('send() forwards to the socket and reports failure when it is not open', async () => {
    const { service, realtime } = await loaded([]);
    expect(service.send('hola')).toBe(true);
    expect(realtime.send).toHaveBeenCalledWith({ type: 'chat.send', body: 'hola' });

    realtime.send.mockReturnValue(false);
    expect(service.send('otra')).toBe(false);
  });

  it('canSend follows the connection status', async () => {
    const { service, realtime } = await loaded([]);
    expect(service.canSend()).toBe(true);
    realtime.status.set('closed');
    expect(service.canSend()).toBe(false);
  });

  it('reloads the thread after a reconnection', async () => {
    const { service, http, realtime } = await loaded([api({ id: 1 })]);
    realtime.reconnected.next();
    http.expectOne(r => r.url === messagesUrl).flush([api({ id: 1 }), api({ id: 2 })]);
    await vi.waitFor(() => expect(service.customerMessages()).toHaveLength(2));
  });

  it('keeps what it had and reports an error when loading fails', async () => {
    const { service, http, realtime } = await loaded([api({ id: 1 })]);
    realtime.reconnected.next();
    http.expectOne(r => r.url === messagesUrl).flush('boom', { status: 500, statusText: 'Server Error' });
    await vi.waitFor(() => expect(service.loadError()).not.toBe(''));
    expect(service.customerMessages()).toHaveLength(1);
  });

  it('clears the thread on logout', async () => {
    const { service, user } = await loaded([api({ id: 1 })]);
    user.set(undefined);
    TestBed.tick();
    expect(service.customerMessages()).toEqual([]);
  });

  it('discards a load response that arrives after logout', async () => {
    const { service, http, user } = setup();
    const req = http.expectOne(r => r.url === messagesUrl);
    user.set(undefined);
    TestBed.tick();
    req.flush([api({ id: 1 })]);
    await new Promise(resolve => setTimeout(resolve));
    expect(service.customerMessages()).toEqual([]);
  });

  it('keeps a live message that arrives while a reload is in flight', async () => {
    const { service, http, realtime } = await loaded([api({ id: 1 })]);
    realtime.reconnected.next();
    const req = http.expectOne(r => r.url === messagesUrl);
    realtime.events.next({ type: 'chat.message', message: api({ id: 2, sender_role: 'admin', sender_id: 1 }) });
    req.flush([api({ id: 1 })]);
    await vi.waitFor(() => expect(service.customerMessages().map(m => m.id)).toEqual([1, 2]));
  });
});

describe('mergeMessages', () => {
  it('unions by id, sorts ascending and prefers the server copy', () => {
    const current = [messageFromApi(api({ id: 3, body: 'live' })), messageFromApi(api({ id: 1, body: 'old' }))];
    const loaded = [messageFromApi(api({ id: 2 })), messageFromApi(api({ id: 1, body: 'server' }))];
    const merged = mergeMessages(current, loaded);
    expect(merged.map(m => m.id)).toEqual([1, 2, 3]);
    expect(merged[0].body).toBe('server');
  });
});

const threadsUrl = `${environment.apiUrl}/chat/threads`;
const threadUrl = (id: number) => `${environment.apiUrl}/chat/threads/${id}/messages`;

const apiThread = (customerId: number, unread: number, over: Partial<ChatMessageApi> = {}): ChatThreadApi => ({
  customer_id: customerId,
  customer_email: `c${customerId}@x.com`,
  unread_count: unread,
  last_message: api({ id: customerId * 10, customer_id: customerId, sender_id: customerId, ...over }),
});

async function adminLoaded(threads: ChatThreadApi[]) {
  const ctx = setup('admin');
  ctx.http.expectOne(threadsUrl).flush(threads);
  await vi.waitFor(() => expect(ctx.service.threads()).toHaveLength(threads.length));
  return ctx;
}

describe('ChatService (admin)', () => {
  it('loads the thread list on login and sums unread', async () => {
    const { service } = await adminLoaded([apiThread(7, 2), apiThread(8, 1)]);
    expect(service.threads().map(t => t.customerEmail)).toEqual(['c7@x.com', 'c8@x.com']);
    expect(service.adminUnreadTotal()).toBe(3);
  });

  it('does not load the customer thread for an admin', () => {
    const { http } = setup('admin');
    http.expectNone(r => r.url === messagesUrl);
    http.expectOne(threadsUrl);
  });

  it('opens a thread, loads its history and marks it read', async () => {
    const { service, http, realtime } = await adminLoaded([apiThread(7, 2)]);
    const opening = service.openThread(7);
    http.expectOne(r => r.url === threadUrl(7)).flush([api({ id: 1, customer_id: 7, sender_id: 7 })]);
    await opening;

    expect(service.activeCustomerId()).toBe(7);
    expect(service.activeMessages()).toHaveLength(1);
    expect(realtime.send).toHaveBeenCalledWith({ type: 'chat.read', customer_id: 7 });
  });

  it('does not send a read receipt for a thread with nothing unread', async () => {
    const { service, http, realtime } = await adminLoaded([apiThread(7, 0)]);
    const opening = service.openThread(7);
    http.expectOne(r => r.url === threadUrl(7)).flush([]);
    await opening;
    expect(realtime.send).not.toHaveBeenCalled();
  });

  it('a message in a closed thread moves it to the top and increments unread', async () => {
    const { service, realtime } = await adminLoaded([apiThread(7, 0), apiThread(8, 0)]);
    realtime.events.next({
      type: 'chat.message',
      message: api({ id: 500, customer_id: 8, sender_id: 8, body: 'nuevo' }),
    });

    expect(service.threads().map(t => t.customerId)).toEqual([8, 7]);
    expect(service.threads()[0].unreadCount).toBe(1);
    expect(service.threads()[0].lastMessage.body).toBe('nuevo');
    expect(service.adminUnreadTotal()).toBe(1);
  });

  it('ignores a message it already has (no double counting)', async () => {
    const { service, realtime } = await adminLoaded([apiThread(7, 0)]);
    const event: ServerEvent = { type: 'chat.message', message: api({ id: 500, customer_id: 7, sender_id: 7 }) };
    realtime.events.next(event);
    realtime.events.next(event);
    expect(service.threads()[0].unreadCount).toBe(1);
  });

  it('a message in the open thread is appended and read straight away', async () => {
    const { service, http, realtime } = await adminLoaded([apiThread(7, 0)]);
    const opening = service.openThread(7);
    http.expectOne(r => r.url === threadUrl(7)).flush([]);
    await opening;

    realtime.events.next({ type: 'chat.message', message: api({ id: 501, customer_id: 7, sender_id: 7 }) });

    expect(service.activeMessages()).toHaveLength(1);
    expect(service.threads()[0].unreadCount).toBe(0);
    expect(realtime.send).toHaveBeenCalledWith({ type: 'chat.read', customer_id: 7 });
  });

  it('a message from an unknown customer reloads the thread list', async () => {
    const { service, http, realtime } = await adminLoaded([apiThread(7, 0)]);
    realtime.events.next({ type: 'chat.message', message: api({ id: 600, customer_id: 9, sender_id: 9 }) });
    http.expectOne(threadsUrl).flush([apiThread(9, 1), apiThread(7, 0)]);
    await vi.waitFor(() => expect(service.threads()).toHaveLength(2));
  });

  it('an admin read clears the unread count and marks the open thread', async () => {
    const { service, http, realtime } = await adminLoaded([apiThread(7, 2)]);
    const opening = service.openThread(7);
    http.expectOne(r => r.url === threadUrl(7)).flush([api({ id: 1, customer_id: 7, sender_id: 7 })]);
    await opening;

    realtime.events.next({ type: 'chat.read', customer_id: 7, reader_role: 'admin' });

    expect(service.threads()[0].unreadCount).toBe(0);
    expect(service.activeMessages()[0].readAt).not.toBeNull();
  });

  it('sendTo() forwards the customer id', async () => {
    const { service, realtime } = await adminLoaded([apiThread(7, 0)]);
    expect(service.sendTo(7, 'hola')).toBe(true);
    expect(realtime.send).toHaveBeenCalledWith({ type: 'chat.send', body: 'hola', customer_id: 7 });
  });

  it('closeThread() forgets the open conversation', async () => {
    const { service, http } = await adminLoaded([apiThread(7, 0)]);
    const opening = service.openThread(7);
    http.expectOne(r => r.url === threadUrl(7)).flush([]);
    await opening;

    service.closeThread();
    expect(service.activeCustomerId()).toBeNull();
    expect(service.activeMessages()).toEqual([]);
  });

  it('reloads the list and the open thread after a reconnection', async () => {
    const { service, http, realtime } = await adminLoaded([apiThread(7, 0)]);
    const opening = service.openThread(7);
    http.expectOne(r => r.url === threadUrl(7)).flush([]);
    await opening;

    realtime.reconnected.next();
    http.expectOne(threadsUrl).flush([apiThread(7, 3)]);
    await vi.waitFor(() => expect(service.threads()[0].unreadCount).toBe(3));
    http.expectOne(r => r.url === threadUrl(7)).flush([api({ id: 1, customer_id: 7, sender_id: 7 })]);
    await vi.waitFor(() => expect(service.activeMessages()).toHaveLength(1));
  });

  it('clears everything on logout', async () => {
    const { service, user } = await adminLoaded([apiThread(7, 1)]);
    user.set(undefined);
    TestBed.tick();
    expect(service.threads()).toEqual([]);
    expect(service.adminUnreadTotal()).toBe(0);
  });

  it('discards a thread list response that arrives after logout', async () => {
    const { service, http, user } = setup('admin');
    const req = http.expectOne(threadsUrl);
    user.set(undefined);
    TestBed.tick();
    req.flush([apiThread(7, 1)]);
    await new Promise(resolve => setTimeout(resolve));
    expect(service.threads()).toEqual([]);
  });

  it('keeps a live message that arrives while a thread list reload is in flight', async () => {
    const { service, http, realtime } = await adminLoaded([apiThread(7, 0), apiThread(8, 0)]);
    realtime.reconnected.next();
    const req = http.expectOne(threadsUrl);
    realtime.events.next({ type: 'chat.message', message: api({ id: 500, customer_id: 8, sender_id: 8, body: 'vivo' }) });
    req.flush([apiThread(7, 0), apiThread(8, 0)]);
    await new Promise(resolve => setTimeout(resolve));

    expect(service.threads().map(t => t.customerId)).toEqual([8, 7]);
    expect(service.threads()[0].lastMessage.body).toBe('vivo');
    expect(service.threads()[0].unreadCount).toBe(1);
  });

  it('prefers the server thread when it is newer than the live one', async () => {
    const { service, http, realtime } = await adminLoaded([apiThread(7, 0)]);
    realtime.reconnected.next();
    const req = http.expectOne(threadsUrl);
    realtime.events.next({ type: 'chat.message', message: api({ id: 500, customer_id: 7, sender_id: 7 }) });
    req.flush([apiThread(7, 4, { id: 510 })]);
    await vi.waitFor(() => expect(service.threads()[0].lastMessage.id).toBe(510));
    expect(service.threads()[0].unreadCount).toBe(4);
  });

  it('discards a thread history response for a thread that is no longer open', async () => {
    const { service, http } = await adminLoaded([apiThread(7, 0)]);
    const opening = service.openThread(7);
    const req = http.expectOne(r => r.url === threadUrl(7));
    service.closeThread();
    req.flush([api({ id: 1, customer_id: 7, sender_id: 7 })]);
    await opening;
    expect(service.activeMessages()).toEqual([]);
  });

  it('merges a thread history response with live messages of the open thread', async () => {
    const { service, http, realtime } = await adminLoaded([apiThread(7, 0)]);
    const opening = service.openThread(7);
    const req = http.expectOne(r => r.url === threadUrl(7));
    realtime.events.next({ type: 'chat.message', message: api({ id: 501, customer_id: 7, sender_id: 7 }) });
    req.flush([api({ id: 1, customer_id: 7, sender_id: 7 })]);
    await opening;
    expect(service.activeMessages().map(m => m.id)).toEqual([1, 501]);
  });

  it('does not send a read receipt when the thread was closed before its history arrived', async () => {
    const { service, http, realtime } = await adminLoaded([apiThread(7, 2)]);
    const opening = service.openThread(7);
    const req = http.expectOne(r => r.url === threadUrl(7));
    service.closeThread();
    req.flush([api({ id: 1, customer_id: 7, sender_id: 7 })]);
    await opening;
    expect(realtime.send).not.toHaveBeenCalledWith({ type: 'chat.read', customer_id: 7 });
  });

  it('does not send a read receipt for a thread replaced by another one while loading', async () => {
    const { service, http, realtime } = await adminLoaded([apiThread(7, 2), apiThread(8, 0)]);
    const first = service.openThread(7);
    const req7 = http.expectOne(r => r.url === threadUrl(7));
    const second = service.openThread(8);
    http.expectOne(r => r.url === threadUrl(8)).flush([]);
    await second;
    req7.flush([api({ id: 1, customer_id: 7, sender_id: 7 })]);
    await first;
    expect(realtime.send).not.toHaveBeenCalledWith({ type: 'chat.read', customer_id: 7 });
  });

  it('openThread reports an error instead of rejecting when the history request fails', async () => {
    const { service, http, realtime } = await adminLoaded([apiThread(7, 2)]);
    const opening = service.openThread(7);
    http.expectOne(r => r.url === threadUrl(7)).flush('boom', { status: 500, statusText: 'Server Error' });
    await expect(opening).resolves.toBeUndefined();
    expect(service.loadError()).not.toBe('');
    expect(service.activeCustomerId()).toBe(7);
    expect(realtime.send).not.toHaveBeenCalled();
  });

  it('reports an error instead of an unhandled rejection when an unknown-customer reload fails', async () => {
    const { service, http, realtime } = await adminLoaded([apiThread(7, 0)]);
    realtime.events.next({ type: 'chat.message', message: api({ id: 600, customer_id: 9, sender_id: 9 }) });
    http.expectOne(threadsUrl).flush('boom', { status: 500, statusText: 'Server Error' });
    await vi.waitFor(() => expect(service.loadError()).not.toBe(''));
    expect(service.threads()).toHaveLength(1);
  });
});
