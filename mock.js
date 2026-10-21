// Демо-режим: те же ответы, что у Apps Script, но данные в памяти и вымышленные
// (код публикуется открыто, реальных объектов и подрядчиков здесь нет).
// Таблица в демо-режиме не трогается, всё сбрасывается при перезагрузке.

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const CAPACITY = 10;

const dirs = {
  contractors: ['Бригада Север', 'Бригада Юг', 'Монтажники-1', 'Электрики', 'Не требуется', 'Земляные работы', 'Проектировщик', 'Не назначен', 'Металлокаркас'],
  objects: ['Склад А', 'Цех Б', 'Ангар В', 'Офис Г', 'Котельная Д', 'Гараж Е', 'Склад Ж', 'Корпус З', 'Ангар И', 'Цех К'],
  statuses: ['Выполнено', 'В работе', 'Впереди', 'Приостановлено', 'Ожидание материалов', 'Ожидание решения', 'Не назначен', 'Не требуется', 'Отменено'],
  hidden: { contractors: [], objects: [] },
};

let settings = {
  company: 'ООО «Демо»',
  engineer: 'Иванов И.И.',
  showChangeMark: false,
  tasksModule: false,
  reminder: { enabled: false, weekday: 5, hour: 15, email: '' },
};

const link = id => ({ text: `https://example.com/f/${id}`, links: [{ label: `https://example.com/f/${id}`, url: `https://example.com/f/${id}` }] });
const noPhoto = () => ({ text: '', links: [] });
const row = r => ({
  object: '', stage: '', readiness: null, photo: noPhoto(), done: '', status: '', contractor: '',
  volume: '', plan: '', comment: '', ...r,
});

const weeks = [];
for (let d = new Date(2026, 6, 20); d <= new Date(2026, 11, 28); d = addDays(d, 7)) {
  const fri = addDays(d, 4);
  weeks.push({
    sheetName: sheetName(d, fri), start: ymd(d), end: ymd(fri), weekNumber: isoWeek(d),
    capacity: CAPACITY, rows: [], summary: '', formedDate: null, version: rnd(),
  });
}

Object.assign(byStart('2026-10-12'), {
  formedDate: '2026-10-16',
  rows: [
    row({ object: 'Склад А', readiness: 100, status: 'Ожидание решения', contractor: 'Не требуется' }),
    row({ object: 'Ангар И', readiness: 70, status: 'Приостановлено', contractor: 'Бригада Север', plan: 'Окончание монтажа ФЭ и исправление дефектов' }),
    row({ object: 'Офис Г', readiness: 90, status: 'В работе', contractor: 'Монтажники-1' }),
    row({ object: 'Гараж Е', readiness: 10, status: 'В работе', contractor: 'Металлокаркас' }),
    row({ object: 'Ангар В', readiness: 100, status: 'Ожидание решения', contractor: 'Бригада Юг' }),
    row({ object: 'Цех К', readiness: 0, status: 'В работе', contractor: 'Металлокаркас', plan: 'Разработка котлована\n' }),
  ],
});

Object.assign(byStart('2026-10-19'), {
  rows: [
    row({ object: 'Склад А', stage: 'Подписание документов', readiness: 100, photo: link(100001), done: 'Выезд на осмотр возможной протечки\nПодписание документации', status: 'Ожидание решения', contractor: 'Не требуется' }),
    row({ object: 'Ангар И', stage: 'Работы приостановлены', readiness: 70, photo: link(100002), done: 'Выезд на осмотр готовности площадки к монтажу ФЭ', status: 'Впереди', contractor: 'Бригада Север', comment: 'Площадка не готова, готовность к монтажу ФЭ по словам заказчика 25.10' }),
    row({ object: 'Офис Г', stage: 'Монтаж ФЭ \nЗавершение работ ', readiness: 90, photo: link(100003), status: 'В работе', contractor: 'Монтажники-1' }),
    row({ object: 'Гараж Е', stage: 'Разработка и согласование документации\nПодписание документов', readiness: 10, photo: link(100004), status: 'Ожидание материалов', contractor: 'Металлокаркас', comment: 'Готовность металлокаркаса 01.11' }),
    row({ object: 'Ангар В', stage: 'Ожидание приемки здания\n', readiness: 100, photo: link(100005), status: 'Впереди', contractor: 'Бригада Юг' }),
    row({ object: 'Цех К', stage: 'Подготовительные работы\nЗемляные работы\nПереговоры по временной дороге', readiness: 10, photo: link(100006), done: 'Разработка котлована\nУкладка геотекстиля\nОтсыпка песком\nТрамбовка песка\nЗавоз материалов\n', status: 'В работе', contractor: 'Металлокаркас' }),
  ],
});

