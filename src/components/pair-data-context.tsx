// file: src/components/event-data-context.tsx
import {
	createContext,
	createEffect,
	useContext,
	createSignal,
	type ParentProps,
} from 'solid-js';
import { createStore, type Store } from 'solid-js/store';
import server$, {
	ServerError,
	type ServerFunctionEvent,
} from 'solid-start/server';

import {
	SYMBOLS,
	fromJson,
	fromPriceJson,
	isFxMessageArray,
	type FxMessage,
	type Pair,
	type Price,
	type PriceJson,
} from '~/lib/foreign-exchange';

import { makeRangeValue } from '~/lib/random';

// --- START server side ---

import { userFromFetchEvent } from '~/server/shame';
import { getUserPairs } from '~/server/session';

import {
	SSE_FALLBACK_SEARCH_PAIR,
	eventSample,
	eventStream,
	requestInfo,
	type InitSample,
	type InitSource,
} from '~/server/solid-start-sse-support';
// NOTE: call `listen()` in `entry-server.tsx`
import {
	sample as sampleEvents,
	subscribe as subscribeToSource,
} from '~/server/pair-data-source';

async function connectServerSource(this: ServerFunctionEvent) {
	const user = userFromFetchEvent(this);
	if (!user) throw new ServerError('Unauthorized', { status: 401 });

	const userPairs = await getUserPairs(this.request);
	if (!userPairs || userPairs.length < 1)
		throw new ServerError('Forbidden', { status: 403 });

	const info = requestInfo(this.request);
	const args = {
		lastEventId: info.lastEventId,
		pairs: userPairs,
	};

	// Use `info.streamed === undefined` to force error to switch to fallback
	if (info.streamed) {
		let unsubscribe: (() => void) | undefined = undefined;

		const init: InitSource = (controller) => {
			unsubscribe = subscribeToSource(controller, args);

			return () => {
				if (unsubscribe) {
					unsubscribe();
					unsubscribe = undefined;
				}
				console.log('source closed');
			};
		};

		return eventStream(this.request, init);
	}

	if (info.streamed === false) {
		let close: (() => void) | undefined = undefined;

		const init: InitSample = (controller) => {
			close = sampleEvents(controller, args);

			return () => {
				if (close) {
					close();
					close = undefined;
				}
				console.log('sample closed');
			};
		};

		return eventSample(this.request, init);
	}

	throw new ServerError('Unsupported Media Type', { status: 415 });
}

// --- END server side ---

// --- Context data store management
export type PairStore = Store<Pair>;

type WithLatestArguments = {
	latest: PriceJson[];
	maxLength: number;
};

// Constraints:
//
// 1. The `history` reference has to change (to `prices`)
//    to establish that the history has changed.
// 2. The references to the **existing** `Price` elements
//    in the `history` have to be stable so `For`
//    will correctly reuse the DOM rows of the
//    prices that have NOT changed but simply changed
//    position.
//
function withLatestPrices(this: WithLatestArguments, history: Price[]) {
	const { maxLength, latest } = this;
	const prices = [];

	// Transfer `latest` first to `prices`; most recent price first order.
	let i = 0;
	for (let j = 0; i < maxLength && j < latest.length; i += 1, j += 1)
		prices[i] = fromPriceJson(latest[j]);

	// Fill up `prices` with existing `history` prices up to `maxLength`
	for (let k = 0; i < maxLength && k < history.length; i += 1, k += 1)
		prices[i] = history[k];

	return prices;
}

function makeStoreEntry(symbol: string) {
	const label = SYMBOLS.get(symbol) ?? '';
	const [pairPrices, setPairPrices] = createStore<Pair>({
		symbol,
		prices: [],
	});

	const presetArgs: WithLatestArguments = {
		latest: [],
		maxLength: 10,
	};
	// Prettier will remove the parenthesis resulting in:
	//   "An instantiation expression cannot be followed by a property access."
	// prettier-ignore
	const fn = withLatestPrices.bind(presetArgs);
	const set = (latest: PriceJson[]) => {
		presetArgs.latest = latest;
		setPairPrices('prices', fn);
	};

	return {
		fxPair: {
			symbol,
			label,
			store: pairPrices,
		},
		set,
	};
}

