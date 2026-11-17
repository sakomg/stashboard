import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heatScore, type Readings } from '../../src/domain/heat.ts';
import { rsi, sma } from '../../src/domain/indicators.ts';

const heat = {
  weights: { rsiDaily: 30, rsiWeekly: 25, funding: 20, ma200: 15, oiGrowth: 10 },
  overheated: { rsiDaily: 70, rsiWeekly: 75, funding8hPct: 0.03, ma200Pct: 50, oiGrowth7dPct: 30 },
  zones: { neutral: 30, warm: 60, overheated: 80 },
};
const none: Readings = { rsiDaily: null, rsiWeekly: null, funding: null, ma200: null, oiGrowth: null };

test("RSI matches Wilder's published example", () => {
  const closes = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28,
  ];
  assert.equal(rsi(closes)!.toFixed(2), '70.46');
  assert.equal(rsi([...closes, 46.0])!.toFixed(2), '66.25');
  assert.equal(rsi(closes.slice(0, 14)), null);
});

test('moving average needs a full window', () => {
  assert.equal(sma([1, 2, 3, 4], 2), 3.5);
  assert.equal(sma([1], 2), null);
});

test('neutral readings score 50 and every reading at its threshold scores 80', () => {
  const neutral = heatScore({ rsiDaily: 50, rsiWeekly: 50, funding: 0.01, ma200: 0, oiGrowth: 0 }, heat)!;
  assert.equal(neutral.score, 50);
  assert.equal(neutral.zone, 'neutral');

  const hot = heatScore({ rsiDaily: 70, rsiWeekly: 75, funding: 0.03, ma200: 50, oiGrowth: 30 }, heat)!;
  assert.equal(Math.round(hot.score), 80);
  assert.equal(hot.zone, 'overheated');
});

test('missing readings hand their weight to the rest', () => {
  const stock = heatScore({ ...none, rsiDaily: 70, rsiWeekly: 50 }, heat)!;
  assert.deepEqual(
    stock.components.map((c) => [c.name, c.weight.toFixed(3)]),
    [
      ['rsiDaily', '0.545'],
      ['rsiWeekly', '0.455'],
    ],
  );
  assert.equal(stock.score.toFixed(1), ((80 * 30 + 50 * 25) / 55).toFixed(1));
  assert.equal(heatScore(none, heat), null);
});

test('scores are clamped and deep oversold reads as cold', () => {
  const cold = heatScore({ ...none, rsiDaily: 15, rsiWeekly: 25 }, heat)!;
  assert.equal(cold.zone, 'cold');
  assert.equal(heatScore({ ...none, rsiDaily: 100 }, heat)!.score, 100);
  assert.equal(heatScore({ ...none, ma200: -500 }, heat)!.score, 0);
});
