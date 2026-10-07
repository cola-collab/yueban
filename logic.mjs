export const STORAGE_KEY = 'yueban.settings.v1';
export const REMINDER_KEY = 'yueban.reminder.v2';
const DAY = 86400000;

export function parseDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [y, m, d] = value.split('-').map(Number);
  const time = Date.UTC(y, m - 1, d);
  const date = new Date(time);
  return date.getUTCFullYear() === y && date.getUTCMonth() + 1 === m && date.getUTCDate() === d ? time : null;
}
export function formatDateOnly(time) { return new Date(time).toISOString().slice(0, 10); }
export function addDays(value, days) {
  const time = parseDateOnly(value);
  return time === null ? null : formatDateOnly(time + days * DAY);
}
export function todayLocal(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function daysBetween(from, to) {
  const start = parseDateOnly(from), end = parseDateOnly(to);
  return start === null || end === null ? null : Math.round((end - start) / DAY);
}
export function validSettings(input) {
  if (!input || typeof input !== 'object') return false;
  const date = input.lastStart === '' || parseDateOnly(input.lastStart) !== null;
  const cycle = input.cycleLength === null || (Number.isInteger(input.cycleLength) && input.cycleLength >= 15 && input.cycleLength <= 90);
  const period = input.periodLength === null || (Number.isInteger(input.periodLength) && input.periodLength >= 1 && input.periodLength <= 15);
  return date && cycle && period && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.reminderTime) && ['three', 'one', 'off'].includes(input.reminderMode);
}

// Only the user's last supplied start is confirmed. Never treat an estimate as an actual period.
export function nextEstimate(settings, today = todayLocal()) {
  if (!settings.lastStart || !settings.cycleLength) return null;
  const start = addDays(settings.lastStart, settings.cycleLength);
  const daysAway = daysBetween(today, start);
  if (daysAway === null) return null;
  const elapsed = daysBetween(settings.lastStart, today);
  const cycleIndex = Math.max(1, Math.floor(Math.max(0, elapsed) / settings.cycleLength) + 1);
  return { start, daysAway, overdue: daysAway < 0, nextProjection: addDays(settings.lastStart, cycleIndex * settings.cycleLength), cycleIndex };
}
export function currentPhase(settings, today = todayLocal()) {
  if (!settings.lastStart || !settings.cycleLength) return 'general';
  const elapsed = daysBetween(settings.lastStart, today);
  if (elapsed === null || elapsed < 0) return 'general';
  if (settings.periodLength && elapsed < settings.periodLength) return 'during';
  if (settings.periodLength && elapsed < settings.periodLength + 3) return 'after';
  if (elapsed < settings.cycleLength && elapsed >= settings.cycleLength - 5) return 'before';
  return 'general';
}
export function planFingerprint(settings) {
  return JSON.stringify([settings.lastStart, settings.cycleLength, settings.periodLength, settings.reminderTime, settings.reminderMode]);
}
function icsEscape(value) { return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }
function fold(line) {
  const parts = [];
  let row = '';
  for (const char of line) {
    if (new TextEncoder().encode(row + char).length > 70) { parts.push(row); row = ' ' + char; }
    else row += char;
  }
  parts.push(row);
  return parts.join('\r\n');
}
function calendar(lines) { return lines.map(fold).join('\r\n') + '\r\n'; }
function calendarStart() {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Yueban//Quiet Care Calendar//ZH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:月伴提醒'];
}
function localStamp(value) {
  return `${value.getFullYear()}${String(value.getMonth() + 1).padStart(2, '0')}${String(value.getDate()).padStart(2, '0')}T${String(value.getHours()).padStart(2, '0')}${String(value.getMinutes()).padStart(2, '0')}00`;
}
function addEvent(lines, { date, time, uid, description, now }) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const startsAt = new Date(year, month - 1, day, hour, minute);
  if (startsAt <= now) return false;
  const endsAt = new Date(year, month - 1, day, hour, minute + 5);
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  lines.push('BEGIN:VEVENT', `UID:${uid}@yueban.local`, `DTSTAMP:${stamp}`, `DTSTART:${localStamp(startsAt)}`, `DTEND:${localStamp(endsAt)}`, 'SUMMARY:月伴提醒', `DESCRIPTION:${icsEscape(description)}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0M', 'DESCRIPTION:月伴提醒', 'END:VALARM', 'END:VEVENT');
  return true;
}
export function buildCalendarPackage(settings, now = new Date()) {
  if (!validSettings(settings) || !settings.lastStart || !settings.cycleLength || settings.reminderMode === 'off') return null;
  const elapsed = daysBetween(settings.lastStart, todayLocal(now));
  const firstIndex = Math.max(0, Math.floor(Math.max(0, elapsed) / settings.cycleLength));
  const lines = calendarStart();
  let eventCount = 0, through = null;
  // Include remaining events in this cycle and twelve later estimates.
  for (let index = firstIndex; index <= firstIndex + 12; index++) {
    const start = addDays(settings.lastStart, index * settings.cycleLength);
    if (index > 0) {
      eventCount += Number(addEvent(lines, { date: addDays(start, -3), time: settings.reminderTime, uid: `${start.replace(/-/g, '')}-before`, description: '根据上次设置的时间估计，这几天可能快来了。', now }));
      if (settings.reminderMode === 'three') eventCount += Number(addEvent(lines, { date: start, time: settings.reminderTime, uid: `${start.replace(/-/g, '')}-start`, description: '根据上次设置的时间估计，这几天可能会来。', now }));
    }
    if (settings.reminderMode === 'three' && settings.periodLength) {
      eventCount += Number(addEvent(lines, { date: addDays(start, settings.periodLength + 1), time: settings.reminderTime, uid: `${start.replace(/-/g, '')}-after`, description: '如果这次已经结束，可以慢慢回到平时的节奏。', now }));
    }
    if (index > 0) through = start;
  }
  if (!eventCount) return null;
  lines.push('END:VCALENDAR');
  return { ics: calendar(lines), eventCount, through };
}
export function buildCalendar(settings, now = new Date()) { return buildCalendarPackage(settings, now)?.ics ?? null; }
export function buildTestCalendar(now = new Date()) {
  const when = new Date(now.getTime() + 10 * 60 * 1000);
  const date = todayLocal(when);
  const time = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  const lines = calendarStart();
  addEvent(lines, { date, time, uid: `test-${now.getTime()}`, description: '这是不含经期信息的测试日程。请检查日历和锁屏通知。', now });
  lines.push('END:VCALENDAR');
  return { ics: calendar(lines), at: when };
}
