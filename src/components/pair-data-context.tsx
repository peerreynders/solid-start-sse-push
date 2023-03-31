// file: src/components/event-data-context.tsx
import {
	createContext,
	createEffect,
	useContext,
	createSignal,
	type ParentProps,
} from 'solid-js';
import { createStore, type Store } from 'solid-js/store';
import server$, { ServerFunctionEvent } from 'solid-start/server';
import {
	SYMBOLS,
	fromJson,
	fromPriceJson,
	type Pair,
	type Price,
	type PriceJson,
} from '~/lib/foreign-exchange';

// --- START server side ---

import {
	eventStream,
	type EventStreamInit,
} from '~/server/solid-start-sse-support';
// NOTE: call `listen()` in `entry-server.tsx`
import { subscribe as subscribeToSource } from '~/server/pair-data-source';

async function connectServerSource(this: ServerFunctionEvent) {
	let unsubscribe: (() => void) | undefined = undefined;

	const init: EventStreamInit = (argument) => {
		unsubscribe = subscribeToSource(argument);

		return () => {
			if (unsubscribe) {
				unsubscribe();
				unsubscribe = undefined;
			}
			console.log('disconnect');
		};
	};

	return eventStream(this.request, init);
}

// --- END server side ---

export type PairStore = Store<Pair>;
type PushPriceFn = (latest: PriceJson[]) => void;

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

function makePricesStore(symbol: string) {
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
	const tuple: [PairStore, PushPriceFn] = [
		pairPrices,
		(latest: PriceJson[]) => {
			presetArgs.latest = latest;
			setPairPrices('prices', fn);
		},
	];

	return tuple;
}

const [priceStores, pushFns] = (() => {
	const stores = new Map<string, PairStore>();
	const setters = new Map<string, PushPriceFn>();
	for (const symbol of SYMBOLS.keys()) {
		const [store, push] = makePricesStore(symbol);
		stores.set(symbol, store);
		setters.set(symbol, push);
	}
	return [stores, setters];
})();

const PairDataContext = createContext(priceStores);

const [refCount, setRefCount] = createSignal(0);
const increment = (n: number) => n + 1;
const decrement = (n: number) => (n > 0 ? n - 1 : 0);

let eventSource: EventSource | undefined;
let lastEventId: string | undefined;

const KEEP_ALIVE_MS = 20000;
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

function onMessage(event: MessageEvent<string>) {
	if (event.lastEventId) lastEventId = event.lastEventId;
	setKeepAlive();

	const message = fromJson(event.data);
	if (!message) return;

	switch (message.kind) {
		case 'fx-data': {
			// De-multiplex messages by pushing
			// prices onto the matching exchange pair store
			const { symbol, prices } = message;
			const push = pushFns.get(symbol);
			if (!push) return;

			push(prices);
			return;
		}

		case 'keep-alive':
			return;
	}
}

function disconnect() {
	if (!eventSource) return;

	eventSource.removeEventListener('message', onMessage);
	eventSource.close();
	eventSource = undefined;
}

function connect(path: string) {
	disconnect();

	const href = lastEventId
		? `${path}?lastEventId=${encodeURIComponent(lastEventId)}`
		: path;
	eventSource = new EventSource(href);
	eventSource.addEventListener('message', onMessage);
}

function stop() {
	clearKeepAlive();
	disconnect();
	lastEventId = undefined;
}

function setupEventData() {
	const fxstream = server$(connectServerSource);
	start = () => {
		setKeepAlive();
		connect(fxstream.url);
	};

	createEffect(() => {
		if (!eventSource) {
			if (refCount() > 0) start();
		} else {
			if (refCount() < 1) stop();
		}
	});
}

function PairDataProvider(props: ParentProps) {
	setupEventData();

	return (
		<PairDataContext.Provider value={priceStores}>
			{props.children}
		</PairDataContext.Provider>
	);
}

function usePairData() {
	setRefCount(increment);
	return useContext(PairDataContext);
}

const disposePairData = () => setRefCount(decrement);

export { disposePairData, PairDataProvider, usePairData };
