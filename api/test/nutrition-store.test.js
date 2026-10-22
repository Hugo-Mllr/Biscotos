/* Biscotos nutrition: the validators every write goes through, and the per-profile file. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateFood, validateLogEntry, validateGoals, validateProfile, validatePer100, applyUpdate,
  isDay, isBarcode, nutritionFile, readDoc, writeDoc, removeDoc, entriesBetween, spanDays,
  ValidationError, UnreadableError, LIMITS
} from '../nutrition/store.js';
import { atomicWrite } from '../durable.js';

const per100 = { kcal: 389, protein: 16.9, carbs: 66.3, fat: 6.9 };
const throwsOn = (fn, field) => assert.throws(fn, e => e instanceof ValidationError && e.field === field);

test('isDay accepts real calendar days only', () => {
  assert.equal(isDay('2026-10-14'), true);
  assert.equal(isDay('2028-02-29'), true);
  for (const bad of ['2026-02-30', '2026-13-01', '26-10-14', '2026-10-14T00:00', '1999-12-31', '2101-01-01', 20261014, null, '']) {
    assert.equal(isDay(bad), false, String(bad));
  }
});

test('isBarcode: 8 to 14 digits', () => {
  assert.equal(isBarcode('3017620422003'), true);
  assert.equal(isBarcode('12345678'), true);
  for (const bad of ['1234567', '123456789012345', '30176204220a3', 3017620422003, '']) assert.equal(isBarcode(bad), false);
});

test('per100: kcal and the three macros required, bounded, and physically possible', () => {
  assert.deepEqual(validatePer100({ ...per100, fiber: 10.6, salt: '0,02' }), { ...per100, fiber: 10.6, salt: 0.02 });
  throwsOn(() => validatePer100(null), 'per100');
  throwsOn(() => validatePer100({ ...per100, kcal: undefined }), 'per100.kcal');
  throwsOn(() => validatePer100({ ...per100, kcal: 901 }), 'per100.kcal');
  throwsOn(() => validatePer100({ ...per100, protein: -1 }), 'per100.protein');
  throwsOn(() => validatePer100({ ...per100, fat: 'beaucoup' }), 'per100.fat');
  throwsOn(() => validatePer100({ ...per100, carbs: Infinity }), 'per100.carbs');
  throwsOn(() => validatePer100({ kcal: 500, protein: 60, carbs: 40, fat: 20 }), 'per100');   // 120 g in 100 g
});

test('a food: names trimmed and capped, control characters out, unknown fields dropped', () => {
  const f = validateFood({
    name: '  Flocons\u0000 d’avoine\n  ', brand: 'B'.repeat(200), barcode: '3017620422003',
    per100, serving: { label: '1 bol', grams: 40 }, isAdmin: true, __proto__: { x: 1 }, uid: 'someone-else'
  });
  assert.equal(f.name, 'Flocons d’avoine');
  assert.equal(f.brand.length, LIMITS.BRAND_MAX);
  assert.equal(f.source, 'manual');
  assert.deepEqual(Object.keys(f).sort(), ['barcode', 'brand', 'name', 'per100', 'serving', 'source']);
  throwsOn(() => validateFood({ per100 }), 'name');
  throwsOn(() => validateFood({ name: '   ', per100 }), 'name');
  throwsOn(() => validateFood({ name: 'x', per100, barcode: '12ab' }), 'barcode');
  throwsOn(() => validateFood({ name: 'x', per100, source: 'strava' }), 'source');
  throwsOn(() => validateFood({ name: 'x', per100, serving: { label: 'bol', grams: 0 } }), 'serving.grams');
  throwsOn(() => validateFood([]), 'food');
});

test('a log entry: day, meal, grams and nutrients all checked', () => {
  const e = validateLogEntry({ d: '2026-10-14', meal: 'breakfast', grams: '45,5', name: 'Avoine', per100, extra: 1 });
  assert.deepEqual(e, { d: '2026-10-14', meal: 'breakfast', grams: 45.5, name: 'Avoine', per100, source: 'manual' });
  throwsOn(() => validateLogEntry({ ...e, d: '2026-02-31' }), 'd');
  throwsOn(() => validateLogEntry({ ...e, meal: 'brunch' }), 'meal');
  throwsOn(() => validateLogEntry({ ...e, grams: 0 }), 'grams');
  throwsOn(() => validateLogEntry({ ...e, grams: LIMITS.GRAMS_MAX + 1 }), 'grams');
  throwsOn(() => validateLogEntry({ ...e, per100: undefined }), 'per100');
});

test('an update validates only what it carries, and null clears an optional field', () => {
  const changes = validateLogEntry({ grams: 80, brand: null }, { partial: true });
  assert.deepEqual(changes, { grams: 80, brand: undefined });
  const before = { id: 'a', d: '2026-10-14', grams: 40, brand: 'X', name: 'Avoine', createdAt: 1 };
  assert.deepEqual(applyUpdate(before, changes, 99), { id: 'a', d: '2026-10-14', grams: 80, name: 'Avoine', createdAt: 1, updatedAt: 99 });
  throwsOn(() => validateLogEntry({}, { partial: true }), 'entry');
  throwsOn(() => validateLogEntry({ grams: -3 }, { partial: true }), 'grams');
});

test('goals and profile', () => {
  assert.deepEqual(validateGoals({ kcal: '2400', protein: 160.4 }), { kcal: 2400, protein: 160 });
  assert.equal(validateGoals({}), null);
  assert.equal(validateGoals(null), null);
  throwsOn(() => validateGoals({ kcal: 20000 }), 'goals.kcal');
  assert.deepEqual(validateProfile({ heightCm: 178.25 }), { heightCm: 178.3 });
  assert.deepEqual(validateProfile({ heightCm: null }), { heightCm: null });
  throwsOn(() => validateProfile({ heightCm: 20 }), 'profile.heightCm');
  // the body profile: only the keys sent, nulls clear, values are checked
  assert.deepEqual(validateProfile({}), {});
  assert.deepEqual(
    validateProfile({ birthYear: '1999', sex: 'f', activity: 'mid', goalMode: 'cut', pace: 'steady', bodyFatPct: 18.26, calibrate: true }, { year: 2026 }),
    { birthYear: 1999, sex: 'f', activity: 'mid', goalMode: 'cut', pace: 'steady', bodyFatPct: 18.3, calibrate: true });
  assert.deepEqual(validateProfile({ sex: null, goalMode: '', calibrate: null }), { sex: null, goalMode: null, calibrate: false });
  throwsOn(() => validateProfile({ sex: 'x' }), 'profile.sex');
  throwsOn(() => validateProfile({ goalMode: 'bulking' }), 'profile.goalMode');
  throwsOn(() => validateProfile({ birthYear: 1850 }, { year: 2026 }), 'profile.birthYear');
  throwsOn(() => validateProfile({ birthYear: 2020 }, { year: 2026 }), 'profile.birthYear');
  throwsOn(() => validateProfile({ bodyFatPct: 90 }), 'profile.bodyFatPct');
  throwsOn(() => validateProfile({ calibrate: 'yes' }), 'profile.calibrate');
  assert.deepEqual(validateProfile({ calibration: -120.4 }), { calibration: -120 });
  throwsOn(() => validateProfile({ calibration: 900 }), 'profile.calibration');
});

test('the file: per profile, uid sanitised, damaged file never treated as empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-nutri-'));
  try {
    assert.equal(path.basename(nutritionFile(dir, '../../etc/passwd')), 'nutrition-etcpasswd.json');
    assert.throws(() => nutritionFile(dir, '../'));
    assert.deepEqual(readDoc(dir, 'u1').log, []);
    const doc = readDoc(dir, 'u1');
    doc.log.push({ id: 'x', d: '2026-10-14', createdAt: 2 }, { id: 'y', d: '2026-10-12', createdAt: 1 }, { id: 'z', d: '2026-10-14', createdAt: 1 });
    writeDoc(dir, 'u1', doc, atomicWrite);
    assert.equal(fs.statSync(nutritionFile(dir, 'u1')).mode & 0o777, 0o600);
    assert.deepEqual(entriesBetween(readDoc(dir, 'u1'), '2026-10-13', '2026-10-14').map(e => e.id), ['z', 'x']);
    assert.deepEqual(readDoc(dir, 'u2').log, [], 'another profile sees nothing');
    fs.writeFileSync(nutritionFile(dir, 'u3'), '{"log": [');
    assert.throws(() => readDoc(dir, 'u3'), UnreadableError);
    removeDoc(dir, 'u1');
    assert.equal(fs.existsSync(nutritionFile(dir, 'u1')), false);
    assert.equal(spanDays('2026-10-01', '2026-10-01'), 1);
    assert.equal(spanDays('2026-01-01', '2026-03-31'), 90);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
