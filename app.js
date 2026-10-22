import { createApi, isOffline } from './api.js';

const VERSION = '0.7.3';

// ---------- Утилиты ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = v => JSON.parse(JSON.stringify(v));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dm = s => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}` : '');
const dmy = s => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '');
const todayDm = () => { const d = new Date(); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`; };
const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
const firstLine = s => lines(s)[0] || '';
const fmtPct = v => (v === null || v === undefined || v === '' ? '—' : `${Math.round(v * 10) / 10}%`);
const hash = (...parts) => '#/' + parts.map(p => encodeURIComponent(p)).join('/');

const store = {
  get(k, def) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* хранилище недоступно */ }
  },
  del(k) {
    try { localStorage.removeItem(k); } catch (e) { /* хранилище недоступно */ }
  },
  keys(prefix) {
    try { return Object.keys(localStorage).filter(k => k.startsWith(prefix)); } catch (e) { return []; }
  },
};

/** Черновики демо-режима хранятся отдельно, чтобы никогда не уйти в настоящую таблицу. */
const draftPrefix = () => (state.cfg.url === 'demo' ? 'demo-draft:' : 'draft:');

const STATUS_CLASS = {
  'Выполнено': 'ok', 'В работе': 'work', 'Впереди': 'next',
  'Приостановлено': 'stop', 'Отменено': 'stop', 'Не назначен': 'none',
};
const FIELDS = ['object', 'stage', 'readiness', 'photo', 'done', 'status', 'contractor', 'volume', 'plan', 'comment'];

// ---------- Состояние ----------

const state = {
  cfg: store.get('cfg', { url: '', key: '' }),
  dirs: store.get('cache:dirs', null),
  settings: store.get('cache:settings', null),
  weeks: store.get('cache:weeks', null),
  week: null,     // неделя, как её вернула таблица
  draft: null,    // правки: {rows, summary, baseVersion, dirty, savedAt}
  offline: false,
  history: store.get('cache:history', null),   // заполненные недели для истории объектов
  historyFresh: false,                          // обновлялась ли история в этом запуске
  filters: { period: '3m', status: '', contractor: '', ...store.get('filters', {}) },
};

const api = createApi(() => state.cfg);

/** Запрос с запасным ответом из кэша, если нет связи. */
async function cached(cacheKey, action, params) {
  try {
    const data = await api(action, params);
    store.set(cacheKey, data);
    return { data, offline: false };
  } catch (e) {
    const data = isOffline(e) ? store.get(cacheKey, null) : null;
    if (data) return { data, offline: true };
    throw e;
  }
}

async function loadDirs(force) {
  if (state.dirs && !force) return state.dirs;
  state.dirs = (await cached('cache:dirs', 'getDirectories')).data;
  return state.dirs;
}

// ---------- Маршруты ----------

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return parts.length ? parts : ['weeks'];
}

function go(...parts) {
  const h = hash(...parts);
  if (location.hash === h) render(); else location.hash = h;
}

let renderSeq = 0;

async function render() {
  const seq = ++renderSeq;
  const [page, a, b, c] = route();
  $('#modal').hidden = true;
  setTabs(page);
  try {
    if (!state.cfg.url) return renderSetup();
    if (page === 'weeks') return await renderWeeks(seq);
    if (page === 'week') {
      await Promise.all([loadDirs(), loadWeek(a)]);
      if (seq !== renderSeq) return;
      if (b === 'row') return renderRow(Number(c));
      if (b === 'summary') return renderSummary();
      return renderWeek();
    }
    if (page === 'objects') return await renderObjects(seq);
    if (page === 'object') return await renderObject(a, seq);
    if (page === 'month') return await renderMonth(a, seq);
    if (page === 'dirs') return await renderDirs(a === 'contractors' ? 'contractors' : 'objects', seq);
    if (page === 'settings') return await renderSettings(seq);
    go('weeks');
  } catch (e) {
    if (seq !== renderSeq) return;
    $('#view').innerHTML = `<div class="empty"><p>${esc(e.message)}</p><button class="btn" data-act="retry">Повторить</button></div>`;
  } finally {
    if (seq === renderSeq) renderSaveBar();
  }
}

function setTabs(page) {
  const top = ['weeks', 'objects', 'dirs', 'settings'].includes(page) && state.cfg.url;
  $('#tabs').hidden = !top;
  $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === page));
}

function setBar({ title, sub = '', back = '', right = '' }) {
  $('#bar').innerHTML = `
    ${back ? `<a class="bar-btn" href="${back}" aria-label="Назад">‹</a>` : '<span></span>'}
    <div class="bar-title"><div>${esc(title)}</div>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
    <div class="bar-right">${right}</div>`;
}

const loading = () => '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';

// ---------- Недели ----------

async function renderWeeks(seq) {
  setBar({ title: 'Отчёты', sub: state.cfg.url === 'demo' ? 'демо-режим' : '' });
  const view = $('#view');
  view.innerHTML = state.weeks ? weeksHtml(state.weeks, false) : loading();
  const { data, offline } = await cached('cache:weeks', 'listWeeks');
  if (seq !== renderSeq) return;
  state.weeks = data;
  view.innerHTML = weeksHtml(data, offline);
  if (!offline) prefetch(data);
}

function weeksHtml(weeks, offline) {
  const today = ymd(new Date());
  const current = weeks.find(w => w.start <= today && today <= w.end);
  const drafts = new Set(store.keys(draftPrefix()).map(k => k.slice(draftPrefix().length)));
  const shown = weeks.filter(w => w.objectsCount > 0 || w === current || drafts.has(w.sheetName)).reverse();
  const empty = weeks.filter(w => !shown.includes(w));
  const item = w => `
    <a class="item ${w === current ? 'current' : ''}" href="${hash('week', w.sheetName)}">
      <div><b>${esc(w.sheetName)}</b><small>Неделя ${w.weekNumber} · ${dm(w.start)}–${dm(w.end)}${w === current ? ' · текущая' : ''}</small></div>
      ${drafts.has(w.sheetName) ? '<span class="pill draft">черновик</span>' : ''}
      <span class="pill">${w.objectsCount} об.</span><span class="chev">›</span>
    </a>`;
  const conflicts = [...drafts].filter(n => (store.get(draftPrefix() + n, {}) || {}).conflict);
  return `
    ${offline ? '<div class="banner">Нет связи — показан сохранённый список. Правки сохранятся на телефоне.</div>' : ''}
    ${drafts.size ? `<div class="banner">
      Не отправлено в таблицу: ${[...drafts].map(esc).join(', ')}${conflicts.length ? `<br>Лист изменили в таблице: ${conflicts.map(esc).join(', ')} — откройте неделю и выберите версию` : ''}
      <button class="btn small" data-act="sync-drafts" style="margin-top:8px; width:100%">Отправить сейчас</button></div>` : ''}
    <button class="btn primary block" data-act="open-current">Открыть текущую неделю</button>
    <h2>Отчёты</h2>
    <div class="list">${shown.map(item).join('') || '<div class="empty">Пока пусто</div>'}</div>
    ${empty.length ? `<details class="more"><summary>Пустые заготовки (${empty.length})</summary><div class="list">${empty.map(item).join('')}</div></details>` : ''}`;
}

// ---------- Неделя ----------

/** Неделя из памяти телефона открывается сразу, свежая версия из таблицы подтягивается в фоне. */
async function loadWeek(name) {
  if (state.week && state.week.sheetName === name) return;
  const saved = store.get('cache:week:' + name, null);
  if (saved) {
    setWeek(saved);
    refreshWeek(name);
    return;
  }
  setBar({ title: name, back: '#/weeks' });
  $('#view').innerHTML = loading();
  const { data, offline } = await cached('cache:week:' + name, 'getWeek', { sheetName: name });
  setWeek(data, offline);
}

async function refreshWeek(name) {
  state.refreshing = name;
  try {
    const fresh = await api('getWeek', { sheetName: name });
    store.set('cache:week:' + name, fresh);
    if (!state.week || state.week.sheetName !== name) return;
    // Черновик не трогаем: если лист за это время изменили, сохранение покажет конфликт.
    if (!state.draft.dirty) setWeek(fresh);
    else state.week.previous = fresh.previous || state.week.previous;
    state.offline = false;
  } catch (e) {
    if (isOffline(e) && state.week && state.week.sheetName === name) state.offline = true;
  } finally {
    state.refreshing = null;
    // Перерисовываем только обзор недели — открытая карточка объекта не дёргается под пальцами.
    const [page, n, sub] = route();
    if (page === 'week' && n === name && !sub) render();
  }
}

/** Неделя с сервера + несохранённый черновик, если он есть. */
function setWeek(week, offline = false) {
  if (!week.previous && state.week && state.week.sheetName === week.sheetName) week.previous = state.week.previous;
  state.week = week;
  state.offline = offline;
  store.set('cache:week:' + week.sheetName, week);
  const saved = store.get(draftPrefix() + week.sheetName, null);
  state.draft = saved
    ? { ...saved, dirty: true }
    : { rows: week.rows.map(pickRow), summary: week.summary, baseVersion: week.version, dirty: false };
}

function pickRow(r) {
  const out = {};
  FIELDS.forEach(f => { out[f] = r[f] ?? (f === 'readiness' ? null : ''); });
  out.photo = r.photo && typeof r.photo === 'object' ? clone(r.photo) : { text: String(r.photo || ''), links: [] };
  return out;
}

const emptyRow = () => pickRow({ readiness: null });

function prevRow(object) {
  const prev = state.week && state.week.previous;
  return (object && prev && prev.rows.find(r => r.object === object)) || null;
}

function delta(r) {
  const p = prevRow(r.object);
  if (!p || p.readiness === null || r.readiness === null || r.readiness === undefined) return '';
  const d = Math.round((r.readiness - p.readiness) * 10) / 10;
  if (!d) return '<em>±0</em>';
  return `<em class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d}</em>`;
}

/** Те же правила, что у формул листа: COUNTA по объектам, AVERAGE по готовности, COUNTIF по статусам. */
/** «Не назначен», «Не требуется» и «Отменено» не считаются в работе и не входят в среднюю — как формулы листа. */
const NOT_ACTIVE = ['Не назначен', 'Не требуется', 'Отменено'];

function stats(rows) {
  const active = rows.filter(r => !NOT_ACTIVE.includes(r.status));
  const nums = active.map(r => r.readiness).filter(v => v !== null && v !== '' && v !== undefined);
  const counts = {};
  rows.forEach(r => { if (r.status) counts[r.status] = (counts[r.status] || 0) + 1; });
  return {
    count: active.filter(r => r.object).length,
    avg: nums.length ? nums.reduce((a, b) => a + Number(b), 0) / nums.length : 0,
    counts,
  };
}

function renderWeek() {
  const w = state.week;
  const d = state.draft;
  setBar({
    title: w.sheetName, sub: `Неделя ${w.weekNumber} · ${dm(w.start)}–${dm(w.end)}${state.refreshing === w.sheetName ? ' · обновляю…' : ''}`, back: '#/weeks',
    right: d.rows.length ? '<button class="bar-btn text" data-act="pdf">PDF</button>' : '',
  });
  const s = stats(d.rows);
  const order = (state.dirs && state.dirs.statuses) || Object.keys(s.counts);
  const chips = order.filter(st => s.counts[st]).map(st => `<span class="status ${STATUS_CLASS[st] || ''}">${esc(st)}: ${s.counts[st]}</span>`).join('');
  const prev = w.previous;
  $('#view').innerHTML = `
    ${state.offline ? '<div class="banner">Нет связи — показана сохранённая версия. Правки останутся черновиком.</div>' : ''}
    <div class="stats">
      <div><b>${s.count}</b><small>в работе</small></div>
      <div><b>${fmtPct(Math.round(s.avg * 10) / 10)}</b><small>ср. готовность</small></div>
      <div><b>${w.formedDate ? dm(w.formedDate) : '—'}</b><small>сформирован</small></div>
    </div>
    <div class="chips">${chips}</div>
    ${d.rows.length ? '' : `
      <div class="empty">
        <p>В этой неделе пока нет объектов.</p>
        ${prev ? `<button class="btn primary" data-act="carry">Перенести объекты с недели «${esc(prev.sheetName)}»</button>` : ''}
      </div>`}
    <div class="cards">${d.rows.map((r, i) => cardHtml(r, i)).join('')}</div>
    <button class="btn block" data-act="add-row">+ Объект</button>
    <h2>Итог недели</h2>
    <a class="list item" href="${hash('week', w.sheetName, 'summary')}">
      <div><b>${esc(firstLine(d.summary) || 'Не заполнен')}</b>${lines(d.summary).length > 1 ? `<small>ещё ${lines(d.summary).length - 1} стр.</small>` : ''}</div>
      <span class="chev">›</span>
    </a>`;
}

function cardHtml(r, i) {
  return `
    <a class="card" href="${hash('week', state.week.sheetName, 'row', i)}">
      <div class="card-top"><b>${esc(r.object || 'Объект не выбран')}</b><span class="status ${STATUS_CLASS[r.status] || ''}">${esc(r.status || 'без статуса')}</span></div>
      <div class="card-mid"><div class="progress"><i style="width:${Number(r.readiness) || 0}%"></i></div><span>${fmtPct(r.readiness)} ${delta(r)}</span></div>
      <div class="card-sub">${esc([firstLine(r.stage), r.contractor].filter(Boolean).join(' · ') || '—')}</div>
    </a>`;
}

// ---------- Объект ----------

function currentRow() {
  const [page, , b, c] = route();
  return page === 'week' && b === 'row' && state.draft ? state.draft.rows[Number(c)] : null;
}

function options(list, value, hidden = [], used = []) {
  const vals = list.filter(v => !hidden.includes(v) || v === value);
  if (value && !vals.includes(value)) vals.push(value);
  return `<option value="">—</option>` + vals.map(v =>
    `<option ${v === value ? 'selected' : ''} ${used.includes(v) && v !== value ? 'disabled' : ''}>${esc(v)}</option>`).join('');
}

function renderRow(i) {
  const w = state.week;
  const r = state.draft.rows[i];
  if (!r) return go('week', w.sheetName);
  const dirs = state.dirs;
  const used = state.draft.rows.map(x => x.object);
  const prev = prevRow(r.object);
  setBar({
    title: r.object || 'Новый объект', sub: w.sheetName, back: hash('week', w.sheetName),
    right: `<button class="bar-btn text" data-act="del-row">Удалить</button>`,
  });
  $('#view').innerHTML = `
    <div class="field"><label>Объект</label>
      <select data-f="object">${options(dirs.objects, r.object, dirs.hidden.objects, used)}</select></div>
    <div class="field"><label>Статус</label>
      <select data-f="status">${options(dirs.statuses, r.status)}</select>
      ${prev && prev.status ? `<small class="hint">Прошлая неделя: ${esc(prev.status)}</small>` : ''}</div>
    <div class="field"><label>Подрядчик / ответственный</label>
      <select data-f="contractor">${options(dirs.contractors, r.contractor, dirs.hidden.contractors)}</select></div>
    <div class="field"><label>Готовность</label>
      <div class="range">
        <input type="range" min="0" max="100" step="5" data-f="readiness" value="${r.readiness ?? 0}">
        <input type="number" min="0" max="100" inputmode="decimal" data-f="readiness" value="${r.readiness ?? ''}">
      </div>
      <small class="hint" id="delta">${prev ? `Прошлая неделя: ${fmtPct(prev.readiness)} ${delta(r)}` : ''}</small></div>
    <div class="field"><label>Текущий этап</label>
      <textarea data-f="stage" rows="1">${esc(r.stage)}</textarea>${prevHtml('stage')}</div>
    <div class="field"><span class="label">Выполнено на этой неделе</span>
      ${listEditor('done', r.done)}
      ${prev && lines(prev.plan).length ? `<button class="btn small" data-act="take-plan">↓ Взять план прошлой недели (${lines(prev.plan).length})</button>` : ''}</div>
    <div class="field"><label>Объём / ед.</label>
      <textarea data-f="volume" rows="1" placeholder="лента 90 п.м.">${esc(r.volume)}</textarea>${prevHtml('volume')}</div>
    <div class="field"><span class="label">План на следующую неделю</span>
      ${listEditor('plan', r.plan)}${prevHtml('plan')}</div>
    <div class="field"><label>Комментарий</label>
      <textarea data-f="comment" rows="2">${esc(r.comment)}</textarea>${prevHtml('comment')}
      <button class="btn small" data-act="comment-date" style="margin-top:8px">+ Запись от ${todayDm()}</button></div>
    <div class="field" id="photo">${photoHtml(r)}</div>
    ${r.object ? `<a class="list item" href="${hash('object', r.object)}"><div><b>История объекта</b><small>график готовности и все недели</small></div><span class="chev">›</span></a>` : ''}`;
  $$('#view textarea').forEach(grow);
  // Подсказкам нужна история объектов; если её ещё нет на телефоне — подгрузить в фоне.
  if (!state.history) {
    refreshHistory().then(() => {
      if (route()[2] !== 'row') return;
      refreshSugg();
      refreshPrev();
    }).catch(() => { /* без подсказок */ });
  }
}

function listEditor(name, text) {
  const items = lines(text);
  return `<div class="list-ed" data-list="${name}">
    ${items.map((t, k) => `<div class="li"><textarea rows="1" data-li="${k}">${esc(t)}</textarea><button class="btn ghost" data-act="li-del" data-k="${k}" aria-label="Удалить пункт">×</button></div>`).join('')}
    <div class="li"><textarea rows="1" data-li-new placeholder="Новый пункт…"></textarea><button class="btn" data-act="li-add" aria-label="Добавить пункт">+</button></div>
    ${suggHtml(name)}
  </div>`;
}

/** Пункты, которые уже встречались у объекта в «Выполнено» и «Плане»; частые — первыми. */
function suggestions(field, typed) {
  const row = currentRow();
  if (!row || !row.object || !state.history) return [];
  const freq = new Map();
  state.history.forEach(w => w.rows.forEach(r => {
    if (r.object !== row.object) return;
    [...lines(r.done), ...lines(r.plan)].forEach(t => {
      const item = t.replace(/\s+/g, ' ');
      if (item.length < 3) return;
      // Пункты из того же поля весят больше: «Выполнено» подсказывает выполненное, «План» — планы.
      freq.set(item, (freq.get(item) || 0) + (lines(r[field]).includes(t) ? 2 : 1));
    });
  }));
  const have = new Set(lines(row[field]).map(s => s.toLowerCase()));
  const q = String(typed || '').trim().toLowerCase();
  return [...freq]
    .filter(([k]) => !have.has(k.toLowerCase()) && (!q || k.toLowerCase().includes(q)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k]) => k);
}

function suggHtml(name, typed) {
  const items = suggestions(name, typed);
  return `<div class="sugg" data-sugg="${name}">${items.map(t =>
    `<button class="chip" data-act="sugg-add" data-v="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div>`;
}

/** Запись объекта за последнюю неделю перед открытой — из истории на телефоне. */
function prevEntry() {
  const row = currentRow();
  if (!row || !row.object || !state.history || !state.week) return null;
  for (let i = state.history.length - 1; i >= 0; i--) {
    const w = state.history[i];
    if (w.start >= state.week.start) continue;
    const r = w.rows.find(x => x.object === row.object);
    if (r) return r;
  }
  return null;
}

/** «Прошлая неделя: …» с кнопкой «Взять» — только если там есть текст и он отличается от текущего. */
function prevHtml(field) {
  const prev = prevEntry();
  const row = currentRow();
  const text = prev ? String(prev[field] || '').trim() : '';
  const show = text && row && text !== String(row[field] || '').trim();
  const more = lines(text).length > 1 ? ` (+${lines(text).length - 1})` : '';
  return `<div class="prev" data-prev="${field}">${show
    ? `<small>Прошлая неделя: ${esc(firstLine(text))}${more}</small><button class="btn small ghost" data-act="copy-prev" data-field="${field}">Взять</button>`
    : ''}</div>`;
}

function refreshPrev() {
  $$('[data-prev]').forEach(el => { el.outerHTML = prevHtml(el.dataset.prev); });
}

function refreshSugg() {
  $$('[data-sugg]').forEach(el => {
    const input = $('[data-li-new]', el.closest('[data-list]'));
    el.outerHTML = suggHtml(el.dataset.sugg, input && input.value);
  });
}

function rerenderList(name, focusNew) {
  const r = currentRow();
  const el = $(`[data-list="${name}"]`);
  el.outerHTML = listEditor(name, r[name]);
  const fresh = $(`[data-list="${name}"]`);
  $$('textarea', fresh).forEach(grow);
  if (focusNew) $('[data-li-new]', fresh).focus();
}

function photoHtml(r) {
  const links = (r.photo && r.photo.links) || [];
  const plain = !links.length && r.photo && r.photo.text ? r.photo.text : '';
  const label = l => (l.label && l.label !== l.url ? l.label : l.url.replace(/^https?:\/\//, ''));
  return `<span class="label">Фотоотчёт (ссылки на МТС Диск)</span>
    <div class="links">
      ${links.map((l, k) => `<div class="link"><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(label(l))}</a><button class="btn ghost" data-act="link-del" data-k="${k}" aria-label="Удалить ссылку">×</button></div>`).join('')}
      ${plain ? `<div class="link"><span>${esc(plain)}</span></div>` : ''}
    </div>
    <div class="link-add">
      <input type="url" id="link-url" placeholder="https://…mts-disk.ru/f/…" autocomplete="off">
      <input type="text" id="link-label" placeholder="${todayDm()}">
    </div>
    <div class="row-btns" style="margin-top:8px">
      <button class="btn small" data-act="link-paste">Вставить из буфера</button>
      <button class="btn small primary" data-act="link-add">Добавить ссылку</button>
    </div>`;
}

function grow(t) {
  t.style.height = 'auto';
  t.style.height = t.scrollHeight + 2 + 'px';
}

// ---------- Итог недели ----------

function renderSummary() {
  const w = state.week;
  setBar({ title: 'Итог недели', sub: w.sheetName, back: hash('week', w.sheetName) });
  $('#view').innerHTML = `
    <div class="field"><label>Итог недели (ячейка «ИТОГ НЕДЕЛИ» на листе)</label>
      <textarea data-sum rows="6">${esc(state.draft.summary)}</textarea></div>
    <button class="btn block" data-act="build-summary">Собрать черновик из объектов</button>`;
  grow($('[data-sum]'));
}

/** «Объект - главное за неделю»: комментарий, иначе выполненное, иначе этап. */
function buildSummary(rows) {
  return rows.filter(r => r.object).map(r => {
    const main = firstLine(r.comment) || lines(r.done).join(', ') || firstLine(r.stage) || r.status;
    return `${r.object} - ${main}`;
  }).join('\n');
}

// ---------- История объектов ----------

const PROBLEM = ['Ожидание решения', 'Ожидание материалов', 'Приостановлено'];
const PERIODS = { '1m': 'Месяц', '3m': '3 месяца', all: 'Всё время' };

let historyLoading = null;

/** Все заполненные недели. Со старой версией Api.gs (без getHistory) собираются из getAll. */
function refreshHistory() {
  if (!historyLoading) {
    historyLoading = api('getHistory')
      .catch(e => {
        if (e.code !== 'UNKNOWN_ACTION') throw e;
        return api('getAll').then(all => all.filter(w => w.rows.length).map(w => ({
          sheetName: w.sheetName, start: w.start, end: w.end, weekNumber: w.weekNumber,
          rows: w.rows.filter(r => r.object).map(r => ({ ...r, photo: (r.photo && r.photo.links) || [] })),
        })));
      })
      .then(h => {
        state.history = h;
        state.historyFresh = true;
        store.set('cache:history', h);
        return h;
      })
      .finally(() => { historyLoading = null; });
  }
  return historyLoading;
}

/** Показывает историю из кэша сразу, а свежую подгружает и перерисовывает экран. */
async function withHistory(seq, draw) {
  if (state.history) draw(state.history, !state.historyFresh);
  else $('#view').innerHTML = loading() + '<p class="empty">Собираю все недели из таблицы — это 10–20 секунд</p>';
  if (state.historyFresh) return;
  try {
    const h = await refreshHistory();
    if (seq === renderSeq) draw(h, false);
  } catch (e) {
    if (!state.history) throw e;
    if (seq === renderSeq) {
      draw(state.history, false);
      toast(isOffline(e) ? 'Нет связи — показана сохранённая история' : e.message);
    }
  }
}

function periodStart(period) {
  if (period === 'all') return '';
  const d = new Date();
  d.setDate(d.getDate() - (period === '1m' ? 31 : 92));
  return ymd(d);
}

/** Объекты по неделям периода: последняя запись, изменение, сколько недель подряд в текущем статусе. */
function objectIndex(history, period) {
  const from = periodStart(period);
  const weeks = history.filter(w => !from || w.end >= from);
  const map = new Map();
  weeks.forEach((w, wi) => w.rows.forEach(r => {
    if (!map.has(r.object)) map.set(r.object, []);
    map.get(r.object).push({ ...r, week: w, wi });
  }));
  const lastWeek = weeks[weeks.length - 1] || null;
  const list = [...map].map(([name, entries]) => {
    const last = entries[entries.length - 1];
    const prev = entries[entries.length - 2];
    let streak = 1;
    for (let i = entries.length - 2; i >= 0; i--) {
      if (entries[i].status !== last.status || entries[i].wi !== entries[i + 1].wi - 1) break;
      streak++;
    }
    const num = v => v !== null && v !== undefined && v !== '';
    return {
      name, entries, last, streak,
      delta: prev && num(prev.readiness) && num(last.readiness) ? Math.round((last.readiness - prev.readiness) * 10) / 10 : null,
      active: last.week === lastWeek,
    };
  });
  return { list, weeks, lastWeek };
}

function deltaHtml(d) {
  if (d === null) return '';
  if (!d) return '<em>±0</em>';
  return `<em class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d}</em>`;
}

const weeksWord = n => (n % 10 === 1 && n % 100 !== 11 ? 'неделя' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'недели' : 'недель');

async function renderObjects(seq) {
  setBar({ title: 'Объекты' });
  await withHistory(seq, (history, stale) => {
    const f = state.filters;
    const idx = objectIndex(history, f.period);
    const contractors = [...new Set(idx.list.map(o => o.last.contractor).filter(Boolean))].sort();
    const statuses = (state.dirs && state.dirs.statuses) || [...new Set(idx.list.map(o => o.last.status).filter(Boolean))];
    const pass = o => (!f.status || (f.status === 'problem' ? PROBLEM.includes(o.last.status) : o.last.status === f.status))
      && (!f.contractor || o.last.contractor === f.contractor);
    const shown = idx.list.filter(pass);
    const active = shown.filter(o => o.active);
    const attention = active.filter(o => PROBLEM.includes(o.last.status));
    const earlier = shown.filter(o => !o.active);
    setBar({ title: 'Объекты', sub: idx.lastWeek ? `по ${idx.weeks.length} нед. · последняя: ${idx.lastWeek.sheetName}` : '' });

    const item = o => `
      <a class="card" href="${hash('object', o.name)}">
        <div class="card-top"><b>${esc(o.name)}</b><span class="status ${STATUS_CLASS[o.last.status] || ''}">${esc(o.last.status || 'без статуса')}</span></div>
        <div class="card-mid"><div class="progress"><i style="width:${Number(o.last.readiness) || 0}%"></i></div><span>${fmtPct(o.last.readiness)} ${deltaHtml(o.delta)}</span></div>
        <div class="meta">
          ${o.last.contractor ? `<span>${esc(o.last.contractor)}</span>` : ''}
          ${PROBLEM.includes(o.last.status) ? `<span class="attention">${o.streak} ${weeksWord(o.streak)} в статусе</span>` : ''}
          ${o.active ? '' : `<span>последний раз: ${esc(o.last.week.sheetName)}</span>`}
        </div>
      </a>`;

    $('#view').innerHTML = `
      ${stale ? '<div class="banner">Обновляю данные из таблицы…</div>' : ''}
      <a class="list item" href="${hash('month', ymd(new Date()).slice(0, 7))}" style="margin-bottom:12px"><div><b>Сводка за месяц</b><small>готовность на начало и конец, что сделано, задержки</small></div><span class="chev">›</span></a>
      <div class="filters">
        <select data-filter="period" aria-label="Период">${Object.entries(PERIODS).map(([k, v]) => `<option value="${k}" ${f.period === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <select data-filter="status" aria-label="Статус" class="${f.status ? 'set' : ''}">
          <option value="">Все статусы</option>
          <option value="problem" ${f.status === 'problem' ? 'selected' : ''}>Требуют внимания</option>
          ${statuses.map(s => `<option ${f.status === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
        </select>
        <select data-filter="contractor" aria-label="Подрядчик" class="${f.contractor ? 'set' : ''}">
          <option value="">Все подрядчики</option>
          ${contractors.map(c => `<option ${f.contractor === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
      </div>
      ${attention.length && f.status !== 'problem' ? `<h2>Требуют внимания (${attention.length})</h2><div class="cards">${attention.map(item).join('')}</div>` : ''}
      <h2>${f.status === 'problem' ? 'Требуют внимания' : 'В последней неделе'} (${active.length})</h2>
      <div class="cards">${active.map(item).join('') || '<div class="empty">Нет объектов под эти фильтры</div>'}</div>
      ${earlier.length ? `<details class="more"><summary>Ранее в отчётах (${earlier.length})</summary><div class="cards">${earlier.map(item).join('')}</div></details>` : ''}`;
  });
}

async function renderObject(name, seq) {
  setBar({ title: name, back: '#/objects' });
  await withHistory(seq, (history, stale) => {
    const f = state.filters;
    const o = objectIndex(history, f.period).list.find(x => x.name === name);
    const all = objectIndex(history, 'all').list.find(x => x.name === name);
    setBar({ title: name, sub: o ? `${o.entries.length} нед. в отчётах` : '', back: '#/objects' });
    const seg = `<div class="seg small">${Object.entries(PERIODS).map(([k, v]) =>
      `<a href="#" data-act="period" data-p="${k}" class="${f.period === k ? 'on' : ''}">${v}</a>`).join('')}</div>`;
    if (!o) {
      $('#view').innerHTML = seg + `<div class="empty">За этот период объекта нет в отчётах.${all ? ` Последний раз: ${esc(all.last.week.sheetName)}.` : ''}</div>`;
      return;
    }
    const first = o.entries.find(e => e.readiness !== null && e.readiness !== undefined && e.readiness !== '');
    const growth = first && o.last.readiness !== null ? Math.round((o.last.readiness - first.readiness) * 10) / 10 : null;
    $('#view').innerHTML = `
      ${stale ? '<div class="banner">Обновляю данные из таблицы…</div>' : ''}
      ${seg}
      <div class="stats">
        <div><b>${fmtPct(o.last.readiness)}</b><small>готовность</small></div>
        <div><b>${growth === null ? '—' : (growth > 0 ? '+' : '') + growth}</b><small>за период</small></div>
        <div><b>${o.streak}</b><small>${weeksWord(o.streak)} в статусе</small></div>
      </div>
      <div class="chips"><span class="status ${STATUS_CLASS[o.last.status] || ''}">${esc(o.last.status || 'без статуса')}</span>${o.last.contractor ? `<span class="pill">${esc(o.last.contractor)}</span>` : ''}</div>
      <div class="chart-box">${chartSvg(o.entries)}<div class="chart-info" id="chart-info"></div></div>
      <h2>По неделям</h2>
      <div class="tl">${o.entries.slice().reverse().map((e, i, arr) => timelineCard(e, arr[i + 1])).join('')}</div>`;
    bindChart(o.entries);
  });
}

function timelineCard(e, prev) {
  const d = prev && prev.readiness !== null && e.readiness !== null && prev.readiness !== undefined
    ? Math.round((e.readiness - prev.readiness) * 10) / 10 : null;
  const block = (label, text, list) => {
    if (!lines(text).length) return '';
    return `<div class="kv"><span>${label}</span>${list
      ? `<ul>${lines(text).map(t => `<li>${esc(t)}</li>`).join('')}</ul>`
      : `<p>${esc(String(text).trim())}</p>`}</div>`;
  };
  const photos = (e.photo || []).map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label && l.label !== l.url ? l.label : 'фото')}</a>`).join(', ');
  return `
    <div class="card">
      <div class="card-top"><h3>${esc(e.week.sheetName)}</h3><span class="status ${STATUS_CLASS[e.status] || ''}">${esc(e.status || '—')}</span></div>
      <div class="meta"><span>Неделя ${e.week.weekNumber}</span><span><b>${fmtPct(e.readiness)}</b> ${deltaHtml(d)}</span>${e.contractor ? `<span>${esc(e.contractor)}</span>` : ''}</div>
      ${block('Этап', e.stage, false)}
      ${block('Выполнено', e.done, true)}
      ${block('Объём', e.volume, false)}
      ${block('План', e.plan, true)}
      ${block('Комментарий', e.comment, false)}
      ${photos ? `<div class="kv"><span>Фото</span><p>${photos}</p></div>` : ''}
      <div class="kv"><a href="${hash('week', e.week.sheetName)}">Открыть неделю ›</a></div>
    </div>`;
}

// ---------- Сводка за месяц ----------

const MONTH_NAMES = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const shiftMonth = (ym, n) => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1); return ymd(d).slice(0, 7); };
const hasNum = v => v !== null && v !== undefined && v !== '';

/** Неделя относится к месяцу своего четверга — как в номерах недель ISO. */
function weekMonth(w) {
  const d = parseYmd(w.start);
  d.setDate(d.getDate() + 3);
  return ymd(d).slice(0, 7);
}

function monthSummary(history, ym) {
  const weeks = history.filter(w => weekMonth(w) === ym);
  const before = history.filter(w => weeks.length && w.start < weeks[0].start);
  const map = new Map();
  weeks.forEach(w => w.rows.forEach(r => {
    if (!map.has(r.object)) map.set(r.object, []);
    map.get(r.object).push({ ...r, week: w });
  }));
  const prevOf = name => {
    for (let i = before.length - 1; i >= 0; i--) {
      const r = before[i].rows.find(x => x.object === name);
      if (r) return r;
    }
    return null;
  };
  const objects = [...map].map(([name, entries]) => {
    const prev = prevOf(name);
    const last = entries[entries.length - 1];
    const startR = prev && hasNum(prev.readiness) ? prev.readiness : (hasNum(entries[0].readiness) ? entries[0].readiness : null);
    const endR = hasNum(last.readiness) ? last.readiness : null;
    const done = [];
    entries.forEach(e => lines(e.done).forEach(t => { if (!done.includes(t)) done.push(t); }));
    return {
      name, entries, last,
      startR, endR,
      growth: startR !== null && endR !== null ? Math.round((endR - startR) * 10) / 10 : null,
      problemWeeks: entries.filter(e => PROBLEM.includes(e.status)).length,
      done,
      comments: entries.filter(e => firstLine(e.comment)).map(e => `${dm(e.week.start)}: ${lines(e.comment).join('; ')}`),
    };
  });
  const growths = objects.map(o => o.growth).filter(g => g !== null);
  return {
    ym, weeks, objects,
    avgGrowth: growths.length ? Math.round(growths.reduce((a, b) => a + b, 0) / growths.length * 10) / 10 : null,
    problemObjects: objects.filter(o => o.problemWeeks).length,
  };
}

const monthTitle = ym => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const signed = v => (v === null ? '—' : (v > 0 ? '+' : '') + v);

async function renderMonth(ym, seq) {
  ym = /^\d{4}-\d{2}$/.test(ym || '') ? ym : ymd(new Date()).slice(0, 7);
  setBar({ title: 'Сводка за месяц', back: '#/objects' });
  await withHistory(seq, (history, stale) => {
    const s = monthSummary(history, ym);
    state.monthText = monthText(s);
    const range = s.weeks.length ? `недели ${s.weeks[0].weekNumber}–${s.weeks[s.weeks.length - 1].weekNumber}` : 'нет отчётов';
    setBar({ title: 'Сводка за месяц', sub: `${monthTitle(ym)} · ${range}`, back: '#/objects' });
    $('#view').innerHTML = `
      ${stale ? '<div class="banner no-print">Обновляю данные из таблицы…</div>' : ''}
      <div class="seg no-print">
        <a href="${hash('month', shiftMonth(ym, -1))}">‹ ${MONTH_NAMES[Number(shiftMonth(ym, -1).slice(5, 7)) - 1]}</a>
        <a class="on">${monthTitle(ym)}</a>
        <a href="${hash('month', shiftMonth(ym, 1))}">${MONTH_NAMES[Number(shiftMonth(ym, 1).slice(5, 7)) - 1]} ›</a>
      </div>
      <h1 class="print-only">Сводка за ${monthTitle(ym)} · ${range}</h1>
      <div class="stats">
        <div><b>${s.objects.length}</b><small>объектов</small></div>
        <div><b>${signed(s.avgGrowth)}</b><small>средний прирост</small></div>
        <div><b>${s.problemObjects}</b><small>с задержками</small></div>
      </div>
      ${s.objects.length ? `<div class="row-btns no-print" style="margin-bottom:12px">
        <button class="btn" data-act="month-share">Поделиться текстом</button>
        <button class="btn primary" data-act="month-print">Печать / PDF</button>
      </div>` : '<div class="empty">За этот месяц отчётов нет</div>'}
      <div class="tl">${s.objects.map(o => `
        <div class="card">
          <div class="card-top"><h3>${esc(o.name)}</h3><span class="status ${STATUS_CLASS[o.last.status] || ''}">${esc(o.last.status || '—')}</span></div>
          <div class="meta">
            <span>Готовность: <b>${fmtPct(o.startR)} → ${fmtPct(o.endR)}</b> ${deltaHtml(o.growth)}</span>
            <span>${o.entries.length} ${weeksWord(o.entries.length)} в отчётах</span>
            ${o.problemWeeks ? `<span class="attention">${o.problemWeeks} ${weeksWord(o.problemWeeks)} в ожидании/простое</span>` : ''}
            ${o.last.contractor ? `<span>${esc(o.last.contractor)}</span>` : ''}
          </div>
          ${o.done.length ? `<div class="kv"><span>Сделано за месяц</span><ul>${o.done.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
          ${o.comments.length ? `<div class="kv"><span>Комментарии</span><p>${o.comments.map(esc).join('\n')}</p></div>` : ''}
          <div class="kv no-print"><a href="${hash('object', o.name)}">История объекта ›</a></div>
        </div>`).join('')}</div>`;
  });
}

function monthText(s) {
  const head = `Сводка за ${monthTitle(s.ym)}` + (s.weeks.length ? ` (недели ${s.weeks[0].weekNumber}–${s.weeks[s.weeks.length - 1].weekNumber})` : '');
  const body = s.objects.map(o => [
    `${o.name} — ${o.last.status || 'без статуса'}, готовность ${fmtPct(o.startR)} → ${fmtPct(o.endR)} (${signed(o.growth)})` +
      (o.problemWeeks ? `, ${o.problemWeeks} ${weeksWord(o.problemWeeks)} в ожидании/простое` : ''),
    ...(o.done.length ? ['Сделано: ' + o.done.join('; ')] : []),
    ...(o.comments.length ? ['Комментарии: ' + o.comments.join(' | ')] : []),
  ].join('\n')).join('\n\n');
  return `${head}\n\n${body}`;
}

const CH = { W: 340, H: 170, L: 34, R: 14, T: 16, B: 26 };

/** Линия готовности по неделям: одна шкала 0–100%, подписи недель, значение последней точки. */
function chartSvg(entries) {
  const n = entries.length;
  const x = i => (n === 1 ? (CH.L + CH.W - CH.R) / 2 : CH.L + i * (CH.W - CH.L - CH.R) / (n - 1));
  const y = v => CH.T + (100 - v) * (CH.H - CH.T - CH.B) / 100;
  const has = v => v !== null && v !== undefined && v !== '';
  const grid = [0, 50, 100].map(v => `<line class="grid" x1="${CH.L}" x2="${CH.W - CH.R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${CH.L - 6}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`).join('');
  const step = Math.ceil(n / 6);
  const xl = entries.map((e, i) => (i % step === 0 || i === n - 1)
    ? `<text class="axis" x="${x(i)}" y="${CH.H - 6}" text-anchor="middle">${e.week.weekNumber}</text>` : '').join('');
  let path = '';
  entries.forEach((e, i) => {
    if (!has(e.readiness)) return;
    path += `${path && has(entries[i - 1] && entries[i - 1].readiness) ? 'L' : 'M'}${x(i).toFixed(1)},${y(e.readiness).toFixed(1)} `;
  });
  const dots = entries.map((e, i) => has(e.readiness) ? `<circle class="dot" data-i="${i}" cx="${x(i)}" cy="${y(e.readiness)}" r="4"/>` : '').join('');
  const lastI = entries.map(e => has(e.readiness)).lastIndexOf(true);
  const lastLabel = lastI >= 0
    ? `<text class="val" x="${Math.min(x(lastI), CH.W - CH.R - 4)}" y="${y(entries[lastI].readiness) - 9}" text-anchor="${lastI === n - 1 ? 'end' : 'middle'}">${fmtPct(entries[lastI].readiness)}</text>` : '';
  return `<svg viewBox="0 0 ${CH.W} ${CH.H}" role="img" aria-label="График готовности по неделям">
    ${grid}${xl}
    <line class="cross" id="chart-x" x1="0" x2="0" y1="${CH.T}" y2="${CH.H - CH.B}" visibility="hidden"/>
    <path class="line" d="${path}"/>${dots}${lastLabel}
    <rect id="chart-hit" x="${CH.L - 10}" y="0" width="${CH.W - CH.L - CH.R + 20}" height="${CH.H}" fill="transparent"/>
  </svg>`;
}

/** Касание или наведение: ближайшая неделя, вертикальная линия и подпись под графиком. */
function bindChart(entries) {
  const svg = $('.chart-box svg');
  const info = $('#chart-info');
  if (!svg) return;
  const n = entries.length;
  const show = i => {
    const e = entries[i];
    const xPos = n === 1 ? (CH.L + CH.W - CH.R) / 2 : CH.L + i * (CH.W - CH.L - CH.R) / (n - 1);
    const cross = $('#chart-x');
    cross.setAttribute('x1', xPos);
    cross.setAttribute('x2', xPos);
    cross.setAttribute('visibility', 'visible');
    $$('.dot', svg).forEach(d => d.setAttribute('r', Number(d.dataset.i) === i ? 6 : 4));
    info.innerHTML = `<b>Неделя ${e.week.weekNumber}</b> · ${dm(e.week.start)}–${dm(e.week.end)} · ${fmtPct(e.readiness)} · ${esc(e.status || 'без статуса')}`;
  };
  const pick = ev => {
    const box = svg.getBoundingClientRect();
    const vx = (ev.clientX - box.left) * CH.W / box.width;
    const i = n === 1 ? 0 : Math.round((vx - CH.L) / ((CH.W - CH.L - CH.R) / (n - 1)));
    show(Math.max(0, Math.min(n - 1, i)));
  };
  svg.addEventListener('pointermove', pick);
  svg.addEventListener('pointerdown', pick);
  show(n - 1);
}

// ---------- Справочники ----------

async function renderDirs(list, seq) {
  setBar({ title: 'Справочники' });
  const dirs = await loadDirs(true);
  if (seq !== renderSeq) return;
  const hidden = dirs.hidden[list] || [];
  $('#view').innerHTML = `
    <div class="seg">
      <a href="#/dirs/objects" class="${list === 'objects' ? 'on' : ''}">Объекты (${dirs.objects.length})</a>
      <a href="#/dirs/contractors" class="${list === 'contractors' ? 'on' : ''}">Подрядчики (${dirs.contractors.length})</a>
    </div>
    <div class="list">
      ${dirs[list].map(v => `
        <div class="item">
          <div><b>${esc(v)}</b>${hidden.includes(v) ? '<small>скрыт из выбора</small>' : ''}</div>
          <button class="btn small ghost" data-act="dir-rename" data-v="${esc(v)}">Изменить</button>
          <button class="btn small ghost" data-act="dir-hide" data-v="${esc(v)}" data-h="${hidden.includes(v) ? '' : '1'}">${hidden.includes(v) ? 'Показать' : 'Скрыть'}</button>
        </div>`).join('')}
    </div>
    <div class="field" style="margin-top:12px"><label>${list === 'objects' ? 'Новый объект' : 'Новый подрядчик'}</label>
      <input type="text" id="dir-new" autocomplete="off">
      <button class="btn primary block" data-act="dir-add" data-list="${list}">Добавить в таблицу</button></div>
    <small>Скрытые остаются в таблице — на них ссылаются старые недели. Скрытие убирает их только из выбора в приложении.</small>`;
}

// ---------- Настройки ----------

async function renderSettings(seq) {
  setBar({ title: 'Настройки' });
  let settings = state.settings;
  try {
    settings = (await cached('cache:settings', 'getSettings')).data;
    state.settings = settings;
  } catch (e) { /* покажем то, что есть */ }
  if (seq !== renderSeq) return;
  const s = settings || {};
  $('#view').innerHTML = `
    ${connectionHtml()}
    <h2>Отчёт</h2>
    <div class="field"><label>Компания</label><input type="text" id="set-company" value="${esc(s.company)}"></div>
    <div class="field"><label>Инженер ТН</label><input type="text" id="set-engineer" value="${esc(s.engineer)}"></div>
    <div class="field">
      <label class="switch">Отметка «кто и когда изменил»<input type="checkbox" id="set-mark" ${s.showChangeMark ? 'checked' : ''}></label>
      <label class="switch">Модуль «Задачи и решения»<input type="checkbox" id="set-tasks" ${s.tasksModule ? 'checked' : ''}></label>
      <small>Оба модуля появятся в следующих этапах; сейчас сохраняется только выбор.</small>
    </div>
    <button class="btn primary block" data-act="settings-save">Сохранить настройки</button>
    ${reminderHtml(s)}
    <h2>Приложение</h2>
    <div class="list">
      <div class="item"><div><b>Версия</b><small>${VERSION}</small></div></div>
      <div class="item"><div><b>Черновики на телефоне</b><small>${store.keys(draftPrefix()).length}</small></div></div>
      ${s.lastBackup
        ? `<a class="item" href="${esc(s.lastBackup.folderUrl)}" target="_blank" rel="noopener"><div><b>Резервная копия таблицы</b><small>последняя: ${esc(s.lastBackup.at)} · папка «Отчёты — архив»</small></div><span class="chev">›</span></a>`
        : '<div class="item"><div><b>Резервная копия таблицы</b><small>не включена — запустите setupBackup() в скрипте таблицы</small></div></div>'}
    </div>
    <button class="btn block danger" data-act="cache-clear">Очистить кэш (черновики останутся)</button>`;
}

const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

function reminderHtml(s) {
  const r = { enabled: false, weekday: 5, hour: 15, email: '', onlyIfIncomplete: true, ...(s.reminder || {}) };
  const hours = Array.from({ length: 15 }, (_, i) => i + 7);
  const status = s.reminderActive === undefined ? '' : s.reminderActive
    ? `<small class="hint">Включено: ${DAYS[r.weekday - 1].toLowerCase()}, около ${r.hour}:00</small>`
    : (r.enabled ? '<small class="hint attention">Расписание не работает — сохраните ещё раз или запустите testReminder() в редакторе</small>' : '');
  return `
    <h2>Напоминание об отчёте</h2>
    <div class="field">
      <label class="switch">Присылать письмо-напоминание<input type="checkbox" id="rem-on" ${r.enabled ? 'checked' : ''}></label>
      <div class="filters" style="grid-template-columns: minmax(0, 1fr) 110px; margin: 6px 0 8px">
        <select id="rem-day" aria-label="День">${DAYS.map((d, i) => `<option value="${i + 1}" ${Number(r.weekday) === i + 1 ? 'selected' : ''}>${d}</option>`).join('')}</select>
        <select id="rem-hour" aria-label="Время">${hours.map(h => `<option value="${h}" ${Number(r.hour) === h ? 'selected' : ''}>${h}:00</option>`).join('')}</select>
      </div>
      <input type="text" inputmode="email" id="rem-email" value="${esc(r.email)}" placeholder="почта (по умолчанию — ваша Google-почта)" autocomplete="off">
      <label class="switch">Только если отчёт не дозаполнен<input type="checkbox" id="rem-only" ${r.onlyIfIncomplete !== false ? 'checked' : ''}></label>
      <small>Проверяется текущая неделя: есть ли объекты, заполнены ли «Выполнено», «План» и «Итог недели». В письме — что осталось и ссылка на приложение.</small>
      ${status}
    </div>
    <div class="row-btns">
      <button class="btn" data-act="reminder-test">Прислать сейчас</button>
      <button class="btn primary" data-act="reminder-save">Сохранить</button>
    </div>`;
}

function connectionHtml() {
  const c = state.cfg;
  return `
    <h2>Подключение к таблице</h2>
    <div class="field"><label>URL веб-приложения (…/exec)</label>
      <input type="url" id="cfg-url" value="${esc(c.url === 'demo' ? '' : c.url)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></div>
    <div class="field"><label>Ключ доступа</label>
      <input type="password" id="cfg-key" value="${esc(c.key)}" autocomplete="off"></div>
    <button class="btn primary block" data-act="cfg-save">Проверить и сохранить</button>
    <button class="btn block" data-act="cfg-demo">${c.url === 'demo' ? 'Сейчас включён демо-режим' : 'Попробовать в демо-режиме'}</button>`;
}

function renderSetup() {
  setBar({ title: 'Отчёты стройки' });
  $('#view').innerHTML = `
    <p>Приложение работает с вашей Google-таблицей через скрипт <b>Api.gs</b>.
    Вставьте URL веб-приложения и ключ доступа из журнала <code>setupApi</code>.</p>
    ${connectionHtml()}`;
}

// ---------- Черновик и сохранение ----------

let draftTimer = null;

function markDirty() {
  const d = state.draft;
  d.dirty = true;
  d.savedAt = Date.now();
  clearTimeout(draftTimer);
  draftTimer = setTimeout(persistDraft, 300);
  renderSaveBar();
}

function persistDraft() {
  const d = state.draft;
  if (!d || !d.dirty) return;
  store.set(draftPrefix() + state.week.sheetName, { rows: d.rows, summary: d.summary, baseVersion: d.baseVersion, savedAt: d.savedAt });
}

function renderSaveBar() {
  const bar = $('#savebar');
  const show = route()[0] === 'week' && state.draft && state.draft.dirty;
  bar.hidden = !show;
  if (!show) return;
  const t = new Date(state.draft.savedAt || Date.now());
  bar.innerHTML = `
    <span>Не сохранено в таблицу<br><small>черновик на телефоне, ${pad(t.getHours())}:${pad(t.getMinutes())}</small></span>
    <button class="btn small" data-act="discard">Отменить</button>
    <button class="btn small primary" data-act="save">Сохранить</button>`;
}

function rowsForSave(rows = state.draft.rows) {
  return rows.map(r => {
    const out = {};
    FIELDS.forEach(f => {
      out[f] = typeof r[f] === 'string' ? r[f].replace(/\s+$/, '') : r[f];
    });
    return out;
  });
}

async function save(opts = {}) {
  const w = state.week;
  const d = state.draft;
  persistDraft();
  try {
    const week = await busy(() => api('saveWeek', {
      sheetName: w.sheetName, rows: rowsForSave(), summary: d.summary.replace(/\s+$/, ''),
      baseVersion: d.baseVersion, force: !!opts.force, expand: !!opts.expand,
    }));
    store.del(draftPrefix() + w.sheetName);
    setWeek(week);
    state.weeks = null;
    state.historyFresh = false;
    toast('Сохранено в таблицу');
    render();
  } catch (e) {
    if (e.code === 'CONFLICT') {
      const choice = await modal({
        title: 'Лист изменили в таблице',
        text: 'Пока вы редактировали, кто-то поменял этот лист в Google-таблице.',
        buttons: [
          { id: 'force', label: 'Записать мою версию', primary: true },
          { id: 'theirs', label: 'Взять версию из таблицы (мои правки пропадут)', danger: true },
          { id: 'cancel', label: 'Отмена' },
        ],
      });
      if (choice === 'force') return save({ ...opts, force: true });
      if (choice === 'theirs') {
        store.del(draftPrefix() + w.sheetName);
        setWeek(e.data);
        render();
      }
    } else if (e.code === 'ROWS_LIMIT') {
      const ok = await confirmModal('Не хватает строк на листе',
        `На листе место на ${e.data.capacity} объектов. Добавить строки в таблицу? Формулы, списки и цвета растянутся сами.`, 'Добавить строки');
      if (ok) return save({ ...opts, expand: true });
    } else if (isOffline(e)) {
      toast('Нет связи. Черновик сохранён на телефоне и уйдёт в таблицу сам, когда появится интернет.');
    } else {
      toast(e.message);
    }
  }
}

// ---------- Работа без связи ----------

let syncing = false;

/**
 * Отправляет черновики всех недель, кроме открытой сейчас в редакторе.
 * Конфликт оставляет черновик с пометкой — его решают вручную при открытии недели.
 */
async function syncDrafts({ manual = false } = {}) {
  if (syncing || !state.cfg.url) return null;
  const [page, openName] = route();
  const names = store.keys(draftPrefix()).map(k => k.slice(draftPrefix().length)).filter(n => !(page === 'week' && n === openName));
  if (!names.length) return null;
  syncing = true;
  const res = { sent: [], conflicts: [], offline: false };
  try {
    for (const name of names) {
      const d = store.get(draftPrefix() + name, null);
      if (!d || (d.conflict && !manual)) continue;
      try {
        const week = await api('saveWeek', {
          sheetName: name, rows: rowsForSave(d.rows), summary: String(d.summary || '').replace(/\s+$/, ''), baseVersion: d.baseVersion,
        });
        store.del(draftPrefix() + name);
        store.set('cache:week:' + name, week);
        if (state.week && state.week.sheetName === name) setWeek(week);
        res.sent.push(name);
      } catch (e) {
        if (isOffline(e)) { res.offline = true; break; }
        if (e.code === 'CONFLICT') {
          store.set(draftPrefix() + name, { ...d, conflict: true });
          res.conflicts.push(name);
        } else {
          toast(`«${name}»: ${e.message}`);
        }
      }
    }
  } finally {
    syncing = false;
  }
  if (res.sent.length) {
    state.weeks = null;
    state.historyFresh = false;
    toast(`Отправлено в таблицу: ${res.sent.join(', ')}` + (res.conflicts.length ? `. Конфликт: ${res.conflicts.join(', ')} — откройте неделю` : ''));
  } else if (res.conflicts.length) {
    toast(`Лист изменили в таблице: ${res.conflicts.join(', ')} — откройте неделю и выберите версию`);
  } else if (manual && res.offline) {
    toast('Нет связи — отправлю, когда появится интернет');
  }
  if (route()[0] === 'weeks' && (res.sent.length || res.conflicts.length)) render();
  return res;
}

/** Текущая и последняя заполненная недели заранее сохраняются на телефоне — на объекте без связи они откроются. */
async function prefetch(weeks) {
  const today = ymd(new Date());
  const current = weeks.find(w => w.start <= today && today <= w.end);
  const filled = weeks.filter(w => w.objectsCount > 0).pop();
  for (const w of [current, filled]) {
    if (!w || prefetched.has(w.sheetName)) continue;
    prefetched.add(w.sheetName);
    try {
      store.set('cache:week:' + w.sheetName, await api('getWeek', { sheetName: w.sheetName }));
    } catch (e) { /* в следующий раз */ }
  }
  if (!state.dirs) loadDirs().catch(() => { /* в следующий раз */ });
}

const prefetched = new Set();

// ---------- Действия ----------

const ACTS = {
  retry: () => render(),

  period: el => {
    state.filters.period = el.dataset.p;
    store.set('filters', state.filters);
    render();
  },

  'sync-drafts': () => syncDrafts({ manual: true }),

  'open-current': async () => {
    let res;
    try {
      res = await busy(() => api('ensureWeek', { date: ymd(new Date()), carryOver: false }));
    } catch (e) {
      // Без связи открываем текущую неделю из сохранённого на телефоне.
      const today = ymd(new Date());
      const w = isOffline(e) && (state.weeks || []).find(x => x.start <= today && today <= x.end);
      if (w && store.get('cache:week:' + w.sheetName, null)) return go('week', w.sheetName);
      throw e;
    }
    setWeek(res.week);
    if (res.created) { state.weeks = null; toast('Создан лист «' + res.week.sheetName + '»'); }
    go('week', res.week.sheetName);
  },

  carry: async () => {
    const w = state.week;
    const res = await busy(() => api('ensureWeek', { date: w.start, carryOver: true }));
    store.del(draftPrefix() + w.sheetName);
    setWeek(res.week);
    state.weeks = null;
    toast(res.carried ? 'Объекты перенесены и записаны в таблицу' : 'Неделя уже заполнена');
    render();
  },

  'add-row': () => {
    const d = state.draft;
    if (d.rows.length >= state.week.capacity) toast(`На листе ${state.week.capacity} строк — при сохранении предложу добавить`);
    d.rows.push(emptyRow());
    markDirty();
    go('week', state.week.sheetName, 'row', d.rows.length - 1);
  },

  'del-row': async () => {
    const i = Number(route()[3]);
    const r = state.draft.rows[i];
    if (!await confirmModal('Убрать объект из недели?', `«${r.object || 'Без названия'}» исчезнет из этой недели после сохранения.`, 'Убрать')) return;
    state.draft.rows.splice(i, 1);
    markDirty();
    go('week', state.week.sheetName);
  },

  'take-plan': () => {
    const r = currentRow();
    const plan = lines(prevRow(r.object).plan);
    const done = lines(r.done);
    r.done = done.concat(plan.filter(p => !done.includes(p))).join('\n');
    markDirty();
    rerenderList('done');
  },

  'li-add': el => {
    const list = el.closest('[data-list]');
    const input = $('[data-li-new]', list);
    const v = input.value.trim();
    if (!v) return input.focus();
    const r = currentRow();
    r[list.dataset.list] = lines(r[list.dataset.list]).concat(v).join('\n');
    markDirty();
    rerenderList(list.dataset.list, true);
  },

  'month-share': async () => {
    const text = state.monthText || '';
    if (navigator.share) {
      await navigator.share({ title: text.split('\n')[0], text }).catch(() => { /* окно закрыли */ });
    } else {
      await navigator.clipboard.writeText(text);
      toast('Текст сводки скопирован');
    }
  },

  'month-print': () => window.print(),

  'copy-prev': async el => {
    const field = el.dataset.field;
    const r = currentRow();
    const prev = prevEntry();
    if (!r || !prev) return;
    const text = String(prev[field] || '').replace(/\s+$/, '');
    if (String(r[field] || '').trim() && !await confirmModal('Заменить текст?', 'В поле уже есть текст — заменить его текстом прошлой недели?', 'Заменить')) return;
    r[field] = text;
    markDirty();
    if (field === 'plan') {
      rerenderList('plan');
    } else {
      const t = $(`[data-f="${field}"]`);
      t.value = text;
      grow(t);
    }
    refreshPrev();
  },

  'sugg-add': el => {
    const list = el.closest('[data-list]');
    const r = currentRow();
    r[list.dataset.list] = lines(r[list.dataset.list]).concat(el.dataset.v).join('\n');
    markDirty();
    rerenderList(list.dataset.list, true);
  },

  'li-del': el => {
    const list = el.closest('[data-list]');
    const r = currentRow();
    const items = lines(r[list.dataset.list]);
    items.splice(Number(el.dataset.k), 1);
    r[list.dataset.list] = items.join('\n');
    markDirty();
    rerenderList(list.dataset.list);
  },

  'comment-date': () => {
    const r = currentRow();
    const t = $('[data-f="comment"]');
    const base = t.value.replace(/\s+$/, '');
    t.value = (base ? base + '\n' : '') + todayDm() + ' ';
    r.comment = t.value;
    grow(t);
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
    markDirty();
  },

  'link-paste': async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      $('#link-url').value = text;
    } catch (e) {
      toast('Нет доступа к буферу — вставьте ссылку вручную');
      $('#link-url').focus();
    }
  },

  'link-add': () => {
    const url = $('#link-url').value.trim();
    if (!/^https?:\/\/\S+$/.test(url)) return toast('Нужна ссылка вида https://…');
    const r = currentRow();
    const photo = r.photo && r.photo.links ? r.photo : { text: '', links: [] };
    photo.links.push({ label: $('#link-label').value.trim() || todayDm(), url });
    photo.text = photo.links.map(l => l.label).join(', ');
    r.photo = photo;
    markDirty();
    $('#photo').innerHTML = photoHtml(r);
  },

  'link-del': el => {
    const r = currentRow();
    r.photo.links.splice(Number(el.dataset.k), 1);
    r.photo.text = r.photo.links.map(l => l.label).join(', ');
    markDirty();
    $('#photo').innerHTML = photoHtml(r);
  },

  'build-summary': async () => {
    const d = state.draft;
    if (d.summary.trim() && !await confirmModal('Заменить текст итога?', 'Сейчас в итоге уже есть текст.', 'Заменить')) return;
    d.summary = buildSummary(d.rows);
    markDirty();
    renderSummary();
  },

  save: () => save(),

  pdf: async () => {
    if (state.draft.dirty) {
      const ok = await confirmModal('Сначала сохранить?', 'PDF делается из таблицы, поэтому несохранённые правки в него не попадут.', 'Сохранить и сделать PDF');
      if (!ok) return;
      await save();
      if (state.draft.dirty) return;
    }
    const res = await busy(() => api('exportPdf', { sheetName: state.week.sheetName }));
    const bytes = Uint8Array.from(atob(res.base64), c => c.charCodeAt(0));
    const file = new File([bytes], res.fileName, { type: res.mimeType || 'application/pdf' });
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    // Поделиться можно только по нажатию пользователя, поэтому сначала окно с кнопкой.
    const choice = await modal({
      title: 'PDF готов',
      text: res.fileName,
      buttons: [
        ...(canShare ? [{ id: 'share', label: 'Поделиться (почта, Telegram…)', primary: true }] : []),
        { id: 'open', label: 'Открыть', primary: !canShare },
        { id: 'cancel', label: 'Закрыть' },
      ],
    });
    if (choice === 'share') {
      await navigator.share({ files: [file], title: res.fileName }).catch(() => { /* окно закрыли */ });
    } else if (choice === 'open') {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.fileName;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  },

  discard: async () => {
    if (!await confirmModal('Отменить правки?', 'Черновик на телефоне удалится, останется версия из таблицы.', 'Отменить правки')) return;
    store.del(draftPrefix() + state.week.sheetName);
    setWeek(state.week, state.offline);
    render();
  },

  'dir-add': async el => {
    const value = $('#dir-new').value.trim();
    if (!value) return $('#dir-new').focus();
    state.dirs = await busy(() => api('addDirectoryItem', { list: el.dataset.list, value }));
    store.set('cache:dirs', state.dirs);
    toast('Добавлено в таблицу: ' + value);
    render();
  },

  'dir-rename': async el => {
    const list = route()[1] === 'contractors' ? 'contractors' : 'objects';
    const from = el.dataset.v;
    const to = (prompt('Новое название', from) || '').trim();
    if (!to || to === from) return;
    const everywhere = await confirmModal('Заменить и в отчётах?',
      `Заменить «${from}» на «${to}» во всех недельных листах? Иначе старые недели сохранят прежнее название.`, 'Да, во всех неделях');
    const res = await busy(() => api('renameDirectoryItem', { list, from, to, applyToWeeks: everywhere }));
    state.dirs = res;
    store.set('cache:dirs', res);
    state.week = null;
    toast(everywhere ? `Переименовано, замен в неделях: ${res.replaced}` : 'Переименовано');
    render();
  },

  'dir-hide': async el => {
    const list = route()[1] === 'contractors' ? 'contractors' : 'objects';
    state.dirs = await busy(() => api('setHidden', { list, value: el.dataset.v, hidden: !!el.dataset.h }));
    store.set('cache:dirs', state.dirs);
    render();
  },

  'cfg-save': async () => {
    const cfg = { url: $('#cfg-url').value.trim(), key: $('#cfg-key').value.trim() };
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(cfg.url)) return toast('URL должен быть вида https://script.google.com/…/exec');
    const test = createApi(() => cfg);
    const res = await busy(() => test('ping'));
    applyCfg(cfg);
    toast('Подключено: ' + res.spreadsheet);
  },

  'cfg-demo': () => {
    applyCfg({ url: 'demo', key: '' });
    toast('Демо-режим: таблица не меняется');
  },

  'reminder-save': async () => {
    const reminder = {
      enabled: $('#rem-on').checked,
      weekday: Number($('#rem-day').value),
      hour: Number($('#rem-hour').value),
      email: $('#rem-email').value.trim(),
      onlyIfIncomplete: $('#rem-only').checked,
    };
    if (reminder.email && !/^\S+@\S+\.\S+$/.test(reminder.email)) return toast('Проверьте адрес почты');
    const appUrl = location.origin + location.pathname;
    state.settings = await busy(() => api('saveSettings', { settings: { reminder, appUrl } }));
    store.set('cache:settings', state.settings);
    toast(reminder.enabled ? `Напоминание: ${DAYS[reminder.weekday - 1].toLowerCase()}, ${reminder.hour}:00` : 'Напоминание выключено');
    render();
  },

  'reminder-test': async () => {
    const res = await busy(() => api('sendTestReminder'));
    toast('Письмо отправлено на ' + res.to);
  },

  'settings-save': async () => {
    const settings = {
      company: $('#set-company').value.trim(),
      engineer: $('#set-engineer').value.trim(),
      showChangeMark: $('#set-mark').checked,
      tasksModule: $('#set-tasks').checked,
    };
    state.settings = await busy(() => api('saveSettings', { settings }));
    store.set('cache:settings', state.settings);
    toast('Настройки сохранены');
  },

  'cache-clear': () => {
    store.keys('cache:').forEach(k => store.del(k));
    Object.assign(state, { dirs: null, settings: null, weeks: null, week: null, draft: null, history: null, historyFresh: false });
    toast('Кэш очищен');
    render();
  },
};

function applyCfg(cfg) {
  state.cfg = cfg;
  store.set('cfg', cfg);
  store.keys('cache:').forEach(k => store.del(k));
  Object.assign(state, { dirs: null, settings: null, weeks: null, week: null, draft: null, history: null, historyFresh: false });
  go('weeks');
}

// ---------- События ----------

document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  ev.preventDefault();
  const fn = ACTS[el.dataset.act];
  if (!fn) return;
  try {
    await fn(el, ev);
  } catch (e) {
    toast(e.message || String(e));
  }
});

document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.matches('textarea')) grow(t);

  if (t.dataset.f) {
    const r = currentRow();
    if (!r) return;
    const f = t.dataset.f;
    if (f === 'readiness') {
      const v = t.value === '' ? null : Math.min(100, Math.max(0, Number(t.value)));
      r.readiness = v === null || isNaN(v) ? null : v;
      $$('[data-f="readiness"]').forEach(x => { if (x !== t) x.value = r.readiness ?? (x.type === 'range' ? 0 : ''); });
      const p = prevRow(r.object);
      if (p) $('#delta').innerHTML = `Прошлая неделя: ${fmtPct(p.readiness)} ${delta(r)}`;
    } else {
      r[f] = t.value;
    }
    markDirty();
    if (f === 'object') renderRow(Number(route()[3]));
    return;
  }

  if (t.matches('[data-li-new]')) {
    const list = t.closest('[data-list]');
    $('[data-sugg]', list).outerHTML = suggHtml(list.dataset.list, t.value);
    return;
  }

  if (t.matches('[data-li]')) {
    const list = t.closest('[data-list]');
    currentRow()[list.dataset.list] = $$('[data-li]', list).map(x => x.value.trim()).filter(Boolean).join('\n');
    markDirty();
    return;
  }

  if (t.matches('[data-sum]')) {
    state.draft.summary = t.value;
    markDirty();
    return;
  }

  if (t.dataset.filter) {
    state.filters[t.dataset.filter] = t.value;
    store.set('filters', state.filters);
    render();
  }
});

