import { isTimeValue } from './helpers';

export type PriceJson = {
	timestamp: number; // milliseconds since ECMAScript epoch
	bid: string; // decimal
	ask: string; // decimal
};

export type Price = Omit<PriceJson, 'timestamp'> & {
	timestamp: Date;
};

export type FxDataMessage = {
	kind: 'fx-data';
	symbol: string; // Exchange Pair
	timestamp: number;
	prices: PriceJson[];
};

export type KeepAliveMessage = {
	kind: 'keep-alive';
	timestamp: number;
};

export type FxMessage = FxDataMessage | KeepAliveMessage;

export type Pair = {
	symbol: string;
	prices: Price[];
};

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

function isFxData(message: Record<string, unknown>): message is FxDataMessage {
	if (message.kind !== 'fx-data') return false;

	if (!isTimeValue(message.timestamp)) return false;

	const symbol = message.symbol;
	if (typeof symbol !== 'string' || !SYMBOLS.has(symbol)) return false;

	return Array.isArray(message.prices)
		? message.prices.every(isPriceJson)
		: false;
}

function isKeepAlive(
	message: Record<string, unknown>
): message is KeepAliveMessage {
	if (message.kind !== 'keep-alive') return false;

	return isTimeValue(message.timestamp);
}

const fromPriceJson = ({ timestamp, bid, ask }: PriceJson) => ({
	timestamp: new Date(timestamp),
	bid,
	ask,
});

function fromJson(raw: string) {
	const message = JSON.parse(raw) as Record<string, unknown>;
	if (typeof message !== 'object' || message === null) return undefined;

	if (isFxData(message)) return message;

	if (isKeepAlive(message)) return message;

	return undefined;
}

const timeFormat = new Intl.DateTimeFormat(undefined, {
	dateStyle: 'short',
	timeStyle: 'medium',
});
const formatTimestamp = timeFormat.format;

export { formatTimestamp, fromJson, fromPriceJson, SYMBOLS };
