// file: src/components/event-data-context.tsx
import {
	createContext,
	createEffect,
	useContext,
	createSignal,
	onCleanup,
	type Accessor,
	type ParentProps,
	type Setter,
} from 'solid-js';
import server$, { ServerFunctionEvent } from 'solid-start/server';
import { SYMBOLS, fromJson, type PairData } from '~/lib/foreign-exchange';

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
	timestamp,
	symbol,
	bid: ' ',
	ask: ' ',
});

const [pairs, pairSetters] = (() => {
	const accessors = new Map<string, Accessor<PairData>>();
	const setters = new Map<string, Setter<PairData>>();
	const now = new Date();
	for (const symbol of SYMBOLS.keys()) {
		const [pair, setPair] = createSignal(initialData(symbol, now));
		accessors.set(symbol, pair);
		setters.set(symbol, setPair);
	}
	return [accessors, setters];
})();

const PairDataContext = createContext(pairs);

let started = false;

function startEventData() {
	if (started) return;

	const handle = server$(connectServerSource);
	const href = handle.url;

	// Runs only once but also registers for clean up
	createEffect(() => {
		const onMessage = (message: MessageEvent<string>) => {
			const data = fromJson(message.data);
			if (!data) return;

			// De-multiplex event by pushing
			// it onto the matching exchange pair signal
			const setData = pairSetters.get(data.symbol);
			if (!setData) return;

			setData(data);
		};

		const eventSource = new EventSource(href);
		eventSource.addEventListener('message', onMessage);

		onCleanup(() => {
			eventSource.removeEventListener('message', onMessage);
			eventSource.close();
		});
	});

	started = true;
}

function PairDataProvider(props: ParentProps) {
	startEventData();

	return (
		<PairDataContext.Provider value={pairs}>
			{props.children}
		</PairDataContext.Provider>
	);
}

const usePairData = () => useContext(PairDataContext);

export { PairDataProvider, usePairData };
