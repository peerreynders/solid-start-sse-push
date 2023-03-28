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
import { SYMBOLS, fromJson, type Price } from '~/lib/foreign-exchange';

// --- START server side ---

import { eventStream } from '~/server/solid-start-sse-support';
// NOTE: call `listen()` in `entry-server.tsx`
import { subscribe as subscribeToSource } from '~/server/pair-data-source';

async function connectServerSource(this: ServerFunctionEvent) {
	let unsubscribe: (() => void) | undefined = undefined;

	const init = (send: (data: string) => void) => {
		unsubscribe = subscribeToSource(send);

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

type PairPrices = {
	symbol: string;
	prices: Price[];
};

export type PricesStore = Store<PairPrices>;
type PushPriceFn = (latest: Price) => void;

type PriceUpdateParameters = {
	latest: Price;
	maxLength: number;
};

function pushPrice(this: PriceUpdateParameters, current: Price[]) {
	const sliceEnd = current.length;
	const start = sliceEnd >= this.maxLength ? sliceEnd - this.maxLength + 1 : 0;
	const next = current.slice(start, sliceEnd);
	next.push(this.latest);
	return next;
}

function makePairPricesStore(empty: Price, symbol: string) {
	const [pairPrices, setPairPrices] = createStore<PairPrices>({
		symbol,
		prices: [],
	});

	const updateParameters: PriceUpdateParameters = {
		latest: empty,
		maxLength: 10,
	};
	const fn = pushPrice.bind(updateParameters);
	const tuple: [PricesStore, PushPriceFn] = [
		pairPrices,
		(latest: Price) => {
			updateParameters.latest = latest;
			setPairPrices('prices', fn);
		},
	];

	return tuple;
}

const [priceStores, pushFns] = (() => {
	const stores = new Map<string, Store<PairPrices>>();
	const setters = new Map<string, (latest: Price) => void>();
	const emptyPrice = {
		timestamp: new Date(),
		bid: '',
		ask: '',
	};
	for (const symbol of SYMBOLS.keys()) {
		const [store, push] = makePairPricesStore(emptyPrice, symbol);
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

function onMessage(message: MessageEvent<string>) {
	const data = fromJson(message.data);
	if (!data) return;

	// De-multiplex event by pushing
	// it onto the matching exchange pair signal
	const pushPrice = pushFns.get(data.symbol);
	if (!pushPrice) return;

	pushPrice(data.price);
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
	const handle = server$(connectServerSource);

	createEffect(() => {
		if (!eventSource) {
			if (refCount() > 0) startEventSource(handle.url);
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