// История для графиков: недели 30–41, у объектов растёт готовность и меняются статусы.
weeks.slice(0, 12).forEach((w, i) => {
  w.formedDate = w.end;
  const cap = v => Math.min(100, v);
  w.rows = [
    row({ object: 'Склад А', readiness: cap(40 + 6 * i), status: i < 10 ? 'В работе' : 'Ожидание решения', contractor: 'Бригада Юг', stage: i < 6 ? 'Монтаж каркаса' : 'Монтаж ФЭ', done: 'Монтаж панелей', comment: i === 9 ? `${dm(w.end)} заказчик принял кровлю` : '' }),
    row({ object: 'Офис Г', readiness: cap(30 + 5 * i), status: 'В работе', contractor: 'Монтажники-1', stage: 'Отделка', plan: 'Продолжение отделки' }),
    row({ object: 'Ангар В', readiness: cap(50 + 5 * i), status: i < 9 ? 'В работе' : 'Ожидание решения', contractor: 'Бригада Юг', stage: 'Благоустройство' }),
    ...(i >= 4 ? [row({ object: 'Ангар И', readiness: 10 + 6 * (i - 4), status: i < 10 ? 'В работе' : 'Приостановлено', contractor: 'Бригада Север', stage: 'Монтаж ФЭ', comment: i === 10 ? `${dm(w.start)} площадка не готова, работы остановлены` : '' })] : []),
    ...(i >= 8 ? [row({ object: 'Гараж Е', readiness: (i - 8) * 2, status: 'Впереди', contractor: 'Металлокаркас', stage: 'Согласование документации' })] : []),
    ...(i <= 6 ? [row({ object: 'Котельная Д', readiness: cap(64 + 6 * i), status: i < 6 ? 'В работе' : 'Выполнено', contractor: 'Электрики', stage: 'Пусконаладка' })] : []),
  ];
});

// ---------- Действия ----------

const actions = {
  ping: () => ({ time: new Date().toISOString(), spreadsheet: 'Демо-режим' }),
  getDirectories: () => dirs,
  getSettings: () => settings,
  saveSettings: p => (settings = { ...settings, ...(p.settings || {}) }),
  listWeeks: () => weeks.map(w => ({
    sheetName: w.sheetName, start: w.start, end: w.end, weekNumber: w.weekNumber,
    objectsCount: w.rows.filter(r => r.object).length,
  })),
  getWeek: p => {
    const i = indexOf(p.sheetName);
    return { ...full(weeks[i]), previous: brief(i) };
  },
  getAll: () => weeks.map(full),
  getHistory: () => weeks.filter(w => w.rows.length).map(w => ({
    sheetName: w.sheetName, start: w.start, end: w.end, weekNumber: w.weekNumber,
    rows: w.rows.filter(r => r.object).map(r => ({ ...r, photo: (r.photo && r.photo.links) || [] })),
  })),
  ensureWeek: p => {
    const monday = ymd(mondayOf(p.date ? parseYmd(p.date) : new Date()));
    let w = weeks.find(x => x.start === monday);
    let created = false;
    if (!w) {
      const start = parseYmd(monday);
      const fri = addDays(start, 4);
      w = { sheetName: sheetName(start, fri), start: monday, end: ymd(fri), weekNumber: isoWeek(start), capacity: CAPACITY, rows: [], summary: '', formedDate: null, version: rnd() };
      weeks.push(w);
      weeks.sort((a, b) => (a.start < b.start ? -1 : 1));
      created = true;
    }
    const i = weeks.indexOf(w);
    let carried = false;
    if (p.carryOver !== false && !w.rows.length) {
      const prev = lastFilledBefore(i);
      if (prev) {
        w.rows = prev.rows.map(r => row({ object: r.object, stage: r.stage, readiness: r.readiness, status: r.status, contractor: r.contractor }));
        w.version = rnd();
        carried = true;
      }
    }
    return { created, carried, week: { ...full(w), previous: brief(i) } };
  },
  saveWeek: p => {
    const w = weeks[indexOf(p.sheetName)];
    if (p.baseVersion && !p.force && p.baseVersion !== w.version) {
      throw { code: 'CONFLICT', message: 'Лист изменили в таблице после открытия в приложении', data: full(w) };
    }
    if (Array.isArray(p.rows)) {
      if (p.rows.length > w.capacity) {
        if (!p.expand) throw { code: 'ROWS_LIMIT', message: `На листе место на ${w.capacity} объектов, а передано ${p.rows.length}`, data: { capacity: w.capacity } };
        w.capacity = p.rows.length;
      }
      p.rows.forEach(r => {
        if (r.object && !dirs.objects.includes(r.object)) throw { code: 'BAD_VALUE', message: `Объекта «${r.object}» нет в справочнике` };
      });
      w.rows = p.rows.map(r => row({ ...r, photo: normPhoto(r.photo) }));
    }
    if (p.summary !== undefined) w.summary = p.summary;
    if (!w.formedDate) w.formedDate = ymd(new Date());
    w.version = rnd();
    return full(w);
  },
  exportPdf: p => {
    const w = weeks[indexOf(p.sheetName)];
    return { fileName: `Отчёт ${w.sheetName} (неделя ${w.weekNumber}).pdf`, mimeType: 'application/pdf', base64: demoPdf(w) };
  },
  addDirectoryItem: p => {
    const list = dirs[p.list];
    const v = String(p.value || '').trim();
    if (!v) throw { code: 'EMPTY', message: 'Пустое значение' };
    if (list.some(x => x.toLowerCase() === v.toLowerCase())) throw { code: 'DUPLICATE', message: 'Уже есть в списке: ' + v };
    list.push(v);
    return dirs;
  },
  renameDirectoryItem: p => {
    const list = dirs[p.list];
    const i = list.indexOf(p.from);
    if (i < 0) throw { code: 'NOT_FOUND', message: 'Нет в списке: ' + p.from };
    list[i] = p.to;
    let replaced = 0;
    if (p.applyToWeeks) {
      const f = p.list === 'objects' ? 'object' : 'contractor';
      weeks.forEach(w => w.rows.forEach(r => { if (r[f] === p.from) { r[f] = p.to; replaced++; } }));
    }
    dirs.hidden[p.list] = dirs.hidden[p.list].map(v => (v === p.from ? p.to : v));
    return { ...dirs, replaced };
  },
  setHidden: p => {
    const h = dirs.hidden[p.list].filter(v => v !== p.value);
    if (p.hidden) h.push(p.value);
    dirs.hidden[p.list] = h;
    return dirs;
  },
};