document.addEventListener('keydown', ev => {
  const t = ev.target;
  if (ev.key !== 'Enter' || ev.shiftKey) return;
  if (t.matches('[data-li-new]')) {
    ev.preventDefault();
    ACTS['li-add'](t);
  } else if (t.matches('[data-li]')) {
    ev.preventDefault();
    $('[data-li-new]', t.closest('[data-list]')).focus();
  }
});

window.addEventListener('offline', () => toast('Нет связи — работаю с сохранённым на телефоне'));
window.addEventListener('online', () => {
  toast('Связь появилась');
  syncDrafts();
});

window.addEventListener('hashchange', () => {
  window.scrollTo(0, 0);
  render();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) persistDraft(); });

// ---------- Всплывающие элементы ----------

let toastTimer = null;

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

function modal({ title, text = '', buttons }) {
  return new Promise(resolve => {
    const m = $('#modal');
    m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
      <h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
      <div class="sheet-btns">${buttons.map(b => `<button class="btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}" data-id="${b.id}">${esc(b.label)}</button>`).join('')}</div>
    </div>`;
    m.hidden = false;
    m.onclick = ev => {
      const btn = ev.target.closest('[data-id]');
      if (!btn && ev.target !== m) return;
      m.hidden = true;
      m.onclick = null;
      resolve(btn ? btn.dataset.id : 'cancel');
    };
  });
}

const confirmModal = (title, text, ok = 'Да') =>
  modal({ title, text, buttons: [{ id: 'ok', label: ok, primary: true }, { id: 'cancel', label: 'Отмена' }] }).then(id => id === 'ok');

let busyCount = 0;

async function busy(fn) {
  busyCount++;
  $('#busy').hidden = false;
  document.body.style.pointerEvents = 'none';
  try {
    return await fn();
  } finally {
    if (--busyCount === 0) {
      $('#busy').hidden = true;
      document.body.style.pointerEvents = '';
    }
  }
}

// ---------- Старт ----------

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* без офлайн-оболочки */ });
}
render();
setTimeout(() => { if (navigator.onLine) syncDrafts(); }, 2000);
