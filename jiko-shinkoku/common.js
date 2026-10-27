/* =========================================================
   自己申告 試用版 共通処理（ふれあいしおどめ保育園）
   職員用 index.html と 事務・園長用 encho.html の両方で使う
   ========================================================= */
const JK = {
  // ↓ GASをデプロイしたら、そのURL（/exec で終わる）を '' の中に貼る。
  //   空のままだと「お試しモード」（この端末のブラウザの中だけに保存）で動く。
  GAS_URL: 'https://script.google.com/macros/s/AKfycbxDo2C4wiZKgDlwemLO_9CynXuSI05PwWNg8UuYTsmwUuppUvgGSFnvtqDRlds9mj4N/exec',
  TOKEN: 'fureai_jiko_2026',          // GAS側の TOKEN と同じ文字にする
  GARDEN: 'fureai_shiodome',          // 園キー
  FACILITY_CODE: 'S09',               // 職員マスタの施設コード（ふれあいしおどめ保育園）
  SHIFT_URL: '../index.html',         // シフトデータを読む元（職員ダッシュボード本体）
  // 2026-10-27：シフトの読み込み元（'file'＝上の index.html の埋め込み／'gas'＝ログイン用GASから受け取る）
  //   切り替え日に職員ダッシュボード（../index.html）と一緒に 'gas' にする。?shiftsrc=gas で試せる
  SHIFT_SRC: 'gas',
  LOGIN_GAS: 'https://script.google.com/macros/s/AKfycbwnTzHQ5XdHPPLdf9QnWJLA-Dc7oBIYzfr1MfFd-Uunyarw0QWc48WzzAme6hR1muBisg/exec',
  GARDEN_NAME: 'ふれあいしおどめ保育園',
  MIN_STEP: 15,                       // 分の刻み（1・5・10・15 など）
  PART_KINDS: ['出勤', '公休', '希望休', '有休', '特休'],
  SEI_KINDS: ['出勤', '公休', '希望休', '有休', '特休', '欠勤'],
  SEI_EXTRAS: ['時間有休', '残業', '遅刻', '早退'],
  LOCAL_KEY: 'jiko_shinkoku_demo_v1',
  // 職員マスタ（2026/10/04 取込）の写し。GASが使えるときは、GASが職員マスタを直接読んだ内容を優先する。
  // 雇用区分「正規」→正規、「非正規・派遣」→パート、対象外（育休など）がTRUE→対象外
  // 正規職員のうち、駐車場が日割り対象の人（固定。事務の設定がなくても駐車場ボタンを出す）
  PARKING_FIXED: ['井波美由紀', '登坂恵美子'],
  MASTER_FALLBACK: {
    '青木真登香': 'パート', '阿部佳奈子': 'パート', '伊﨑千亜紀': 'パート', '稲浪菫花': 'パート', '井波美由紀': '正規',
    '岩﨑愛': '正規', '植村郁子': 'パート', '内山典子': 'パート', '遠藤咲': '正規', '大川原昌子': 'パート',
    '勝村絵里菜': '正規', '栗原美晴': 'パート', '霜田侑花': '正規', '下野結桂子': 'パート', '鈴木マユミ': 'パート',
    '背黒美波': '正規', '高橋歩実': '正規', '高橋佳子': '正規', '土居悦子': 'パート', '登坂恵美子': '正規',
    '中﨑杏奈': '対象外', '長妻理紗': 'パート', '成田麻里': '正規', '野村瑛美子': '対象外', '橋本奈千加': '正規',
    '町田美明': 'パート', '宮本聡美': '対象外', '谷田貝実加': 'パート', '山口由美': 'パート', '山本晴奈': 'パート',
    '渡邊裕里子': '正規'
  }
};
function nkey(name) { return String(name || '').replace(/[\s\u3000]/g, ''); }

