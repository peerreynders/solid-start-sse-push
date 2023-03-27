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
	price: P;
};

export type PairPrice = Pair<Price>;

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

function fromJson(raw: string) {
	const data = JSON.parse(raw) as Record<string, unknown>;
	if (typeof data !== 'object' || data === null) return undefined;

	const symbol = data.symbol;
	if (typeof symbol !== 'string' || !SYMBOLS.has(symbol)) return undefined;

	const price = data.price;
	if (!isPriceJson(price)) return undefined;

	const pair: Pair<Price> = {
		symbol,
		price: {
			timestamp: new Date(price.timestamp),
			bid: price.bid,
			ask: price.ask,
		},
	};

	return pair;
}

export { SYMBOLS, fromJson };
