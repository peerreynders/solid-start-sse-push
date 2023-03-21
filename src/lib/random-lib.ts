// from: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Remainder#description
// const mod = (n: number, d: number) => ((n % d) + d) % d;

const rangeFactor = (
	maxValue: number,
	minIncluded: number,
	maxIncluded: number
) => (maxIncluded - minIncluded + 1) / maxValue;
const rangeBase = (maxValue: number, minIncluded: number, factor: number) =>
	factor * maxValue + minIncluded;
const calculateRangeValue = (base: number, factor: number, value: number) =>
	Math.floor(base - factor * value);

function makeRangeValue(
	nextValue: () => number,
	maxValue: number,
	minIncluded: number,
	maxIncluded: number
) {
	const factor = rangeFactor(maxValue, minIncluded, maxIncluded);
	const base = rangeBase(maxValue, minIncluded, factor);
	return () => calculateRangeValue(base, factor, nextValue());
}

function rangeValue(
	value: number,
	maxValue: number,
	minIncluded: number,
	maxIncluded: number
) {
	const factor = rangeFactor(maxValue, minIncluded, maxIncluded);
	return calculateRangeValue(
		rangeBase(maxValue, minIncluded, factor),
		factor,
		value
	);
}

export { makeRangeValue, rangeValue };