const storeEntries = new Map<string, ReturnType<typeof makeStoreEntry>>();

function getStoreEntry(symbol: string) {
	let entry = storeEntries.get(symbol);
	if (entry) return entry;

	entry = makeStoreEntry(symbol);
	storeEntries.set(entry.fxPair.symbol, entry);
	return entry;
}

function fxPairRecord(symbol: string) {
	const entry = getStoreEntry(symbol);

	return entry.fxPair;
}

function pushPrices(symbol: string, latest: PriceJson[]) {
	const entry = getStoreEntry(symbol);

	entry.set(latest);
}

const PairDataContext = createContext(fxPairRecord);

// --- Context consumer reference count (connect/disconnect) ---
const [refCount, setRefCount] = createSignal(0);
const increment = (n: number) => n + 1;
const decrement = (n: number) => (n > 0 ? n - 1 : 0);

const disposePairData = () => setRefCount(decrement);

const KEEP_ALIVE_MS = 20000;
const MAX_PRECONNECT_MS = 5000;
const MIN_WAIT_MS = 5000;
const preconnectMs = makeRangeValue(0, MAX_PRECONNECT_MS);
let startTimeout: ReturnType<typeof setTimeout> | undefined;

// --- Keep alive timer ---
let keepAliveTimeout: ReturnType<typeof setTimeout> | undefined;
let start: () => void | undefined;

function clearKeepAlive() {
	if (!keepAliveTimeout) return;

	clearTimeout(keepAliveTimeout);
	keepAliveTimeout = undefined;
}

function setKeepAlive() {
	clearKeepAlive();
	keepAliveTimeout = setTimeout(start, KEEP_ALIVE_MS);
}

//  0 - No connection attempted
//  1 - EventSource created
//  2 - At least one message received via event source
//  3 - Use longpoll fallback (event source had error before reaching 2)
// -1 - Connection failed (fallback also encountered an error; perhaps
//      identifying the reason for the event source failure)
//
const BIND_IDLE = 0;
const BIND_WAITING = 1;
const BIND_MESSAGE = 2;
const BIND_LONG_POLL = 3;
const BIND_FAILED = -1;
let sourceBind = BIND_IDLE;

let lastEventId: string | undefined;

function toHref(basePath: string, eventId?: string, useSse = true) {
	const lastEvent = eventId
		? 'lastEventId=' + encodeURIComponent(eventId)
		: undefined;
	const query = useSse
		? lastEvent
		: lastEvent
		? SSE_FALLBACK_SEARCH_PAIR + '&' + lastEvent
		: SSE_FALLBACK_SEARCH_PAIR;
	return query ? basePath + '?' + query : basePath;
}

// --- Event to context state

function update(message: FxMessage) {
	switch (message.kind) {
		case 'fx-data': {
			// De-multiplex messages by pushing
			// prices onto the matching exchange pair store
			const { symbol, prices } = message;
			pushPrices(symbol, prices);
			return;
		}

		case 'keep-alive':
			console.log('keep-alive');
			return;

		case 'shutdown': {
			disconnect();
			const delay = message.until - message.timestamp - preconnectMs();
			console.log(`shutdown ${message.timestamp} ${message.until} ${delay}`);
			startTimeout = setTimeout(
				start,
				delay > MIN_WAIT_MS ? delay : MIN_WAIT_MS
			);
			return;
		}
	}
}

function multiUpdate(messages: FxMessage[]) {
	const lastIndex = messages.length - 1;
	if (lastIndex < 0) return;

	for (const message of messages) update(message);

	lastEventId = String(messages[lastIndex].timestamp);
}

// --- Event source ---

const READY_STATE_CLOSED = 2;
let eventSource: EventSource | undefined;

function onMessage(event: MessageEvent<string>) {
	if (event.lastEventId) lastEventId = event.lastEventId;
	setKeepAlive();

	const message = fromJson(event.data);
	if (!message) return;

	sourceBind = BIND_MESSAGE;
	update(message);
}

