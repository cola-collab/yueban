import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, buildCalendarPackage, buildTestCalendar, currentPhase, nextEstimate, planFingerprint, validSettings } from './logic.mjs';
import { defaultSettings, loadSettingsFrom, writeLocal } from './state.mjs';

const settings = { lastStart: '2026-09-08', cycleLength: 30, periodLength: 5, reminderTime: '09:00', reminderMode: 'three' };

test('date arithmetic survives month and leap boundaries', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2026-01-31', 29), '2026-03-01');
});

test('an unconfirmed estimate remains overdue, not an actual period', () => {
  const estimate = nextEstimate(settings, '2026-10-09');
  assert.equal(estimate.start, '2026-10-08');
  assert.equal(estimate.overdue, true);
  assert.equal(estimate.nextProjection, '2026-11-07');
  assert.equal(currentPhase(settings, '2026-10-09'), 'general');
  assert.equal(nextEstimate(settings, '2026-10-08').overdue, false);
  assert.equal(currentPhase({ ...settings, lastStart: '2026-10-08' }, '2026-10-09'), 'during');
});

test('no prediction without user supplied cycle length', () => {
  assert.equal(nextEstimate({ ...settings, cycleLength: null }, '2026-10-09'), null);
  assert.equal(validSettings({ ...settings, cycleLength: 0 }), false);
});

test('remaining event in the current estimated cycle is not omitted', () => {
  const now = new Date(2026, 9, 9, 8, 0);
  const result = buildCalendarPackage(settings, now);
  assert.match(result.ics, /DTSTART:20261014T090000/);
  assert.doesNotMatch(result.ics, /DTSTART:20261008T090000/);
  assert.match(result.ics, /DTSTART:20261104T090000/);
});

test('past reminder today is excluded by local time, not only date', () => {
  const now = new Date(2026, 9, 5, 15, 0);
  const result = buildCalendarPackage(settings, now);
  assert.doesNotMatch(result.ics, /DTSTART:20261005T090000/);
  const before = buildCalendarPackage(settings, new Date(2026, 9, 5, 8, 0));
  assert.match(before.ics, /DTSTART:20261005T090000/);
});

test('mode, fingerprint and legacy settings are handled consistently', () => {
  const one = { ...settings, reminderMode: 'one' };
  assert.equal(buildCalendarPackage({ ...settings, reminderMode: 'off' }), null);
  assert.doesNotMatch(buildCalendarPackage(one, new Date(2026, 9, 1)).ics, /-after@yueban.local/);
  assert.equal(planFingerprint(settings), planFingerprint({ ...settings }));
  assert.notEqual(planFingerprint(settings), planFingerprint({ ...settings, reminderTime: '10:00' }));
  assert.equal(validSettings(settings), true);
});

test('synthetic test file has one event and no personal date content', () => {
  const result = buildTestCalendar(new Date(2026, 9, 8, 8, 0));
  assert.equal((result.ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.match(result.ics, /DTSTART:20261008T081000/);
  assert.doesNotMatch(result.ics, /经期开始|20260908/);
});

test('legacy saved settings survive the new one-reminder default', () => {
  const storage = { getItem: () => JSON.stringify(settings) };
  assert.deepEqual(loadSettingsFrom(storage).settings, settings);
  assert.equal(loadSettingsFrom({ getItem: () => null }).settings.reminderMode, defaultSettings.reminderMode);
});

test('storage write failure is reported instead of claiming persistence', () => {
  const storage = { getItem: () => { throw new Error('disabled'); }, setItem: () => { throw new Error('full'); } };
  assert.equal(loadSettingsFrom(storage).storageAvailable, false);
  assert.equal(writeLocal(storage, 'test', settings), false);
});
