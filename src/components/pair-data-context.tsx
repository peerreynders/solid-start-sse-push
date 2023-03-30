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
	fromFxData,
	fromJson,
	withLatestPrices,
	type FxDataMessage,
	type Pair,
	type Price,
	type WithLatestParameters,
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
type PushPriceFn = (latest: Price[]) => void;

function makePricesStore(symbol: string) {
	const [pairPrices, setPairPrices] = createStore<Pair>({
		symbol,
		prices: [],
	});

	const parameters: WithLatestParameters<Price> = {
		latest: [],
		maxLength: 10,
	};

	// Prettier will remove the parenthesis resulting in:
	//   "An instantiation expression cannot be followed by a property access."
	// prettier-ignore
	const fn = (withLatestPrices<Price>).bind(parameters);
	const tuple: [PairStore, PushPriceFn] = [
		pairPrices,
		(latest: Price[]) => {
			parameters.latest = latest;
			setPairPrices('prices', fn);
		},
	];

	return tuple;
}

const [priceStores, pushFns] = (() => {
	const stores = new Map<string, PairStore>();
	const setters = new Map<string, (latest: Price[]) => void>();
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

function onFxData(message: FxDataMessage) {
	const pair = fromFxData(message);

	// De-multiplex message by pushing
	// it onto the matching exchange pair signal
	const push = pushFns.get(pair.symbol);
	if (!push) return;

	push(pair.prices);
}

function onMessage(event: MessageEvent<string>) {
	if (event.lastEventId) lastEventId = event.lastEventId;
	// EXP
	lastEventId;
	const message = fromJson(event.data);
	if (!message) return;

	switch (message.kind) {
		case 'fx-data':
			return onFxData(message);
	}
}

function stopEventSource() {
	if (!eventSource) return;

	eventSource.removeEventListener('message', onMessage);
	eventSource.close();
	eventSource = undefined;
}

function startEventSource(href: string) {
	if (eventSource) stopEventSource();

	eventSource = new EventSource(href);
	eventSource.addEventListener('message', onMessage);
}

function setupEventData() {
	const fxstream = server$(connectServerSource);

	createEffect(() => {
		if (!eventSource) {
			if (refCount() > 0) startEventSource(fxstream.url);
		} else {
			if (refCount() < 1) stopEventSource();
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
