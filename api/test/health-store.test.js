/* Biscotos health import: token handling and sample validation. Synthetic values only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mintToken, hashToken, looksLikeToken, findByToken, publicHook, cleanLabel, dayOf, validateSample,
  mergeSamples, SAMPLES_MAX
} from '../health/store.js';

test('tokens: 256 random bits, prefixed, only the hash is ever compared', () => {
  const a = mintToken(), b = mintToken();
  assert.notEqual(a, b);
  assert.ok(looksLikeToken(a));
  assert.equal(a.length, 4 + 43);
  const doc = { webhooks: [
    { id: 'h1', uid: 'u1', tokenHash: hashToken(a) },
    { id: 'h2', uid: 'u2', tokenHash: hashToken(b), revokedAt: 5 },
    { id: 'h3', uid: 'u3', tokenHash: 'not-hex-at-all' },
  ] };
  assert.equal(findByToken(doc, a).id, 'h1');
  assert.equal(findByToken(doc, b), null, 'a revoked token is no token');
  for (const t of ['', 'bxh_short', hashToken(a), 'Bearer ' + a, a + 'x', null, undefined, 42]) assert.equal(findByToken(doc, t), null);
  assert.deepEqual(Object.keys(publicHook({ ...doc.webhooks[0], label: 'x', kind: 'apple-health', createdAt: 1 })).sort(),
    ['createdAt', 'id', 'kind', 'label', 'lastUsedAt', 'revokedAt']);
});

test('labels are cleaned and bounded', () => {
  assert.equal(cleanLabel(undefined), 'Apple Health');
  assert.equal(cleanLabel('  iPhone\n de  démo '), 'iPhone de démo');
  assert.equal(cleanLabel('x'.repeat(100)).length, 40);
  assert.equal(cleanLabel(42), null);
});

test('dayOf accepts a day or an ISO 8601 date-time, keeping the date as written', () => {
  assert.equal(dayOf('2026-10-14'), '2026-10-14');
  assert.equal(dayOf('2026-10-14T23:30:00+02:00'), '2026-10-14');
  assert.equal(dayOf('2026-10-14T07:05:12.123Z'), '2026-10-14');
  assert.equal(dayOf('2026-10-14 07:05'), '2026-10-14');
  for (const bad of ['14 Oct 2026 at 08:12', '2026-02-30', '1999-12-31', '2026-10-14T25:00', 20261014, null]) assert.equal(dayOf(bad), null, String(bad));
});

test('samples: closed list of types, physical bounds, units converted or refused', () => {
  const today = '2026-10-14';
  assert.deepEqual(validateSample({ type: 'weight', date: '2026-10-14', value: '75,42', unit: 'kg' }, { today }),
    { type: 'weight', d: '2026-10-14', value: 75.42, source: 'apple-health' });
  assert.equal(validateSample({ type: 'weight', date: today, value: 166.3, unit: 'lb' }).value, 75.43);
  assert.equal(validateSample({ type: 'sleepMin', date: today, value: 7.5, unit: 'h' }).value, 450);
  assert.equal(validateSample({ type: 'steps', date: today, value: 8123.7 }).value, 8124);
  assert.deepEqual(validateSample({ type: 'workoutMin', date: today, value: 45, id: 'HK-123:abc' }).extId, 'HK-123:abc');
  assert.equal(validateSample({ type: 'workoutMin', date: today, value: 45, id: '<script>' }).extId, undefined);
  for (const [s, why] of [
    [{ type: 'bloodGlucose', date: today, value: 5 }, 'unknown type'],
    [{ type: 'weight', date: today, value: 7000 }, 'value out of range'],
    [{ type: 'steps', date: today, value: -1 }, 'value out of range'],
    [{ type: 'restingHr', date: today, value: 'fast' }, 'value is not a number'],
    [{ type: 'weight', date: today, value: 75, unit: 'stone' }, 'unit must be kg'],
    [{ type: 'steps', date: '2026-10-20', value: 10 }, 'date in the future'],
    [{ type: 'steps', date: 'yesterday', value: 10 }, 'date must be YYYY-MM-DD or ISO 8601'],
    [[], 'not an object'],
  ]) assert.throws(() => validateSample(s, { today }), { message: why });
});

test('error messages never carry the value', () => {
  try { validateSample({ type: 'weight', date: '2026-10-14', value: 9876.54 }); }
  catch (e) { assert.ok(!e.message.includes('9876')); }
});

test('merge: one value per day for daily types, the later one wins; workouts by id', () => {
  const doc = { samples: [] };
  const s = (type, d, value, extra = {}) => ({ type, d, value, source: 'apple-health', ...extra });
  assert.equal(mergeSamples(doc, [s('steps', '2026-10-14', 3000), s('weight', '2026-10-14', 75)], 1), 2);
  assert.equal(mergeSamples(doc, [s('steps', '2026-10-14', 8000)], 2), 1);
  assert.equal(mergeSamples(doc, [s('steps', '2026-10-14', 8000)], 3), 0, 'same value: nothing changed');
  assert.equal(doc.samples.filter(x => x.type === 'steps').length, 1);
  assert.equal(doc.samples.find(x => x.type === 'steps').value, 8000);
  mergeSamples(doc, [s('workoutMin', '2026-10-14', 45, { extId: 'a' }), s('workoutMin', '2026-10-14', 30, { extId: 'b' })]);
  mergeSamples(doc, [s('workoutMin', '2026-10-14', 50, { extId: 'a' })]);
  assert.deepEqual(doc.samples.filter(x => x.type === 'workoutMin').map(x => [x.extId, x.value]), [['a', 50], ['b', 30]]);
});

test('merge keeps the newest days when the file reaches its cap', () => {
  const doc = { samples: Array.from({ length: SAMPLES_MAX }, (_, i) => ({ type: 'workoutMin', d: '2001-01-01', value: i + 1, source: 'apple-health', extId: 'x' + i })) };
  mergeSamples(doc, [{ type: 'steps', d: '2026-10-14', value: 1, source: 'apple-health' }]);
  assert.equal(doc.samples.length, SAMPLES_MAX);
  assert.ok(doc.samples.some(x => x.d === '2026-10-14'));
});
