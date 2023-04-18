import { isTimeValue } from '~/lib/helpers';
import { makeRangeValue } from '~/lib/random';
import {
	SYMBOLS,
	type FxMessage,
	type FxDataMessage,
	type ShutdownMessage,
	type PriceJson,
} from '~/lib/foreign-exchange';

import { SampleController, SourceController } from './solid-start-sse-support';

function makeFxDataMessage(
	symbol: string,
	timestamp: number,
	prices: PriceJson[]
) {
	const message: FxDataMessage = {
		kind: 'fx-data',
		timestamp,
		symbol,
		prices,
	};
	return message;
}

function makeShutdownMessage(timestamp: number, until: number) {
	const message: ShutdownMessage = {
		kind: 'shutdown',
		timestamp,
		until,
	};

	return message;
}

const noOp = () => void 0;
const msSinceStart = () => Math.trunc(performance.now());
const epochTimestamp = Date.now;

// --- BEGIN Generate values

const FULL_CYCLE = 360; // in degrees

function makePairConfig(
	symbol: string,
	bid: number,
	spread: number,
	fractionDigits: number,
	longCycle: number,
	shortCycle: number
) {
	return {
		symbol,
		bid,
		spread,
		fractionDigits,
		long: {
			length: longCycle,
			factor: FULL_CYCLE / longCycle,
		},
		short: {
			length: shortCycle,
			factor: FULL_CYCLE / shortCycle,
		},
	};
}

type PairConfig = ReturnType<typeof makePairConfig>;

const configEurUsd = makePairConfig('EUR-USD', 1.303, 0.0001, 5, 360, 47);

const CONFIG = [
	configEurUsd,
	configEurUsd,
	makePairConfig('USD-JPY', 95.1, 0.01, 3, 341, 55),
	makePairConfig('AUD-GBP', 1.455, 0.0002, 5, 319, 39),
];

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const cyclicSpread = (
	spread: number,
	weight: number,
	cycle: { length: number; factor: number },
	epochSecs: number
) =>
	spread *
	weight *
	Math.sin(toRadians(epochSecs % cycle.length) * cycle.factor);

function generateFxData(config: PairConfig, epochMs: number, noise = 0.0) {
	const { bid, fractionDigits, long, short, spread } = config;
	const epochSecs = epochMs / 1000;
	const current =
		bid +
		noise * spread * 10 +
		cyclicSpread(spread, 100, long, epochSecs) +
		cyclicSpread(spread, 30, short, epochSecs);

	return makeFxDataMessage(config.symbol, epochMs, [
		{
			timestamp: epochMs,
			bid: current.toFixed(fractionDigits),
			ask: (current + spread).toFixed(fractionDigits),
		},
	]);
}

// --- END Generate Values
// --- BEGIN Price Cache History

function makeCache(symbol: string) {
	return {
		symbol,
		prices: [] as PriceJson[],
		next: 0,
	};
}

type PriceCache = ReturnType<typeof makeCache>;

const CACHE_SIZE = 10;
const priceCache = (() => {
	const cache = new Map<string, PriceCache>();
	for (const symbol of SYMBOLS.keys()) cache.set(symbol, makeCache(symbol));
	return cache;
})();

function cachePrice({ symbol, prices: [price] }: FxDataMessage) {
	const cache = priceCache.get(symbol);
	if (!cache) return;

	// Replace least recent price
	const next = cache.next;
	cache.next = (next + 1) % CACHE_SIZE;

	if (cache.prices.length >= CACHE_SIZE) {
		cache.prices[next] = price;
		return;
	}

	cache.prices.push(price);
}

function copyHistory({ next, prices }: PriceCache, after: number) {
	const history = [];
	const length = prices.length;
	// accumulate history most recent first
	// only with timestamps more recent than `after`
	for (
		let i = next > 0 ? next - 1 : length - 1, k = 0;
		k < length;
		i = i > 0 ? i - 1 : length - 1, k += 1
	) {
		if (prices[i].timestamp <= after) break;

		history[k] = prices[i];
	}

	return history;
}

function makePriceBurst(timestamp: number, after: number) {
	const result: FxDataMessage[] = [];

	for (const cache of priceCache.values()) {
		if (cache.prices.length < 1) continue;

		const history = copyHistory(cache, after);
		if (history.length < 1) continue;

		result.push(makeFxDataMessage(cache.symbol, timestamp, history));
	}

	return result;
}

// --- END Price Cache History

// --- BEGIN Sample events
type SampleEvents = {
	controller: SampleController;
	lastEventId: number;
	events: number;
	respondBy: number;
};

// Dispatch when either is reached
const MAX_SAMPLE_MS = 5000; // 5 seconds
const MAX_SAMPLE_NEW_EVENTS = 8; // events since registration

