export type PairForJson = {
	timestamp: string; // ISO Date
	symbol: string; // Exchange Pair
	bid: string; // decimal
	ask: string; // decimal
};

export type PairData = Omit<PairForJson, 'timestamp'> & {
	timestamp: Date;
};

const SYMBOLS = new Map<string, string>([
	['USD-JPY', 'USD/JPY'],
	['EUR-USD', 'EUR/USD'],
	['AUD-GBP', 'AUD/GBP'],
]);

function fromJson(raw: string) {
	const data = JSON.parse(raw) as Record<string, unknown>;

	if (typeof data !== 'object' || data === null) return undefined;

	const timeString = data.timestamp;
	if (typeof timeString !== 'string') return undefined;

	const timestamp = new Date(timeString);
	if (
		timestamp.toString() === 'invalid date' ||
		timestamp.toISOString() !== timeString
	)
		return undefined;

	const symbol = data.symbol;
	if (typeof symbol !== 'string' || !SYMBOLS.has(symbol)) return undefined;

	const bid = data.bid;
	const bidNumber = Number(bid);
	if (
		typeof bid !== 'string' ||
		typeof bidNumber !== 'number' ||
		Number.isNaN(bidNumber)
	)
		return undefined;

	const ask = data.ask;
	const askNumber = Number(ask);
	if (
		typeof ask !== 'string' ||
		typeof askNumber !== 'number' ||
		Number.isNaN(askNumber)
	)
		return undefined;

	const result: PairData = {
		timestamp,
		symbol,
		bid,
		ask,
	};

	return result;
}

export { SYMBOLS, fromJson };