export async function mockCall(action, params) {
  await new Promise(r => setTimeout(r, 250));
  const fn = actions[action];
  if (!fn) throw Object.assign(new Error('Неизвестное действие: ' + action), { code: 'UNKNOWN_ACTION' });
  try {
    return JSON.parse(JSON.stringify(fn(params || {})));
  } catch (e) {
    throw Object.assign(new Error(e.message), { code: e.code || 'ERROR', data: e.data });
  }
}

// ---------- Вспомогательное ----------

function full(w) {
  const rows = w.rows.map((r, i) => ({ row: 9 + i, ...r }));
  const nums = rows.map(r => r.readiness).filter(v => v !== null && v !== '');
  return {
    sheetName: w.sheetName, start: w.start, end: w.end, weekNumber: w.weekNumber,
    title: `${settings.company} · Еженедельный отчёт · Неделя ${w.weekNumber}`,
    engineer: settings.engineer, formedDate: w.formedDate,
    objectsCount: rows.filter(r => r.object).length,
    avgReadiness: nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length * 10) / 10 : 0,
    capacity: w.capacity, rows,
    statusCounts: dirs.statuses.map(s => ({ status: s, count: rows.filter(r => r.status === s).length })),
    summary: w.summary, version: w.version,
  };
}

function brief(i) {
  const prev = lastFilledBefore(i);
  if (!prev) return null;
  return {
    sheetName: prev.sheetName, start: prev.start,
    rows: prev.rows.map(r => ({ object: r.object, readiness: r.readiness, status: r.status, plan: r.plan })),
  };
}

function lastFilledBefore(i) {
  for (let j = i - 1; j >= 0; j--) if (weeks[j].rows.length) return weeks[j];
  return null;
}

/** Одностраничный PDF-заглушка (латиница: стандартный шрифт без кириллицы). */
function demoPdf(w) {
  const lines = [`Demo report - week ${w.weekNumber} (${w.start} - ${w.end})`, `Objects: ${w.rows.filter(r => r.object).length}`,
    'In real mode this is the sheet exported from Google Sheets.'];
  const stream = 'BT /F1 18 Tf 60 520 Td 26 TL ' + lines.map(l => `(${l.replace(/[()\\]/g, '')}) Tj T*`).join(' ') + ' ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return btoa(pdf);
}

function normPhoto(p) {
  if (!p) return noPhoto();
  if (typeof p === 'string') return { text: p, links: /^https?:\/\//.test(p) ? [{ label: p, url: p }] : [] };
  const links = p.links || [];
  return { text: links.length ? links.map(l => l.label).join(', ') : (p.text || ''), links };
}

function indexOf(name) {
  const i = weeks.findIndex(w => w.sheetName === name);
  if (i < 0) throw { code: 'NOT_FOUND', message: 'Нет недельного листа «' + name + '»' };
  return i;
}

function byStart(start) { return weeks.find(w => w.start === start); }
function rnd() { return Math.random().toString(16).slice(2); }
function pad(n) { return String(n).padStart(2, '0'); }
function dm(s) { return `${s.slice(8, 10)}.${s.slice(5, 7)}`; }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
function mondayOf(d) { return addDays(d, -((d.getDay() + 6) % 7)); }
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7);
}
function sheetName(mon, fri) {
  const m1 = MONTHS[mon.getMonth()];
  const m2 = MONTHS[fri.getMonth()];
  return m1 === m2 ? `${m1} ${mon.getDate()}-${fri.getDate()}` : `${m1} ${mon.getDate()} - ${m2} ${fri.getDate()}`;
}