// Waiting for…
const sampleEvents = new Set<SampleEvents>();
const ready: SampleEvents[] = [];
let nextSample = 0;
let sampleTimeout: ReturnType<typeof setTimeout> | undefined;

function stopSamples() {
	if (!sampleTimeout) return;

	clearTimeout(sampleTimeout);
	sampleTimeout = undefined;
	nextSample = 0;
}

function scheduleNextSample() {
	if (sampleEvents.size < 1) return stopSamples();

	const head = sampleEvents.values().next().value as SampleEvents;
	if (nextSample === head.respondBy) return;

	if (sampleTimeout) clearTimeout(sampleTimeout);

	nextSample = head.respondBy;
	sampleTimeout = setTimeout(releaseSamples, nextSample - msSinceStart());
}

function sendReady(timestamp: number, lastMessage?: FxMessage) {
	if (ready.length < 1) return;

	for (const item of ready) {
		const messages: FxMessage[] = makePriceBurst(timestamp, item.lastEventId);
		if (lastMessage) messages.push(lastMessage);
		item.controller.close(JSON.stringify(messages));
	}

	ready.length = 0;
}

function releaseSamples() {
	sampleTimeout = undefined;
	nextSample = 0;

	const now = msSinceStart();
	for (const item of sampleEvents) {
		if (item.respondBy > now) break;

		ready.push(item);
		sampleEvents.delete(item);
	}

	sendReady(epochTimestamp());
	scheduleNextSample();
}

function markSampleEvents(timestamp: number) {
	for (const item of sampleEvents) {
		item.events += 1;
		if (item.events < MAX_SAMPLE_NEW_EVENTS) continue;

		ready.push(item);
		sampleEvents.delete(item);
	}

	sendReady(timestamp);
	scheduleNextSample();
}

function shutdownSamples(timestamp: number, message: ShutdownMessage) {
	for (const item of sampleEvents) ready.push(item);

	sampleEvents.clear();
	sendReady(timestamp, message);
}
// --- END Sample events

// --- BEGIN Subscriptions
const subscribers = new Set<SourceController>();
let lastSend = 0;

function sendEvent(timestamp: number, data: string, id?: string) {
	for (const controller of subscribers) controller.send(data, id);

	lastSend = timestamp;
}

function sendKeepAlive() {
	const timestamp = epochTimestamp();

	const json = JSON.stringify({
		kind: 'keep-alive',
		timestamp,
	});
	sendEvent(timestamp, json);
}

function sendFxData(timestamp: number, message: FxDataMessage) {
	cachePrice(message);
	const id = timestamp.toString();
	const json = JSON.stringify(message);

	sendEvent(timestamp, json, id);

	markSampleEvents(timestamp);
}

function shutdownSubscribers(message: ShutdownMessage) {
	const json = JSON.stringify(message);
	const controllers = Array.from(subscribers);
	subscribers.clear();

	for (const controller of controllers) controller.send(json);

	queueMicrotask(() => {
		for (const controller of controllers) controller.close();
	});
}

// --- keep alive (subscriptions)

const KEEP_ALIVE_MS = 15000; // 15 seconds
let keepAliveTimeout: ReturnType<typeof setTimeout> | undefined;

function keepAlive() {
	const silence = epochTimestamp() - lastSend;
	const delay =
		silence < KEEP_ALIVE_MS ? KEEP_ALIVE_MS - silence : KEEP_ALIVE_MS;
	keepAliveTimeout = setTimeout(keepAlive, delay);

	if (delay < KEEP_ALIVE_MS) return;
	sendKeepAlive();
}

function stopKeepAlive() {
	if (!keepAliveTimeout) return;

	clearTimeout(keepAliveTimeout);
	keepAliveTimeout = undefined;
}

function startKeepAlive() {
	stopKeepAlive();
	keepAliveTimeout = setTimeout(keepAlive, KEEP_ALIVE_MS);
}

// --- start/stop (subscriptions)

let pairTimeout: ReturnType<typeof setTimeout> | undefined;

const [startData, stopData] = (() => {
	const nextDelay = makeRangeValue(250, 500); // 250-500 ms
	const nextConfigIndex = makeRangeValue(0, CONFIG.length - 1);
	const nextIntNoise = makeRangeValue(-1000, 1000);
	const nextNoise = () => nextIntNoise() / 1000;
	let nextSendTime = 0;

	function sendData() {
		const timestamp = epochTimestamp();

		const index = nextConfigIndex();
		const data = generateFxData(CONFIG[index], timestamp, nextNoise());
		sendFxData(timestamp, data);

		nextSendTime += nextDelay();
		pairTimeout = setTimeout(sendData, nextSendTime - timestamp);
	}

	function stop() {
		if (pairTimeout) {
			clearTimeout(pairTimeout);
			pairTimeout = undefined;
		}
		nextSendTime = 0;
	}

	function start() {
		nextSendTime = epochTimestamp();
		sendData();
	}

	return [start, stop];
})();