/* ---------- 職員ごとの設定（事務の手入力 ＞ 職員マスタ ＞ 初期値） ---------- */
// G = groupLoad の結果、staff = シフトの職員、shift = loadShift の結果
function effSetting(name, G, staff, shift) {
  const man = (G && G.set && G.set[name]) || {};
  const mk = (G && G.master && G.master[nkey(name)]) || JK.MASTER_FALLBACK[nkey(name)] || '';
  const kubun = man.kubun || mk || 'パート';
  const kubunSrc = man.kubun ? '事務' : (mk ? '職員マスタ' : '初期値');
  const avg = staff && shift ? avgWorkMin(shift, staff) : 0;
  const yukyuMin = +man.yukyuMin > 0 ? +man.yukyuMin : avg;
  return { kubun, kubunSrc, masterKubun: mk, parking: !!man.parking || JK.PARKING_FIXED.indexOf(nkey(name)) >= 0, parkingFixed: JK.PARKING_FIXED.indexOf(nkey(name)) >= 0, yukyuMin, yukyuSrc: +man.yukyuMin > 0 ? '事務' : '自動', avgMin: avg };
}
// その期間の勤務日の実働の平均（有休・特休1日分の時間に使う）
function avgWorkMin(shift, staff) {
  let sum = 0, n = 0;
  shift.dates.forEach((d) => { const sh = staff.shifts[d.iso]; if (sh && (sh.state === 'work' || sh.state === 'training')) { const p = planMin(sh.time); if (p > 0) { sum += p; n++; } } });
  return n ? Math.round(sum / n) : 0;
}

