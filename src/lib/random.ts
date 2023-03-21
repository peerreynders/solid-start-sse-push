import { nextValue, MAX_VALUE } from './random-pool-uint32';
import {
	makeRangeValue as makeRangeValueLib,
	rangeValue as rangeValueLib,
} from './random-lib';

const makeRangeValue = (minIncluded: number, maxIncluded: number) =>
	makeRangeValueLib(nextValue, MAX_VALUE, minIncluded, maxIncluded);

const rangeValue = (minIncluded: number, maxIncluded: number) =>
	rangeValueLib(nextValue(), MAX_VALUE, minIncluded, maxIncluded);

export { makeRangeValue, rangeValue };
