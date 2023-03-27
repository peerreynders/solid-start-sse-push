// file: src/components/event-data-context.tsx
import {
	createContext,
	createEffect,
	useContext,
	createSignal,
	type Accessor,
	type ParentProps,
	type Setter,
} from 'solid-js';
import server$, { ServerFunctionEvent } from 'solid-start/server';
import { SYMBOLS, fromJson, type PairPrice } from '~/lib/foreign-exchange';

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

const initialData = (symbol: string, timestamp: Date) => ({
	symbol,
	price: {
		timestamp,
		bid: ' ',
		ask: ' ',
	},
});

const [pairs, pairSetters] = (() => {
	const accessors = new Map<string, Accessor<PairPrice>>();
	const setters = new Map<string, Setter<PairPrice>>();
	const now = new Date();
	for (const symbol of SYMBOLS.keys()) {
		const [pair, setPair] = createSignal(initialData(symbol, now));
		accessors.set(symbol, pair);
		setters.set(symbol, setPair);
	}
	return [accessors, setters];
})();

const PairDataContext = createContext(pairs);

const [refCount, setRefCount] = createSignal(0);
const increment = (n: number) => n + 1;
const decrement = (n: number) => (n > 0 ? n - 1 : 0);

let eventSource: EventSource | undefined;

function onMessage(message: MessageEvent<string>) {
	const data = fromJson(message.data);
	if (!data) return;

	// De-multiplex event by pushing
	// it onto the matching exchange pair signal
	const setData = pairSetters.get(data.symbol);
	if (!setData) return;

	setData(data);
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
		<PairDataContext.Provider value={pairs}>
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
