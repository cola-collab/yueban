import { STORAGE_KEY, REMINDER_KEY, todayLocal, addDays, validSettings, nextEstimate, planFingerprint, buildCalendarPackage, buildTestCalendar } from './logic.mjs';
import { CARE, CARE_SOURCES, TOPIC_SOURCES } from './care-data.mjs';
import { defaultSettings, normalizeSettings, loadSettingsFrom, readLocal, writeLocal } from './state.mjs';

const $ = id => document.getElementById(id);
const APP_VERSION = '2026.10.09.4';
const reminderDefaults = { healthSetup: false, healthReceived: false, calendarExportFingerprint: '', calendarImportFingerprint: '', calendarTestReceived: false };
const localStore = (() => { try { return localStorage; } catch { return null; } })();
const loadedSettings = loadSettingsFrom(localStore);
let storageAvailable = loadedSettings.storageAvailable;
let settings = loadedSettings.settings;
let reminder = loadReminder();
let previousForUndo = null;
let undoTimer = null;
let lastTestFile = null;
let activeCareTopic = 'now';
let renderedDay = todayLocal();
let careScrollY = 0;

function readStored(key) {
  const result = readLocal(localStore, key);
  if (!result.ok) storageAvailable = false;
  return result.value;
}
function writeStored(key, value) {
  const saved = writeLocal(localStore, key, value);
  if (!saved) storageAvailable = false;
  return saved;
}
function removeStored(key) {
  try { localStore.removeItem(key); return true; }
  catch { storageAvailable = false; return false; }
}
function loadReminder() {
  try {
    const value = JSON.parse(readStored(REMINDER_KEY));
    if (!value || typeof value !== 'object') return { ...reminderDefaults };
    return {
      healthSetup: value.healthSetup === true,
      healthReceived: value.healthReceived === true,
      calendarExportFingerprint: typeof value.calendarExportFingerprint === 'string' ? value.calendarExportFingerprint : '',
      calendarImportFingerprint: typeof value.calendarImportFingerprint === 'string' ? value.calendarImportFingerprint : '',
      calendarTestReceived: value.calendarTestReceived === true
    };
  } catch { return { ...reminderDefaults }; }
}
function persistReminder() {
  if (!writeStored(REMINDER_KEY, reminder)) showToast('浏览器未能保存状态；关闭页面后可能丢失。');
}
function saveSettings(value) {
  const changed = planFingerprint(settings) !== planFingerprint(value);
  settings = normalizeSettings(value);
  const saved = writeStored(STORAGE_KEY, settings);
  render();
  return { changed, saved };
}
function showToast(message, undo = false) {
  const toast = $('toast');
  toast.replaceChildren(document.createTextNode(message));
  if (undo) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-undo';
    button.textContent = '撤销';
    button.addEventListener('click', () => {
      if (previousForUndo) saveSettings(previousForUndo);
      previousForUndo = null;
      toast.hidden = true;
      showToast('已撤销日期调整');
    });
    toast.append(button);
  }
  toast.hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { toast.hidden = true; previousForUndo = null; }, 12000);
}
function viewFromHash() {
  const view = location.hash.slice(1);
  return ['home', 'care', 'settings', 'reminder'].includes(view) ? view : 'home';
}
function showView(view, push = true) {
  if (view === 'settings' && !$('settingsView').hidden) return;
  if (!$('settingsView').hidden && view !== 'settings' && planFingerprint(readDateForm()) !== planFingerprint(settings)) {
    if (!window.confirm('当前修改尚未保存。离开设置后，日历仍会使用上次保存的内容。确定离开吗？')) {
      if (!push) history.pushState({ view: 'settings' }, '', '#settings');
      return;
    }
  }
  if (!$('reminderView').hidden && view !== 'reminder' && planFingerprint(readCalendarForm()) !== planFingerprint(settings)) {
    if (!window.confirm('日历选项尚未保存。确定离开吗？')) {
      if (!push) history.pushState({ view: 'reminder' }, '', '#reminder');
      return;
    }
  }
  if (!$('careView').hidden && view !== 'care') careScrollY = window.scrollY;
  for (const name of ['home', 'care', 'settings', 'reminder']) $(`${name}View`).hidden = name !== view;
  $('settingsOpen').hidden = view === 'settings';
  if (view === 'settings' || view === 'reminder') fillForm();
  if (push && viewFromHash() !== view) history.pushState({ view }, '', view === 'home' ? location.pathname + location.search : `#${view}`);
  window.scrollTo(0, view === 'care' ? careScrollY : 0);
  $(view === 'home' ? 'homeTitle' : view === 'care' ? 'carePageTitle' : view === 'settings' ? 'settingsTitle' : 'reminderTitle').focus({ preventScroll: true });
}
function renderCare(topic = 'now') {
  activeCareTopic = topic;
  const item = CARE[topic] || CARE.now;
  document.querySelectorAll('[data-care]').forEach(button => {
    const selected = button.dataset.care === topic;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-current', selected ? 'true' : 'false');
  });
  const content = $('careContent');
  content.replaceChildren();
  const title = document.createElement('h2'); title.textContent = item.title;
  const quickTitle = document.createElement('p'); quickTitle.className = 'quick-label'; quickTitle.textContent = '先看这里';
  const quick = document.createElement('ol'); quick.className = 'quick-list';
  for (const step of item.quick) { const li = document.createElement('li'); li.textContent = step; quick.append(li); }
  content.append(title, quickTitle, quick);
  for (const [heading, body] of item.blocks) {
    const details = document.createElement('details'); details.className = 'care-detail';
    const summary = document.createElement('summary'); summary.textContent = heading;
    const paragraph = document.createElement('p'); paragraph.textContent = body;
    details.append(summary, paragraph); content.append(details);
  }
  if (topic === 'medicine') {
    const warning = document.createElement('p'); warning.className = 'callout';
    warning.textContent = '有过敏、胃溃疡或出血、肾病、怀孕可能，或正在服用其他药物时，先问医生或药师；不要自行叠加同类止痛药。';
    content.append(warning);
  }
  const refs = document.createElement('p'); refs.className = 'topic-sources'; refs.append('资料：');
  for (const key of TOPIC_SOURCES[topic] || []) {
    const [label, url] = CARE_SOURCES[key];
    const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = label;
    refs.append(' ', link);
  }
  content.append(refs);
}
function niceDate(value) {
  const [year, month, day] = value.split('-');
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
}
function render() {
  const today = todayLocal();
  renderedDay = today;
  const estimate = nextEstimate(settings, today);
  $('cycleCard').classList.toggle('is-empty', !estimate);
  $('cycleCard').classList.toggle('is-overdue', !!estimate?.overdue);
  $('daysNumber').hidden = !estimate;
  $('cycleCardBottom').hidden = !estimate;
  $('estimateBadge').hidden = !estimate;
  $('chooseStart').hidden = !settings.lastStart;
  if (estimate) {
    const [, month, day] = estimate.start.split('-');
    $('homeTitle').textContent = estimate.overdue ? '上次预计日期' : '下次预计';
    $('daysNumber').textContent = `${Number(month)} 月 ${Number(day)} 日`;
    $('daysUnit').textContent = estimate.overdue ? '实际日期待确认' : '预计日期，仅供参考';
    $('estimateDate').textContent = estimate.overdue ? '预计日期已过 · 可以调整实际开始日期' : estimate.daysAway === 0 ? '预计今天' : `约 ${estimate.daysAway} 天后`;
    $('setupFromCard').textContent = '调整参考日期';
    $('confidenceNote').hidden = estimate.overdue || estimate.cycleIndex <= 2;
    $('confidenceNote').textContent = estimate.overdue ? '这个日期只是旧设置的推算。月伴不会把未确认的预测当作实际经期。' : '较长时间没有校准，估算可能已经偏移。';
  } else {
    $('homeTitle').textContent = '下次预计';
    $('daysUnit').textContent = settings.lastStart ? '补充通常间隔后查看预计时间' : '设置参考日期后查看预计时间';
    $('setupFromCard').textContent = '设置参考日期';
    $('confidenceNote').hidden = true;
  }
  const fingerprint = planFingerprint(settings);
  const exported = !!reminder.calendarExportFingerprint;
  const stale = exported && reminder.calendarExportFingerprint !== fingerprint;
  $('importReminder').hidden = !stale;
  $('importReminder').textContent = '月伴设置已变化；若导入过旧日历，请在 iPhone 日历中删除旧事件后再导出。';
  $('reminderSummary').textContent = reminder.healthReceived ? '你已确认收到过系统通知' : reminder.healthSetup ? '你已标记完成健康 App 设置' : '在“健康”App 中开启月经通知';
  $('healthStatus').textContent = reminder.healthReceived ? '你已确认收到过系统通知。月伴无法自行核验或同步“健康”App 状态。' : reminder.healthSetup ? '你已标记设置完成；待系统通知实际出现时再确认。' : '尚未标记完成。请先在自己的 iPhone 上设置。';
  $('healthSteps').open = !reminder.healthSetup;
  $('healthSetupConfirm').textContent = reminder.healthSetup ? '撤销“已开启”标记' : '我已在健康 App 开启';
  $('healthReceivedConfirm').textContent = reminder.healthReceived ? '撤销“已收到”标记' : '我确实收到过系统通知';
  const calendar = buildCalendarPackage(settings);
  $('calendarCoverage').textContent = calendar ? `将生成 ${calendar.eventCount} 条估算日程，最后一个预计周期开始于 ${niceDate(calendar.through)}。越久不校准，日期越可能偏移。` : '填入最近实际开始日期与通常周期后，才可生成日历备选。';
  $('calendarImportedConfirm').disabled = !exported || stale;
  $('calendarReceivedConfirm').disabled = !lastTestFile && (!reminder.calendarImportFingerprint || stale);
  $('calendarStatus').textContent = stale ? '设置已更改；以前导入的日历不会自动更新。' : reminder.calendarTestReceived ? '你已确认收到过测试通知。个人日历事件仍需分别核对。' : reminder.calendarImportFingerprint === fingerprint ? '你已确认在日历中看到事件；请继续核对提醒是否真的送达。' : reminder.calendarExportFingerprint === fingerprint ? '文件已生成；月伴无法确认是否导入，请到 iPhone 日历检查。' : '日历为备选。导出文件不会自动启用通知。';
  $('appVersion').textContent = APP_VERSION;
  if (!storageAvailable) $('storageWarning').hidden = false;
}
function fillForm() {
  $('lastStart').value = settings.lastStart;
  $('cycleLength').value = settings.cycleLength ?? '';
  $('periodLength').value = settings.periodLength ?? '';
  document.querySelector('.optional-field').open = settings.periodLength !== null;
  $('reminderTime').value = settings.reminderTime;
  document.querySelector(`input[name="reminderMode"][value="${settings.reminderMode}"]`).checked = true;
}
function readDateForm() {
  return { ...settings,
    lastStart: $('lastStart').value,
    cycleLength: $('cycleLength').value === '' ? null : Number($('cycleLength').value),
    periodLength: $('periodLength').value === '' ? null : Number($('periodLength').value)
  };
}
function readCalendarForm() {
  return { ...settings,
    reminderTime: $('reminderTime').value,
    reminderMode: document.querySelector('input[name="reminderMode"]:checked').value
  };
}
function clearDateErrors() {
  for (const id of ['lastStart', 'cycleLength', 'periodLength']) {
    $(`${id}Error`).hidden = true;
    $(`${id}Error`).textContent = '';
    $(id).removeAttribute('aria-invalid');
  }
}
function showDateError(id, message) {
  $(`${id}Error`).textContent = message;
  $(`${id}Error`).hidden = false;
  $(id).setAttribute('aria-invalid', 'true');
  $(id).focus();
}
function download(content, filename, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function calibrate(date) {
  if (!date || date > todayLocal() || !validSettings({ ...settings, lastStart: date })) { showToast('请选择今天或之前的有效日期'); return; }
  if (settings.lastStart === date) { showToast('这个日期已经保存'); return; }
  previousForUndo = { ...settings };
  const result = saveSettings({ ...settings, lastStart: date });
  $('calibrateForm').hidden = true;
  showToast(result.saved ? '已更新月伴估算；也请按需检查“健康”App 中的日期。' : '已暂时更新；浏览器未能保存，关闭页面后可能丢失。', true);
}

$('settingsOpen').addEventListener('click', () => { if ($('settingsView').hidden) showView('settings'); });
$('setupFromCard').addEventListener('click', () => showView('settings'));
$('settingsReminderOpen').addEventListener('click', () => showView('reminder'));
$('reminderOpen').addEventListener('click', () => showView('reminder'));
$('helpOpen').addEventListener('click', () => { renderCare(activeCareTopic); showView('care'); });
for (const view of ['settings', 'care', 'reminder']) $(`${view}Back`).addEventListener('click', () => showView('home'));
window.addEventListener('popstate', () => showView(viewFromHash(), false));
document.querySelectorAll('[data-care]').forEach(button => button.addEventListener('click', () => renderCare(button.dataset.care)));
$('chooseStart').addEventListener('click', () => { $('calibrateDate').max = todayLocal(); $('calibrateDate').value = settings.lastStart || todayLocal(); $('calibrateForm').hidden = false; $('chooseToday').focus(); });
$('chooseToday').addEventListener('click', () => calibrate(todayLocal()));
$('chooseYesterday').addEventListener('click', () => calibrate(addDays(todayLocal(), -1)));
$('cancelCalibrate').addEventListener('click', () => { $('calibrateForm').hidden = true; });
$('calibrateForm').addEventListener('submit', event => { event.preventDefault(); calibrate($('calibrateDate').value); });
$('settingsForm').addEventListener('submit', event => {
  event.preventDefault();
  clearDateErrors();
  const value = readDateForm();
  if (value.lastStart && (value.lastStart > todayLocal() || !validSettings({ ...value, cycleLength: null, periodLength: null }))) { showDateError('lastStart', '请选择今天或之前的有效日期'); return; }
  if (value.cycleLength !== null && (!Number.isInteger(value.cycleLength) || value.cycleLength < 15 || value.cycleLength > 90)) { showDateError('cycleLength', '请输入 15–90 之间的天数'); return; }
  if (value.periodLength !== null && (!Number.isInteger(value.periodLength) || value.periodLength < 1 || value.periodLength > 15)) { document.querySelector('.optional-field').open = true; showDateError('periodLength', '请输入 1–15 之间的天数'); return; }
  const result = saveSettings(value);
  showView('home');
  showToast(result.saved ? result.changed ? '设置已保存；请单独检查“健康”App 的信息。' : '设置没有变化。' : '本次设置仅在当前页面有效；浏览器未能保存。');
});
$('calendarPreferencesForm').addEventListener('submit', event => {
  event.preventDefault();
  const value = readCalendarForm();
  if (!validSettings(value)) { showToast('请检查日历提醒时间'); return; }
  const result = saveSettings(value);
  showToast(result.saved ? result.changed ? '日历选项已保存' : '日历选项没有变化' : '浏览器未能保存日历选项');
});
$('healthSetupConfirm').addEventListener('click', () => {
  reminder.healthSetup = !reminder.healthSetup;
  if (!reminder.healthSetup) reminder.healthReceived = false;
  persistReminder(); render();
});
$('healthReceivedConfirm').addEventListener('click', () => {
  reminder.healthReceived = !reminder.healthReceived;
  if (reminder.healthReceived) reminder.healthSetup = true;
  persistReminder(); render();
});
$('downloadCalendar').addEventListener('click', () => {
  if (planFingerprint(readCalendarForm()) !== planFingerprint(settings)) { showToast('请先保存上方日历选项'); return; }
  const packageData = buildCalendarPackage(settings);
  if (!packageData) { showToast('请先填写实际开始日期与通常周期，并开启日历备选'); return; }
  download(packageData.ics, '月伴-预计日历.ics', 'text/calendar;charset=utf-8');
  reminder.calendarExportFingerprint = planFingerprint(settings);
  reminder.calendarImportFingerprint = '';
  reminder.calendarTestReceived = false;
  persistReminder(); render();
  $('calendarStatus').textContent = '文件已生成。请在 iPhone 日历中导入；下载本身不会开启提醒。';
});
$('testCalendar').addEventListener('click', () => {
  const test = buildTestCalendar();
  lastTestFile = new File([test.ics], '月伴-测试日程.ics', { type: 'text/calendar' });
  download(test.ics, lastTestFile.name, 'text/calendar;charset=utf-8');
  $('calendarReceivedConfirm').disabled = false;
  $('shareTest').hidden = !navigator.canShare?.({ files: [lastTestFile] });
  $('calendarStatus').textContent = '测试文件已生成。请在日历中确认事件和提醒，再锁屏等约 10 分钟；同一文件可分享给另一台手机对照。';
});
$('shareTest').addEventListener('click', async () => {
  if (!lastTestFile || !navigator.canShare?.({ files: [lastTestFile] })) return;
  try { await navigator.share({ files: [lastTestFile], title: '月伴测试日程' }); }
  catch (error) { if (error.name !== 'AbortError') showToast('系统未能分享该文件，请从“文件”App 分享已下载的测试文件'); }
});
$('calendarImportedConfirm').addEventListener('click', () => {
  if ($('calendarImportedConfirm').disabled) return;
  reminder.calendarImportFingerprint = planFingerprint(settings);
  persistReminder(); render();
});
$('calendarReceivedConfirm').addEventListener('click', () => {
  if ($('calendarReceivedConfirm').disabled) return;
  reminder.calendarTestReceived = !reminder.calendarTestReceived;
  persistReminder(); render();
});
$('exportSettings').addEventListener('click', () => {
  download(JSON.stringify({ schemaVersion: 1, settings }, null, 2), '月伴-设置备份.json', 'application/json');
  showToast('备份已下载，请妥善保存');
});
$('importSettings').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 65536) throw new Error('too large');
    const backup = JSON.parse(await file.text());
    if (backup.schemaVersion !== 1 || !validSettings(backup.settings) || (backup.settings.lastStart && backup.settings.lastStart > todayLocal())) throw new Error('invalid');
    if (!window.confirm('导入会替换这台设备上的月伴设置。继续吗？')) return;
    const result = saveSettings(backup.settings);
    fillForm();
    showToast(result.saved ? '月伴设置已恢复；请单独检查“健康”App 和旧日历。' : '设置已临时恢复；浏览器未能保存。');
  } catch { showToast('备份格式不正确，未更改现有设置'); }
  finally { event.target.value = ''; }
});
$('deleteSettings').addEventListener('click', () => {
  if (!window.confirm('清除本机月伴设置和确认状态？“健康”App 与已导入日历需分别管理。')) return;
  const cleared = [STORAGE_KEY, REMINDER_KEY, 'yueban.calendar.exported', 'yueban.calendar.outdated'].map(removeStored).every(Boolean);
  if (!cleared) { showToast('浏览器未能清除全部数据，请检查存储权限'); return; }
  settings = { ...defaultSettings }; reminder = { ...reminderDefaults };
  fillForm(); render(); showView('home'); showToast('本机月伴数据已清除');
});

renderCare(); render();
showView(viewFromHash(), false);
function refreshDayIfNeeded() { if (todayLocal() !== renderedDay) render(); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDayIfNeeded(); });
window.addEventListener('pageshow', refreshDayIfNeeded);
setInterval(refreshDayIfNeeded, 60000);
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
$('reloadUpdate').addEventListener('click', () => {
  const dateDirty = !$('settingsView').hidden && planFingerprint(readDateForm()) !== planFingerprint(settings);
  const calendarDirty = !$('reminderView').hidden && planFingerprint(readCalendarForm()) !== planFingerprint(settings);
  if ((dateDirty || calendarDirty) && !window.confirm('还有未保存的修改，刷新会丢失这些输入。确定刷新吗？')) return;
  location.reload();
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'YUEBAN_VERSION') $('updateBanner').hidden = event.data.version === APP_VERSION;
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    navigator.serviceWorker.controller?.postMessage({ type: 'VERSION' });
  });
}