function stopPairData() {
	if (!pairTimeout) return;

	clearTimeout(pairTimeout);
	pairTimeout = undefined;
}

const PHASE_REST = 0;
const PHASE_ACCEPT = 1;
const PHASE_DATA = 2;
const cycle = [25_000, 5_000, 120_000];
let sourcePhase = PHASE_REST;
let restUntil = 0; // TimeValue

// --- Event subscriptions

function accept(controller: SourceController, lastEventId?: string) {
	const id = Number(lastEventId);
	const lastTime = Number.isNaN(id) || !isTimeValue(id) ? 0 : id;

	// 0. waiting -> 1. subscribed -> 2. unsubscribed
	let status = 0;
	const finalize = () => {
		if (status > 0) return;

		const timestamp = epochTimestamp();
		const burst = makePriceBurst(timestamp, lastTime);
		const id = timestamp.toString();
		for (const info of burst) {
			controller.send(JSON.stringify(info), id);
		}

		subscribers.add(controller);
		status = 1;
	};

	const unsubscribe = () => {
		const previous = status;
		status = 2;
		return previous < 1 ? true : subscribers.delete(controller);
	};

	return [finalize, unsubscribe];
}

function bounce(controller: SourceController) {
	controller.send(
		JSON.stringify(makeShutdownMessage(epochTimestamp(), restUntil))
	);
	return [controller.close, noOp];
}

function subscribe(controller: SourceController, lastEventId?: string) {
	const [finalize, unsubscribe] =
		sourcePhase === PHASE_REST
			? bounce(controller)
			: accept(controller, lastEventId);

	queueMicrotask(finalize);
	return unsubscribe;
}

// --- Long poll samples
function acceptSample(controller: SampleController, lastEventId?: string) {
	const id = Number(lastEventId);
	const lastId = Number.isNaN(id) || !isTimeValue(id) ? 0 : id;

	const item = {
		controller,
		lastEventId: lastId,
		events: 0,
		respondBy: msSinceStart() + MAX_SAMPLE_MS,
	};

	const unregister = () => {
		sampleEvents.delete(item);
		scheduleNextSample();
	};

	sampleEvents.add(item);
	scheduleNextSample();

	return unregister;
}

function bounceSample(controller: SampleController) {
	controller.close(
		JSON.stringify([makeShutdownMessage(epochTimestamp(), restUntil)])
	);

	return noOp;
}

const sample = (controller: SampleController, lastEventId?: string) =>
	sourcePhase === PHASE_REST
		? bounceSample(controller)
		: acceptSample(controller, lastEventId);
// ---
function shutdownConnections(timestamp: number, until: number) {
	const message = makeShutdownMessage(timestamp, until);

	shutdownSubscribers(message);
	shutdownSamples(timestamp, message);
}

// --- source phase (subscriptions)

let phaseTimeout: ReturnType<typeof setTimeout> | undefined;

function startSource() {
	if (phaseTimeout) return;

	const afterAccept = cycle[PHASE_ACCEPT];
	const afterData = afterAccept + cycle[PHASE_DATA];
	const fullCycle = afterData + cycle[PHASE_REST];

	const cyclesStart = msSinceStart();

	const nextPhase = () => {
		let expected = 0;

		switch (sourcePhase) {
			case PHASE_ACCEPT:
				// Starting Data phase
				sourcePhase = PHASE_DATA;
				expected = afterAccept;
				startData();
				break;

			case PHASE_DATA:
				// Starting Rest phase
				sourcePhase = PHASE_REST;
				expected = afterData;
				stopPairData();
				stopKeepAlive();
				break;

			case PHASE_REST:
				// Starting Accept phase
				sourcePhase = PHASE_ACCEPT;
				startKeepAlive();
				break;
		}

		const now = msSinceStart();
		const actual = (now - cyclesStart) % fullCycle;
		const delta = actual - expected;
		const drift = actual > expected && actual ? actual - expected : 0;
		const delay = cycle[sourcePhase];

		console.log(
			`Phase: ${
				sourcePhase === 0 ? 'Rest' : sourcePhase === 1 ? 'Accept' : 'Data'
			} delay ${delay} actual ${actual} delta ${delta} drift: ${drift}`
		);

		if (sourcePhase === PHASE_REST) {
			stopData();
			const timestamp = epochTimestamp();
			restUntil = timestamp + delay + cycle[PHASE_ACCEPT];
			setTimeout(shutdownConnections, 0, timestamp, restUntil);
		}
		phaseTimeout = setTimeout(nextPhase, delay - drift);
	};

	nextPhase();
}

// --- END Subscriptions

export { sample, startSource, subscribe };
