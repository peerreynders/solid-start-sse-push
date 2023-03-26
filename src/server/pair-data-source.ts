import { makeRangeValue } from '~/lib/random';
import type { PairForJson } from '~/lib/foreign-exchange';

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

	return {
		timestamp: new Date(epochMs).toISOString(),
		symbol: config.symbol,
		bid: current.toFixed(fractionDigits),
		ask: (bid + spread).toFixed(fractionDigits),
	} as PairForJson;
}

export type Send = (info: string) => void;

const subscribers = new Set<Send>();

function sendPair(info: string) {
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
		sendPair(JSON.stringify(data));

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
	subscribers.add(send);
	if (!timeout && subscribers.size > 0) start();

	return () => {
		const result = subscribers.delete(send);
		if (subscribers.size < 1 && timeout) stop();

		return result;
	};
}

export { subscribe };
