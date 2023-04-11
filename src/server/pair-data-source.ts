import { isTimeValue } from '~/lib/helpers';
import { makeRangeValue } from '~/lib/random';
import {
	SYMBOLS,
	type FxDataMessage,
	type PriceJson,
} from '~/lib/foreign-exchange';

import { SourceController } from './solid-start-sse-support';

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

const epochMs = Date.now;

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

function makePriceBurst(now: number, after: number) {
	const result: string[] = [];

	for (const cache of priceCache.values()) {
		if (cache.prices.length < 1) continue;

		const history = copyHistory(cache, after);
		if (history.length < 1) continue;

		result.push(JSON.stringify(makeFxDataMessage(cache.symbol, now, history)));
	}

	return result;
}

// --- END Price Cache History
// --- BEGIN Subscriptions

const subscribers = new Set<SourceController>();
let lastSend = 0;

function sendEvent(now: number, data: string, id?: string) {
	for (const controller of subscribers) controller.send(data, id);

	lastSend = now;
}

function sendFxData(now: number, message: FxDataMessage) {
	cachePrice(message);
	const id = now.toString();
	const json = JSON.stringify(message);

	sendEvent(now, json, id);
}

function sendKeepAlive() {
	const now = epochMs();

	const json = JSON.stringify({
		kind: 'keep-alive',
		timestamp: now,
	});
	sendEvent(now, json);
}

const toJsonShutdown = (timestamp: number, until: number) =>
	JSON.stringify({
		kind: 'shutdown',
		timestamp,
		until,
	});

// --- keep alive (subscriptions)

const KEEP_ALIVE_MS = 15000; // 15 seconds
let keepAliveTimeout: ReturnType<typeof setTimeout> | undefined;

function keepAlive() {
	const now = epochMs();
	const silence = now - lastSend;
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

const startPairData = (() => {
	const nextDelay = makeRangeValue(250, 500); // 250-500 ms
	const nextConfigIndex = makeRangeValue(0, CONFIG.length - 1);
	const nextIntNoise = makeRangeValue(-1000, 1000);
	const nextNoise = () => nextIntNoise() / 1000;
	let nextSendTime = epochMs();

	const sendData = () => {
		const now = epochMs();
		const index = nextConfigIndex();
		const data = generateFxData(CONFIG[index], epochMs(), nextNoise());
		sendFxData(now, data);

		const delay = nextDelay();
		pairTimeout = setTimeout(sendData, delay - (now - nextSendTime));

		nextSendTime = now + delay;
	};

	return sendData;
})();

function stopPairData() {
	if (!pairTimeout) return;

	clearTimeout(pairTimeout);
	pairTimeout = undefined;
}

const PHASE_REST = 0;
const PHASE_ACCEPT = 1;
const PHASE_DATA = 2;
const cycles = [25_000, 5_000, 120_000];
let sourcePhase = PHASE_REST;
let restUntil = 0; // TimeValue

const noOp = () => void 0;
const msSinceStart = () => Math.trunc(performance.now());

function accept(controller: SourceController) {
	const id = Number(controller.lastEventId);
	const lastTime = Number.isNaN(id) || !isTimeValue(id) ? 0 : id;

	// 0. waiting -> 1. subscribed -> 2. unsubscribed
	let status = 0;
	const finalize = () => {
		if (status > 0) return;

		const now = epochMs();
		const burst = makePriceBurst(now, lastTime);
		const id = now.toString();
		for (const info of burst) controller.send(info, id);

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
	controller.send(toJsonShutdown(epochMs(), restUntil));

	return [controller.close, noOp];
}

function subscribe(controller: SourceController) {
	const [finalize, unsubscribe] = (
		sourcePhase === PHASE_REST ? bounce : accept
	)(controller);
	queueMicrotask(finalize);
	return unsubscribe;
}

function unsubscribeAll(now: number, until: number) {
	const controllers = Array.from(subscribers);
	subscribers.clear();

	for (const controller of controllers)
		controller.send(toJsonShutdown(now, until));

	queueMicrotask(() => {
		for (const controller of controllers) controller.close();
	});
}

// --- source phase (subscriptions)

let phaseTimeout: ReturnType<typeof setTimeout> | undefined;

function startSource() {
	if (phaseTimeout) return;

	const afterAccept = cycles[PHASE_ACCEPT];
	const afterData = afterAccept + cycles[PHASE_DATA];
	const fullCycle = afterData + cycles[PHASE_REST];

	const cyclesStart = msSinceStart();

	const nextPhase = () => {
		let expected = 0;

		switch (sourcePhase) {
			case PHASE_ACCEPT:
				// Starting Data phase
				sourcePhase = PHASE_DATA;
				expected = afterAccept;
				startPairData();
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
		const delay = cycles[sourcePhase];

		console.log(
			`Phase: ${
				sourcePhase === 0 ? 'Rest' : sourcePhase === 1 ? 'Accept' : 'Data'
			} delay ${delay} actual ${actual} delta ${delta} drift: ${drift}`
		);

		if (sourcePhase === PHASE_REST) {
			const epochNow = epochMs();
			restUntil = epochNow + delay + cycles[PHASE_ACCEPT];
			setTimeout(unsubscribeAll, 0, epochNow, restUntil);
		}
		phaseTimeout = setTimeout(nextPhase, delay - drift);
	};

	nextPhase();
}

// --- END Subscriptions

export { startSource, subscribe };