function disconnectEventSource() {
	if (!eventSource) return;

	clearKeepAlive();
	eventSource.removeEventListener('message', onMessage);
	eventSource.removeEventListener('error', onError);
	eventSource.close();
	eventSource = undefined;
}

function onError(_event: Event) {
	// No way to identify the reason here so try long polling next
	if (
		eventSource?.readyState === READY_STATE_CLOSED &&
		sourceBind !== BIND_MESSAGE
	) {
		sourceBind = BIND_LONG_POLL;
		disconnectEventSource();
		setTimeout(start);
	}
}

function connectEventSource(path: string) {
	const href = toHref(path, lastEventId);

	eventSource = new EventSource(href);
	sourceBind = BIND_WAITING;
	eventSource.addEventListener('error', onError);
	eventSource.addEventListener('message', onMessage);
	setKeepAlive();
}

// --- Long poll fallback ---

const LONG_POLL_WAIT = 50; // 50 milliseconds
let sampleTimeout: ReturnType<typeof setTimeout> | undefined;
let abort: AbortController | undefined;

function disconnectLongPoll() {
	clearKeepAlive();

	if (sampleTimeout) {
		clearTimeout(sampleTimeout);
		sampleTimeout = undefined;
	}

	if (abort) {
		abort.abort();
		abort = undefined; // i.e. don't repoll
	}
}

function sampleFailed() {
	sourceBind = BIND_FAILED;
	disconnectLongPoll();
}

async function fetchSample(
	path: string,
	scheduleNext: (waitMs: number) => void
) {
	sampleTimeout = undefined;
	console.assert(abort === undefined, 'sample abort unexpectedly set');

	let waitMs = -1;
	try {
		const href = toHref(path, lastEventId, false);
		abort = new AbortController();

		setKeepAlive();
		const response = await fetch(href, { signal: abort.signal });
		clearKeepAlive();

		if (response.ok) {
			const messages = await response.json();

			if (isFxMessageArray(messages)) multiUpdate(messages);
			waitMs = LONG_POLL_WAIT;
		} else {
			sampleFailed();
		}
	} catch (error) {
		console.error('fetchSample', error);
		sampleFailed();
	} finally {
		if (waitMs >= 0) scheduleNext(waitMs);
	}
}

function connectLongPoll(path: string) {
	const repoll = (waitMs: number) => {
		const lastAbort = abort;
		abort = undefined;

		sampleTimeout =
			typeof lastAbort === 'undefined'
				? undefined
				: setTimeout(fetchSample, waitMs, path, repoll);
	};

	setTimeout(fetchSample, LONG_POLL_WAIT, path, repoll);
}

// --- ---
const isActive = () =>
	Boolean(eventSource || startTimeout || abort || sampleTimeout);

function disconnect() {
	clearKeepAlive();

	if (eventSource) disconnectEventSource();
	else disconnectLongPoll();
}

function connect(path: string) {
	if (sourceBind !== BIND_LONG_POLL) connectEventSource(path);
	else connectLongPoll(path);
}

function setupEventData() {
	const fxstream = server$(connectServerSource);
	start = () => {
		disconnect();
		startTimeout = undefined;
		connect(fxstream.url);
	};

	createEffect(() => {
		const count = refCount();

		if (count < 1) {
			if (isActive()) {
				disconnect();

				lastEventId = undefined;

				if (startTimeout) {
					clearTimeout(startTimeout);
					startTimeout = undefined;
				}
			}

			return;
		}

		if (count > 0) {
			if (isActive()) return;

			start();
			return;
		}
	});
}

// --- Context management ---
function PairDataProvider(props: ParentProps) {
	setupEventData();

	return (
		<PairDataContext.Provider value={fxPairRecord}>
			{props.children}
		</PairDataContext.Provider>
	);
}

function usePairData() {
	setRefCount(increment);
	return useContext(PairDataContext);
}

export { disposePairData, PairDataProvider, usePairData };
