// Decimal helpers for the rules.
import Decimal from 'decimal.js';
import { dec, type Num } from '../money';

export const D = (v: Num) => dec(v);
export const fix = (d: Decimal, places: number) => d.toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places);
