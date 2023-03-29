import { makeRangeValue } from '~/lib/random';
import { SYMBOLS, type Pair, type PriceJson } from '~/lib/foreign-exchange';

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

function makePairForJson(config: PairConfig, epochMs: number, noise = 0.0) {
	const { bid, fractionDigits, long, short, spread } = config;
	const epochSecs = epochMs / 1000;
	const current =
		bid +
		noise * spread * 10 +
		cyclicSpread(spread, 100, long, epochSecs) +
		cyclicSpread(spread, 30, short, epochSecs);

	const pair: Pair<PriceJson> = {
		symbol: config.symbol,
		prices: [
			{
				timestamp: epochMs,
				bid: current.toFixed(fractionDigits),
				ask: (current + spread).toFixed(fractionDigits),
			},
		],
	};

	return pair;
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

function cachePrice(pair: Pair<PriceJson>) {
	const cache = priceCache.get(pair.symbol);
	if (!cache) return;

	const price = pair.prices[0];
	const next = cache.next;
	cache.next = (next + 1) % CACHE_SIZE;

	if (cache.prices.length >= CACHE_SIZE) {
		cache.prices[next] = price;
		return;
	}

	cache.prices.push(price);
}

function copyHistory({ next, prices }: PriceCache) {
	if (next !== 0 && prices.length === CACHE_SIZE) {
		const history = [];
		for (let i = next, k = 0; k < CACHE_SIZE; i = (i + 1) % CACHE_SIZE, k += 1)
			history.push(prices[i]);

		return history;
	}

	return prices.slice();
}

function makePriceBurst() {
	const result: string[] = [];
	for (const cache of priceCache.values()) {
		if (cache.prices.length < 1) continue;

		result.push(
			JSON.stringify({
				symbol: cache.symbol,
				prices: copyHistory(cache),
			})
		);
	}

	return result;
}

// --- END Price Cache History
// --- BEGIN Subscriptions

export type Send = (info: string) => void;

const subscribers = new Set<Send>();

function sendPair(pair: Pair<PriceJson>) {
	cachePrice(pair);
	const info = JSON.stringify(pair);
	for (const send of subscribers) send(info);
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
		const data = makePairForJson(CONFIG[index], Date.now(), nextNoise());
		sendPair(data);

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

function subscribe(send: Send) {
	if (!timeout) start();

	// 0. waiting -> 1. subscribed -> 2. unsubscribed
	let status = 0;
	queueMicrotask(() => {
		if (status > 0) return;

		const burst = makePriceBurst();
		for (const info of burst) send(info);

		subscribers.add(send);
		status = 1;
	});

	return () => {
		const previous = status;
		status = 2;
		return previous < 1 ? true : subscribers.delete(send);
	};
}

// --- END Subscriptions

export { start, stop, subscribe };