/* ---------- 時間の計算 ---------- */
// 休憩（試用版の仮ルール）：拘束6時間超→45分、8時間超→60分を引く
function breakMin(span) { return span > 480 ? 60 : (span > 360 ? 45 : 0); }
// "8:30-17:30" → 実働の分
function planMin(time) {
  const m = /(\d{1,2}):(\d{2})\s*[-〜~～]\s*(\d{1,2}):(\d{2})/.exec(time || '');
  if (!m) return 0;
  const span = (+m[3] * 60 + +m[4]) - (+m[1] * 60 + +m[2]);
  if (span <= 0) return 0;
  return span - breakMin(span);
}
function fmtHM(min) {
  min = Math.round(min || 0);
  const sg = min < 0 ? '−' : '';
  const a = Math.abs(min);
  return sg + Math.floor(a / 60) + ':' + String(a % 60).padStart(2, '0');
}
function fmtJP(min) {
  const a = Math.abs(Math.round(min || 0));
  return Math.floor(a / 60) + '時間' + String(a % 60).padStart(2, '0') + '分';
}
function toHours(min) { return Math.round((min || 0) / 60 * 100) / 100; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dowClass(dow) { return dow === '日' ? 'sun' : dow === '土' ? 'sat' : ''; }

/* ---------- シフトデータの読み込み（職員ダッシュボード本体の DATA を使う） ---------- */
/* 2026-10-27：シフトの読み込み元を決める（URL → 埋め込み元の職員ダッシュボード → 開いた元 → JK.SHIFT_SRC） */
function shiftSrc() {
  try { const q = new URLSearchParams(location.search).get('shiftsrc'); if (q === 'gas' || q === 'file') return q; } catch (e) {}
  try { if (window.parent !== window && window.parent.SD_SHIFT_SRC) return window.parent.SD_SHIFT_SRC; } catch (e) {}
  try { if (window.opener && window.opener.SD_SHIFT_SRC) return window.opener.SD_SHIFT_SRC; } catch (e) {}
  return JK.SHIFT_SRC;
}
/* GASモード：職員ダッシュボードが保存したシフト → 無ければ通行証でGASから受け取る */
async function loadShiftFromGas() {
  const CKEY = 'sd_shift_cache__' + JK.GARDEN;
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const s = read('sd_pin_login__' + JK.GARDEN_NAME), h = read('sd_honbu_token');
  const token = (s && s.token) || (h && h.token) || '';
  if (token) {
    try {
      const r = await fetch(JK.LOGIN_GAS, { method: 'POST', body: JSON.stringify({ action: 'shift', token: token, garden: JK.GARDEN_NAME }), redirect: 'follow' });
      const res = await r.json();
      if (res && res.ok && res.data) {
        try { localStorage.setItem(CKEY, JSON.stringify({ key: JK.GARDEN, at: Date.now(), data: res.data })); } catch (e) {}
        return res.data;
      }
    } catch (e) {}
  }
  const c = read(CKEY);
  if (c && c.data) return c.data;
  throw new Error('シフトを読み込めませんでした。職員ダッシュボードにログインしてから、もう一度開いてください');
}
async function loadShift() {
  const data = shiftSrc() === 'gas' ? await loadShiftFromGas() : await loadShiftFromFile();
  return shapeShift(data);
}
async function loadShiftFromFile() {
  const res = await fetch(JK.SHIFT_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('シフトデータを読めませんでした（' + res.status + '）');
  const s = await res.text();
  const key = 'const DATA = ';
  const i = s.indexOf(key);
  if (i < 0) throw new Error('シフトデータが見つかりませんでした');
  const st = i + key.length;
  let depth = 0, inStr = false, escp = false, end = -1;
  for (let j = st; j < s.length; j++) {
    const ch = s[j];
    if (inStr) { if (escp) escp = false; else if (ch === '\\') escp = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  return JSON.parse(s.slice(st, end + 1));
}
function shapeShift(data) {
  const dates = data.dates.map((d) => ({ iso: d.iso, md: d.md, dow: d.dow, event: d.event || '' }));
  const staff = data.staff.map((p) => {
    const m = {}; (p.shifts || []).forEach((x) => { m[x.iso] = x; });
    return { name: p.name, shifts: m };
  });
  return {
    facility: data.facility || '', label: (data.period && data.period.label) || '',
    start: dates[0].md, end: dates[dates.length - 1].md, pid: dates[0].iso, dates, staff
  };
}
function shiftText(sh) {
  if (!sh) return 'シフトなし';
  if (sh.state === 'work' || sh.state === 'training') return (sh.cat || '勤務') + ' ' + (sh.time || '');
  return sh.code || sh.cat || '休み';
}
// シフトから、はじめに選んでおく区分を決める（本人が変えられる）
function defaultKind(sh, kubun) {
  if (!sh) return '';
  const code = (sh.code || '').replace(/\s/g, '');
  if (sh.state === 'work' || sh.state === 'training') return '出勤';
  if (code === '夏休') return '特休';
  if (code.indexOf('有休') >= 0 || sh.state === 'leave') return '有休';
  if (code === '希望休') return '希望休';
  if (code === '欠勤') return kubun === '正規' ? '欠勤' : '';
  if (code === '育休') return '';
  return '公休';
}
// 有休・特休の日に支給する時間（シフトに時間があればそれ、なければ職員設定の値）
function leavePlanMin(sh, setting) {
  const p = planMin(sh && sh.time);
  if (p > 0) return p;
  return (setting && +setting.yukyuMin) || 0;
}

/* ---------- 集計 ---------- */
function calcStaff(shift, staff, recMap, setting, confirmed) {
  const kubun = (setting && setting.kubun) || 'パート';
  const today = todayIso();
  const t = { kubun, n: shift.dates.length, done: 0, missing: [], pastMissing: 0, warn: [],
    c: { '出勤': 0, '公休': 0, '希望休': 0, '有休': 0, '特休': 0, '欠勤': 0 },
    plan: 0, diff: 0, work: 0, kyu: 0, chu: 0, yh: 0, ot: 0, late: 0, early: 0 };
  shift.dates.forEach((d) => {
    const r = recMap[d.iso];
    const sh = staff.shifts[d.iso];
    if (!r || !r.kind) { t.missing.push(d.iso); if (d.iso <= today) t.pastMissing++; return; }
    t.done++;
    t.c[r.kind] = (t.c[r.kind] || 0) + 1;
    if (r.kind === '出勤') {
      const p = planMin(sh && (sh.state === 'work' || sh.state === 'training') ? sh.time : '');
      t.plan += p;
      if (r.mode === 'edit') t.diff += (+r.min || 0) - p;
      t.work += r.mode === 'edit' ? (+r.min || 0) : p;
      if (r.kyu === 'yes') t.kyu++;
      if (r.chu === 'yes') t.chu++;
      t.yh += +r.yh || 0; t.ot += +r.ot || 0; t.late += +r.late || 0; t.early += +r.early || 0;
    } else if (r.kind === '有休' || r.kind === '特休') {
      const p = leavePlanMin(sh, setting);
      if (kubun === 'パート') { t.plan += p; if (!p) t.warn.push(d.md + 'の' + r.kind + 'の時間が決まりません'); }
    }
  });
  t.status = confirmed ? '確定' : (t.missing.length === 0 ? '入力完了' : (t.pastMissing > 0 ? '未申告あり' : '入力中'));
  return t;
}
function statusBadge(st) {
  if (st === '対象外') return '<span class="badge" style="background:#ecebe6;color:#57564f">対象外</span>';
  const cls = st === '確定' ? 'b-ok' : st === '未申告あり' ? 'b-ng' : st === '入力完了' ? 'b-blue' : 'b-mid';
  return '<span class="badge ' + cls + '">' + esc(st) + '</span>';
}

/* ---------- 保存先（GAS か、お試しモードの端末保存） ---------- */
function isDemo() { return !JK.GAS_URL; }
function lsGet() { try { return JSON.parse(localStorage.getItem(JK.LOCAL_KEY)) || { recs: {}, conf: {}, set: {} }; } catch (e) { return { recs: {}, conf: {}, set: {} }; } }
function lsPut(db) { try { localStorage.setItem(JK.LOCAL_KEY, JSON.stringify(db)); } catch (e) {} }
function localApi(action, b) {
  const db = lsGet();
  const k = (n) => JK.GARDEN + '|' + b.pid + '|' + n;
  if (action === 'load') {
    const recs = [], conf = [], settings = [];
    Object.keys(db.recs).forEach((key) => {
      const [g, pid, name] = key.split('|');
      if (g !== JK.GARDEN || pid !== b.pid || (b.name && b.name !== name)) return;
      Object.keys(db.recs[key]).forEach((iso) => recs.push(Object.assign({ name, date: iso }, db.recs[key][iso])));
    });
    Object.keys(db.conf).forEach((key) => {
      const [g, pid, name] = key.split('|');
      if (g === JK.GARDEN && pid === b.pid && (!b.name || b.name === name)) conf.push({ name, at: db.conf[key] });
    });
    Object.keys(db.set).forEach((key) => {
      const [g, name] = key.split('|');
      if (g === JK.GARDEN) settings.push(Object.assign({ name }, db.set[key]));
    });
    return { ok: true, recs, conf, settings };
  }
  if (action === 'save') {
    if (db.conf[k(b.name)] && b.by !== '事務') return { ok: false, error: '確定済みのため変更できません' };
    db.recs[k(b.name)] = db.recs[k(b.name)] || {};
    db.recs[k(b.name)][b.rec.date] = Object.assign({}, b.rec, { by: b.by, ts: new Date().toISOString() });
    lsPut(db); return { ok: true };
  }
  if (action === 'confirm') { db.conf[k(b.name)] = new Date().toISOString(); lsPut(db); return { ok: true }; }
  if (action === 'unconfirm') { delete db.conf[k(b.name)]; lsPut(db); return { ok: true }; }
  if (action === 'setting') { db.set[JK.GARDEN + '|' + b.name] = b.setting; lsPut(db); return { ok: true }; }
  return { ok: false, error: 'unknown' };
}
async function api(action, body) {
  body = body || {};
  if (isDemo()) {
    const r = localApi(action, body);
    if (!r.ok) throw new Error(r.error);
    return r;
  }
  const res = await fetch(JK.GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action, token: JK.TOKEN, garden: JK.GARDEN, facility: JK.FACILITY_CODE }, body))
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || '保存先でエラーが起きました');
  return j;
}
// load の結果を { name: { iso: rec } } の形にまとめる
function groupLoad(r) {
  const recs = {}, conf = {}, set = {}, master = {};
  (r.recs || []).forEach((x) => { (recs[x.name] = recs[x.name] || {})[x.date] = x; });
  (r.conf || []).forEach((x) => { conf[x.name] = x.at; });
  (r.settings || []).forEach((x) => { set[x.name] = x; });
  (r.master || []).forEach((x) => { if (x.kubun) master[nkey(x.name)] = x.kubun; });
  return { recs, conf, set, master };
}

/* ---------- 1日の申告フォーム ---------- */
function hourOpts(from, to, cur) {
  let h = ''; for (let i = from; i <= to; i++) h += '<option value="' + i + '"' + (String(cur) === String(i) ? ' selected' : '') + '>' + i + '</option>';
  return h;
}
function minOpts(cur) {
  let h = ''; for (let i = 0; i < 60; i += JK.MIN_STEP) { const v = String(i).padStart(2, '0'); h += '<option value="' + v + '"' + (String(cur) === v ? ' selected' : '') + '>' + v + '</option>'; }
  return h;
}
function splitMin(min) { min = +min || 0; return { h: String(Math.floor(min / 60)), m: String(Math.round(min % 60 / JK.MIN_STEP) * JK.MIN_STEP % 60).padStart(2, '0') }; }

/*
  ctx = { pid, name, kubun, parking, date:{iso,md,dow,event}, sh, rec, locked, by, onSaved }
*/
function renderForm(el, ctx) {
  const p = planMin(ctx.sh && (ctx.sh.state === 'work' || ctx.sh.state === 'training') ? ctx.sh.time : '');
  const r = ctx.rec || {};
  const sp = splitMin(r.mode === 'edit' ? r.min : p);
  const st = {
    kind: r.kind || defaultKind(ctx.sh, ctx.kubun),
    mode: r.mode || (p > 0 ? 'plan' : 'edit'),
    h: sp.h, m: sp.m,
    kyu: r.kyu || '', chu: r.chu || '',
    ex: { '時間有休': +r.yh > 0, '残業': +r.ot > 0, '遅刻': +r.late > 0, '早退': +r.early > 0 },
    yh: String(+r.yh || 1),
    ot: splitMin(r.ot), late: splitMin(r.late), early: splitMin(r.early),
    err: '', msg: ''
  };
  if (p === 0) st.mode = 'edit';
  const lock = !!ctx.locked;
  const dis = lock ? ' disabled' : '';
  const kinds = ctx.kubun === '正規' ? JK.SEI_KINDS : JK.PART_KINDS;

  function pill(label, key, noTxt, yesTxt) {
    return '<div class="row"><span class="ic">' + label + '</span><div class="pill" role="group" aria-label="' + label + '">' +
      '<button type="button" data-act="' + key + '" data-v="no" class="no' + (st[key] === 'no' ? ' on' : '') + '" aria-pressed="' + (st[key] === 'no') + '"' + dis + '>' + noTxt + '</button>' +
      '<button type="button" data-act="' + key + '" data-v="yes" class="yes' + (st[key] === 'yes' ? ' on' : '') + '" aria-pressed="' + (st[key] === 'yes') + '"' + dis + '>' + yesTxt + '</button></div></div>';
  }
  function timeRow(label, key, note) {
    return '<div class="timebox"><span class="tl">' + label + (note ? '<br><span style="font-size:11px;font-weight:400;color:#4a4a46">' + note + '</span>' : '') + '</span>' +
      '<select data-f="' + key + '.h" aria-label="' + label + 'の時間"' + dis + '>' + hourOpts(0, 5, st[key].h) + '</select><span>時間</span>' +
      '<select data-f="' + key + '.m" aria-label="' + label + 'の分"' + dis + '>' + minOpts(st[key].m) + '</select><span>分</span></div>';
  }
  function summary() {
    if (!st.kind) return '区分を選んでください';
    const a = [st.kind];
    if (st.kind === '出勤') {
      if (ctx.kubun === '正規') {
        if (st.ex['時間有休']) a.push('時間有休 ' + st.yh + '時間');
        ['残業', '遅刻', '早退'].forEach((k) => { const o = st[{ '残業': 'ot', '遅刻': 'late', '早退': 'early' }[k]]; if (st.ex[k]) a.push(k + ' ' + o.h + '時間' + o.m + '分'); });
        if (ctx.parking) a.push('駐車場 ' + (st.chu === 'yes' ? '利用' : st.chu === 'no' ? '利用なし' : '未選択'));
      } else {
        a.push('勤務 ' + (st.mode === 'plan' ? fmtJP(p) + '（予定どおり）' : st.h + '時間' + st.m + '分'));
        a.push('給食 ' + (st.kyu === 'yes' ? '食べた' : st.kyu === 'no' ? '食べない' : '未選択'));
        a.push('駐車場 ' + (st.chu === 'yes' ? '利用' : st.chu === 'no' ? '利用なし' : '未選択'));
      }
    }
    return a.join(' ／ ');
  }
  function html() {
    let h = '<div class="box"><div class="row"><h3>' + esc(ctx.date.md) + '（' + esc(ctx.date.dow) + '）の申告</h3>' +
      (lock ? '<span class="badge b-ok">確定済み</span>' : (ctx.rec ? '<span class="badge b-ok">申告済み</span>' : '<span class="badge b-ng">未申告</span>')) + '</div>';
    h += '<div class="muted">シフト：' + esc(shiftText(ctx.sh)) + (p ? '（実働 ' + fmtJP(p) + '）' : '') + (ctx.date.event ? '<br>行事：' + esc(ctx.date.event) : '') + '</div>';
    h += '<div class="chips">' + kinds.map((k) => '<button type="button" class="chip' + (st.kind === k ? ' on' : '') + '" data-act="kind" data-v="' + k + '" aria-pressed="' + (st.kind === k) + '"' + dis + '>' + k + '</button>').join('') + '</div>';
    if (st.kind === '出勤') {
      if (ctx.kubun === '正規') {
        h += '<div><div class="lbl">あてはまるものがあれば選ぶ（複数可）</div><div class="chips">' +
          JK.SEI_EXTRAS.map((k) => '<button type="button" class="chip' + (st.ex[k] ? ' on' : '') + '" data-act="ex" data-v="' + k + '" aria-pressed="' + !!st.ex[k] + '"' + dis + '>' + k + '</button>').join('') + '</div></div>';
        if (st.ex['時間有休']) h += '<div class="timebox"><span class="tl">時間有休</span><select data-f="yh" aria-label="時間有休の時間"' + dis + '>' + hourOpts(1, 7, st.yh) + '</select><span>時間</span></div>';
        if (st.ex['残業']) h += timeRow('残業', 'ot');
        if (st.ex['遅刻']) h += timeRow('遅刻', 'late', '時間有休を使った分は含めません');
        if (st.ex['早退']) h += timeRow('早退', 'early', '時間有休を使った分は含めません');
        if (ctx.parking) h += '<div style="height:1px;background:#d6dcef"></div>' + pill('駐車場', 'chu', '利用なし', '利用');
      } else {
        h += '<div><div class="lbl">勤務実績</div><div class="chips">' +
          '<button type="button" class="chip' + (st.mode === 'plan' ? ' on' : '') + '" data-act="mode" data-v="plan"' + (p ? dis : ' disabled') + '>予定どおり' + (p ? '（' + fmtJP(p) + '）' : '') + '</button>' +
          '<button type="button" class="chip' + (st.mode === 'edit' ? ' on' : '') + '" data-act="mode" data-v="edit"' + dis + '>時間を変更</button></div>' +
          (p ? '' : '<div class="muted" style="margin-top:6px">この日はシフトに勤務時間がないので、働いた時間を入れてください。</div>') + '</div>';
        if (st.mode === 'edit') h += '<div class="timebox"><span class="tl">働いた時間<br><span style="font-size:11px;font-weight:400;color:#4a4a46">休憩を除いた時間</span></span><select data-f="h" aria-label="時間"' + dis + '>' + hourOpts(0, 12, st.h) + '</select><span>時間</span><select data-f="m" aria-label="分"' + dis + '>' + minOpts(st.m) + '</select><span>分</span></div>';
        h += '<div style="height:1px;background:#d6dcef"></div>' + pill('給食', 'kyu', '食べない', '食べた') + pill('駐車場', 'chu', '利用なし', '利用');
      }
    } else if (st.kind) {
      h += '<div class="note">休暇の日は、ほかの入力はいりません。</div>';
    }
    h += '<div class="sum"><span style="color:#4a4a46">申告内容：</span><b>' + esc(summary()) + '</b></div>';
    if (!lock) h += '<button type="button" class="btn" data-act="save">この内容で申告</button>';
    h += '<div class="err" role="alert">' + esc(st.err) + '</div>' + (st.msg ? '<div class="okmsg">' + esc(st.msg) + '</div>' : '') + '</div>';
    return h;
  }
  function draw() { el.innerHTML = html(); }
  function build() {
    const rec = { date: ctx.date.iso, kind: st.kind, mode: '', min: 0, kyu: 'no', chu: 'no', yh: 0, ot: 0, late: 0, early: 0 };
    if (st.kind === '出勤') {
      if (ctx.kubun === '正規') {
        rec.yh = st.ex['時間有休'] ? +st.yh : 0;
        rec.ot = st.ex['残業'] ? (+st.ot.h * 60 + +st.ot.m) : 0;
        rec.late = st.ex['遅刻'] ? (+st.late.h * 60 + +st.late.m) : 0;
        rec.early = st.ex['早退'] ? (+st.early.h * 60 + +st.early.m) : 0;
        rec.kyu = '';
        rec.chu = ctx.parking ? st.chu : '';
      } else {
        rec.mode = st.mode;
        rec.min = st.mode === 'edit' ? (+st.h * 60 + +st.m) : p;
        rec.kyu = st.kyu; rec.chu = st.chu;
      }
    } else if (ctx.kubun === '正規') { rec.kyu = ''; rec.chu = ctx.parking ? 'no' : ''; }
    return rec;
  }
  function validate() {
    if (!st.kind) return '区分を選んでください';
    if (st.kind !== '出勤') return '';
    if (ctx.kubun === '正規') {
      for (const [k, f] of [['残業', 'ot'], ['遅刻', 'late'], ['早退', 'early']]) if (st.ex[k] && +st[f].h === 0 && +st[f].m === 0) return k + 'の時間を入れてください';
      if (ctx.parking && !st.chu) return '駐車場の「利用なし／利用」を選んでください';
    } else {
      if (st.mode === 'edit' && +st.h === 0 && +st.m === 0) return '働いた時間を入れてください';
      if (!st.kyu || !st.chu) return '給食と駐車場の両方を選んでください';
    }
    return '';
  }
  async function save() {
    const e = validate();
    if (e) { st.err = e; st.msg = ''; draw(); return; }
    st.err = ''; st.msg = '保存しています…'; draw();
    try {
      const rec = build();
      await api('save', { pid: ctx.pid, name: ctx.name, rec, by: ctx.by });
      st.msg = '申告しました';
      if (ctx.onSaved) ctx.onSaved(rec); else draw();
    } catch (er) { st.msg = ''; st.err = er.message; draw(); }
  }
  el.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || lock) return;
    const a = b.dataset.act, v = b.dataset.v;
    st.err = ''; st.msg = '';
    if (a === 'save') { save(); return; }
    if (a === 'kind') st.kind = v;
    else if (a === 'mode') st.mode = v;
    else if (a === 'kyu' || a === 'chu') st[a] = v;
    else if (a === 'ex') st.ex[v] = !st.ex[v];
    draw();
  };
  el.onchange = (e) => {
    const s = e.target.closest('select[data-f]');
    if (!s) return;
    const f = s.dataset.f.split('.');
    if (f.length === 2) st[f[0]][f[1]] = s.value; else st[f[0]] = s.value;
    st.err = ''; st.msg = '';
    draw();
  };
  draw();
}

