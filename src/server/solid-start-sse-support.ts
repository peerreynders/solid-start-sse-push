// file: src/server/solid-start-sse-support
import { nanoid } from 'nanoid';

import type http from 'node:http';

// track closed requests

let lastPurge = performance.now();
const closedIds = new Map<string, number>();

function purgeClosedIds(now: number) {
	const cutOff = now - 120_000; // 2 minutes
	if (lastPurge > cutOff) return;

	for (const [id, time] of closedIds) if (time < cutOff) closedIds.delete(id);

	lastPurge = now;
}

function addClosedId(id: string) {
	const now = performance.now();
	purgeClosedIds(now);
	closedIds.set(id, now);
}

const REQUEST_CLOSE = {
	source: 'request',
	name: 'close',
} as const;

type Info = typeof REQUEST_CLOSE;
type Notify = (n: Info) => void;

const subscribers = new Map<string, Set<Notify>>();

function removeSubscriber(id: string, notify: Notify) {
	const all = subscribers.get(id);
	if (!all) return false;

	const result = all.delete(notify);
	if (all.size < 1) subscribers.delete(id);

	return result;
}

function addSubscriber(id: string, notify: Notify) {
	const remove = () => removeSubscriber(id, notify);
	const found = subscribers.get(id);
	if (found) {
		found.add(notify);
		return remove;
	}

	subscribers.set(id, new Set<Notify>().add(notify));
	return remove;
}

function notifySubscribers(id: string, info: Info) {
	const all = subscribers.get(id);
	if (!all) return;

	for (const notify of all) notify(info);

	if (info.name === 'close') {
		subscribers.delete(id);
		addClosedId(id);
	}
}

const SSE_CORRELATE = 'x-solid-start-sse-support';
const SSE_FALLBACK = 'x-solid-start-sse-long-poll';
const SSE_FALLBACK_SEARCH_PAIR = 'sseLongPoll=1';
const SSE_LAST_EVENT_ID = 'Last-Event-ID';
const channel = process.env.NODE_ENV?.startsWith('dev')
	? new BroadcastChannel('solid-start-sse-support')
	: undefined;

type EventInfo = {
	id: string;
	info: Info;
};

let receive: (event: MessageEvent<EventInfo>) => void | undefined;
let listening = false;

// Start listening as soon as possible
function listen() {
	if (channel && !receive) {
		receive = (event: MessageEvent<EventInfo>) =>
			notifySubscribers(event.data.id, event.data.info);

		channel.addEventListener('message', receive);
	}
	listening = true;
}

function subscribe(request: Request, notify: Notify) {
	if (!listening)
		throw Error(
			'Call `listen()` at application start up to avoid missing events'
		);

	const id =
		request.headers.get(SSE_CORRELATE) || request.headers.get(SSE_FALLBACK);
	if (!id) return;
	if (closedIds.has(id)) return;

	return addSubscriber(id, notify);
}

export type SourceController = {
	send: (data: string, id?: string) => void;
	close: () => void;
};

export type InitSource = (controller: SourceController) => () => void;

function eventStream(request: Request, init: InitSource) {
	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();
			const send = (data: string, id?: string) => {
				const payload = (id ? 'id:' + id + '\ndata:' : 'data:') + data + '\n\n';
				controller.enqueue(encoder.encode(payload));
			};

			let cleanup: (() => void) | undefined;
			let unsubscribe: (() => boolean) | undefined = undefined;

			const closeConnection = () => {
				if (!cleanup) return;
				cleanup();
				cleanup = undefined;
				unsubscribe?.();
				controller.close();
			};

			cleanup = init({ send, close: closeConnection });
			unsubscribe = subscribe(request, (info) => {
				if (info.source === 'request' && info.name === 'close') {
					closeConnection();
					return;
				}
			});

			if (!unsubscribe) {
				closeConnection();
				return;
			}
		},
	});

	return new Response(stream, {
		headers: { 'Content-Type': 'text/event-stream' },
	});
}

export type SampleController = {
	close: (data: string) => void;
	cancel: () => void;
};

export type InitSample = (controller: SampleController) => () => void;

function eventSample(request: Request, init: InitSample) {
	return new Promise<Response>((resolve) => {
		let cleanup: (() => void) | undefined;
		let unsubscribe: (() => boolean) | undefined = undefined;

		const closeConnection = (response?: Response) => {
			if (!cleanup) return;

			cleanup();
			cleanup = undefined;
			unsubscribe?.();

			resolve(
				response
					? response
					: new Response(null, {
							status: 499,
							statusText: 'Client Close Request',
					  })
			);
		};

		const close = (json: string) =>
			closeConnection(
				new Response(json, {
					headers: {
						'Content-Type': 'application/json',
					},
				})
			);

		cleanup = init({ close, cancel: () => closeConnection() });

		unsubscribe = subscribe(request, (info) => {
			if (info.source === 'request' && info.name === 'close') {
				closeConnection();
				return;
			}
		});

		if (!unsubscribe) {
			closeConnection();
			return;
		}
	});
}

// --- Middleware ---

function sendEvent(id: string, info: Info) {
	if (!channel) {
		notifySubscribers(id, info);
		return;
	}

	channel.postMessage({
		id,
		info,
	});
}

type NextFunction = (err?: unknown) => void;

function solidStartSseSupport(
	request: http.IncomingMessage,
	_response: http.ServerResponse,
	next: NextFunction
) {
	if (request.method !== 'GET') return next();

	const accept = request.headers.accept;
	const href = request.url;
	const name =
		accept && 0 <= accept.indexOf('text/event-stream')
			? SSE_CORRELATE
			: href && 0 <= href.indexOf(SSE_FALLBACK_SEARCH_PAIR)
			? SSE_FALLBACK
			: undefined;
	if (!name) return next();

	// tag request with a unique header
	// which will get copied
	const id = nanoid();
	request.headers[name] = id;

	// send event when request closes
	const close = () => {
		request.removeListener('close', close);
		sendEvent(id, REQUEST_CLOSE);
	};
	request.addListener('close', close);

	return next();
}

// Want to protect middleware from tree shaking
declare global {
	// eslint-disable-next-line no-var
	var __no_tree_shaking: Record<string, unknown> | undefined;
}

if (globalThis.__no_tree_shaking) {
	globalThis.__no_tree_shaking.solidStartSseSupport = solidStartSseSupport;
} else {
	globalThis.__no_tree_shaking = { solidStartSseSupport };
}

function requestInfo(request: Request) {
	const lastEventId =
		request.headers.get(SSE_LAST_EVENT_ID) ??
		new URL(request.url).searchParams.get('lastEventId') ??
		undefined;

	return {
		streamed: request.headers.has(SSE_CORRELATE)
			? true
			: request.headers.has(SSE_FALLBACK)
			? false
			: undefined,
		lastEventId,
	};
}

export {
	SSE_FALLBACK_SEARCH_PAIR,
	eventSample,
	eventStream,
	listen,
	requestInfo,
	solidStartSseSupport,
};
