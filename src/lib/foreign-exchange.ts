import { isTimeValue } from './helpers';

export type PriceJson = {
	timestamp: number; // milliseconds since ECMAScript epoch
	bid: string; // decimal
	ask: string; // decimal
};

export type Price = Omit<PriceJson, 'timestamp'> & {
	timestamp: Date;
};

export type Pair<P> = {
	symbol: string; // Exchange Pair
	prices: P[];
};

export type PairPrices = Pair<Price>;

const SYMBOLS = new Map<string, string>([
	['USD-JPY', 'USD/JPY'],
	['EUR-USD', 'EUR/USD'],
	['AUD-GBP', 'AUD/GBP'],
]);

function isPriceValue(value: unknown): value is string {
	const num = Number(value);

	return (
		typeof value === 'string' && typeof num === 'number' && !Number.isNaN(num)
	);
}

function isPriceJson(data: unknown): data is PriceJson {
	if (typeof data !== 'object' || data === null) return false;

	const price = data as Record<string, unknown>;
	if (!isTimeValue(price.timestamp)) return false;

	if (!isPriceValue(price.bid)) return false;

	if (!isPriceValue(price.ask)) return false;

	return true;
}

const isPriceHistory = (data: unknown): data is PriceJson[] =>
	Array.isArray(data) ? data.every(isPriceJson) : false;

const toPrice = ({ timestamp, bid, ask }: PriceJson) => ({
	timestamp: new Date(timestamp),
	bid,
	ask,
});

function fromJson(raw: string) {
	const data = JSON.parse(raw) as Record<string, unknown>;
	if (typeof data !== 'object' || data === null) return undefined;

	const symbol = data.symbol;
	if (typeof symbol !== 'string' || !SYMBOLS.has(symbol)) return undefined;

	const history = data.prices;
	if (!isPriceHistory(history)) return undefined;

	const pair: Pair<Price> = {
		symbol,
		prices: history.map(toPrice),
	};

	return pair;
}

export type WithLatestParameters<P> = {
	latest: P[]; // more recent last
	maxLength: number;
};

function withLatestPrices<P>(this: WithLatestParameters<P>, history: P[]) {
	const length = this.latest.length;

	if (length >= this.maxLength) return this.latest.slice(-this.maxLength);

	const prices = history.slice(length - this.maxLength);
	for (const price of this.latest) prices.push(price);

	return prices;
}

const timeFormat = new Intl.DateTimeFormat(undefined, {
	dateStyle: 'short',
	timeStyle: 'medium',
});
const formatTimestamp = timeFormat.format;

export { formatTimestamp, fromJson, withLatestPrices, SYMBOLS };