/* ---------- 1か月の表 ---------- */
function monthTableHTML(shift, staff, recMap, kubun, parking) {
  const today = todayIso();
  let h = '<div class="tblwrap"><table class="mt"><thead><tr><th>日付</th><th>シフト</th><th>区分</th>';
  h += kubun === '正規' ? '<th>時有</th><th>残業</th><th>遅刻</th><th>早退</th>' + (parking ? '<th>駐車</th>' : '') : '<th>勤務</th><th>給食</th><th>駐車</th>';
  h += '</tr></thead><tbody>';
  shift.dates.forEach((d) => {
    const r = recMap[d.iso], sh = staff.shifts[d.iso];
    const cls = (d.iso === today ? 'today ' : '') + (!r && d.iso <= today ? 'miss ' : '') + 'click';
    h += '<tr class="' + cls + '" data-date="' + d.iso + '"><td><b class="' + dowClass(d.dow) + '">' + esc(d.md) + ' ' + esc(d.dow) + '</b></td><td style="font-size:12px;color:#4a4a46">' + esc(shiftText(sh)) + '</td>';
    if (!r) {
      const cols = kubun === '正規' ? (parking ? 5 : 4) : 3;
      h += '<td colspan="' + (cols + 1) + '" style="color:' + (d.iso <= today ? '#b3261e' : '#8a8a85') + ';font-weight:700">' + (d.iso <= today ? '未申告（押して入力）' : '—') + '</td></tr>';
      return;
    }
    h += '<td><b>' + esc(r.kind) + '</b></td>';
    const w = r.kind === '出勤';
    if (kubun === '正規') {
      h += '<td class="num">' + (w && +r.yh ? r.yh + 'h' : '') + '</td><td class="num">' + (w && +r.ot ? fmtHM(r.ot) : '') + '</td><td class="num">' + (w && +r.late ? fmtHM(r.late) : '') + '</td><td class="num">' + (w && +r.early ? fmtHM(r.early) : '') + '</td>' + (parking ? '<td>' + (r.chu === 'yes' ? '○' : '') + '</td>' : '');
    } else {
      h += '<td class="num">' + (w ? fmtHM(r.min) + (r.mode === 'edit' ? '<span style="font-size:11px;color:#2a49a8"> 変更</span>' : '') : '') + '</td><td>' + (r.kyu === 'yes' ? '○' : '') + '</td><td>' + (r.chu === 'yes' ? '○' : '') + '</td>';
    }
    h += '</tr>';
  });
  return h + '</tbody></table></div>';
}
function statsHTML(t) {
  const cells = t.kubun === '正規'
    ? [[fmtHM(t.ot), '残業合計'], [t.c['有休'] + '日 ' + t.yh + 'h', '有休・時間有休'], [fmtHM(t.late + t.early), '遅刻・早退']]
    : [[fmtHM(t.work), '勤務合計'], [t.kyu + '回', '給食'], [t.chu + '回', '駐車場']];
  return '<div class="stats">' + cells.map((c) => '<div><b>' + esc(c[0]) + '</b><span>' + c[1] + '</span></div>').join('') +
    '<div><b class="r">' + t.missing.length + '日</b><span>未申告</span></div></div>';
}
