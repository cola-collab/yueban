import { STORAGE_KEY, validSettings } from './logic.mjs';

export const defaultSettings = { lastStart: '', cycleLength: null, periodLength: null, reminderTime: '09:00', reminderMode: 'one' };

export function normalizeSettings(value) {
  return { lastStart: value.lastStart, cycleLength: value.cycleLength, periodLength: value.periodLength, reminderTime: value.reminderTime, reminderMode: value.reminderMode };
}

export function readLocal(storage, key) {
  try { return { ok: true, value: storage.getItem(key) }; }
  catch { return { ok: false, value: null }; }
}

export function writeLocal(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

export function loadSettingsFrom(storage) {
  const result = readLocal(storage, STORAGE_KEY);
  try {
    const value = JSON.parse(result.value);
    return { settings: validSettings(value) ? normalizeSettings(value) : { ...defaultSettings }, storageAvailable: result.ok };
  } catch { return { settings: { ...defaultSettings }, storageAvailable: result.ok }; }
}
