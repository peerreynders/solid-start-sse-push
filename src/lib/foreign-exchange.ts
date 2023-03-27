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

function fromJson(raw: string) {
	const data = JSON.parse(raw) as Record<string, unknown>;

	if (typeof data !== 'object' || data === null) return undefined;

	const symbol = data.symbol;
	if (typeof symbol !== 'string' || !SYMBOLS.has(symbol)) return undefined;

	if (typeof data.price !== 'object' || data.price === null) return undefined;
	const priceData = data.price as Record<string, unknown>;

	const timeValue = priceData.timestamp;
	if (!isTimeValue(timeValue)) return undefined;

	const timestamp = new Date(timeValue);
	if (
		timestamp.toString() === 'invalid date' ||
		timestamp.getTime() !== timeValue
	)
		return undefined;

	const bid = priceData.bid;
	const bidNumber = Number(bid);
	if (
		typeof bid !== 'string' ||
		typeof bidNumber !== 'number' ||
		Number.isNaN(bidNumber)
	)
		return undefined;

	const ask = priceData.ask;
	const askNumber = Number(ask);
	if (
		typeof ask !== 'string' ||
		typeof askNumber !== 'number' ||
		Number.isNaN(askNumber)
	)
		return undefined;

	const result: Pair<Price> = {
		symbol,
		price: {
			timestamp,
			bid,
			ask,
		},
	};

	return result;
}

export { SYMBOLS, fromJson };
