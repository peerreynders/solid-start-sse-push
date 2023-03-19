// file: src/components/event-data-context.tsx
import {
	createContext,
	createEffect,
	useContext,
	createSignal,
	onCleanup,
	type ParentProps,
} from 'solid-js';
import server$, { ServerFunctionEvent } from 'solid-start/server';

// --- START server side ---

import { eventStream } from '~/server/solid-start-sse-support';
// NOTE: call `listen()` in `entry-server.tsx`

async function connectServerSource(this: ServerFunctionEvent) {
	const init = (send: (data: string) => void) => {

	  let timeout : ReturnType<typeof setTimeout> | undefined = undefined;
		const delay = () => Math.trunc(Math.random() * 251 + 250); // 200-500 ms 
	  const sendData = () => {
		  const data = {
			  timestamp: (new Date()).toISOString(),
				symbol: 'EUR/USD',
				bid: 1303,
				ask: 1304
			};
		  send(JSON.stringify(data));
			timeout = setTimeout(sendData, delay())
		};
		sendData();

		return () => {
			console.log('disconnect');
			clearTimeout(timeout);
		};
	};

	return eventStream(this.request, init);
}

// --- END server side ---
type EventRaw = {
  timestamp: string;
	symbol: string;
	bid: number;
	ask: number;
}

export type EventData = {
  timestamp: Date;
	symbol: string;
	bid: number;
	ask: number;
};

const initData: () => EventData = () => ({
  timestamp: new Date(0),
  symbol: 'EUR/USD',
	bid: 0,
	ask: 0,
});

function fromJSON(raw: string) {
  const { 
	  timestamp: isoTime, 
		symbol, 
		bid: rawBid, 
		ask: rawAsk 
	} = JSON.parse(raw) as EventRaw;

	const data: EventData = {
	  timestamp: new Date(isoTime),
		symbol,
		bid: rawBid / 1000,
		ask: rawAsk / 1000,
	};

	return data;
}

const [eventData, setEventData] = createSignal(initData());

const EventDataContext = createContext(eventData);

let started = false;

function startEventData() {
	if (started) return;

	const handle = server$(connectServerSource);
	const href = handle.url;

  // Runs only once but also registers for clean up
	createEffect(() => {
		const onMessage = (message: MessageEvent<string>) => {
			setEventData(fromJSON(message.data));
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

function EventDataProvider(props: ParentProps) {
	startEventData();

	return (
		<EventDataContext.Provider value={eventData}>
			{props.children}
		</EventDataContext.Provider>
	);
}

const useEventData = () => useContext(EventDataContext);

export { EventDataProvider, useEventData };
