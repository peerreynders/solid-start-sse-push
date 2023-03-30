import { isTimeValue } from '~/lib/helpers';
import { makeRangeValue } from '~/lib/random';
import {
	SYMBOLS,
	type FxDataMessage,
	type PriceJson,
} from '~/lib/foreign-exchange';

import { InitArgument } from './solid-start-sse-support';

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
	for (
		let i = next < length ? next : 0, k = 0;
		k < length;
		i = (i + 1) % length, k += 1
	)
		if (prices[i].timestamp > after) history.push(prices[i]);

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

// EXP
let count = 60;
let unsub: (() => void) | undefined;

const subscribers = new Set<InitArgument['send']>();

function sendFxData(message: FxDataMessage) {
	cachePrice(message);
	const id = message.timestamp.toString();
	const json = JSON.stringify(message);
	for (const send of subscribers) send(json, id);

	// EXP
	count -= 1;
	if (count <= 0) {
		if (unsub) unsub();
		count = 60;
	}
}

let timeout: ReturnType<typeof setTimeout> | undefined = undefined;

function start() {
	const nextDelay = makeRangeValue(250, 500); // 250-500 ms
	const nextConfigIndex = makeRangeValue(0, CONFIG.length - 1);
	const nextIntNoise = makeRangeValue(-1000, 1000);
	const nextNoise = () => nextIntNoise() / 1000;
	let nextSendTime = Date.now();

	const sendData = () => {
		const now = Date.now();
		const index = nextConfigIndex();
		const data = generateFxData(CONFIG[index], Date.now(), nextNoise());
		sendFxData(data);

		const delay = nextDelay();
		timeout = setTimeout(sendData, delay - (now - nextSendTime));

		nextSendTime = now + delay;
	};
	sendData();
}

function stop() {
	if (!timeout) return;

	clearTimeout(timeout);
	timeout = undefined;
}

function subscribe({ send, close, lastEventId }: InitArgument) {
	if (!timeout) start();

	const id = Number(lastEventId);
	const lastTime = Number.isNaN(id) || !isTimeValue(id) ? 0 : id;

	// 0. waiting -> 1. subscribed -> 2. unsubscribed
	let status = 0;
	queueMicrotask(() => {
		if (status > 0) return;

		const now = Date.now();
		const burst = makePriceBurst(now, lastTime);
		const id = now.toString();
		for (const info of burst) send(info, id);

		subscribers.add(send);
		status = 1;
	});

	const unsubscribe = () => {
		const previous = status;
		status = 2;
		return previous < 1 ? true : subscribers.delete(send);
	};

	// EXP
	unsub = () => {
		close();
		unsubscribe();
	};
	return unsubscribe;
}

// --- END Subscriptions

export { start, stop, subscribe };
