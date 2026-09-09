// ★ アプリ名: UQチェック（変更する場合は各HTMLの<title>とhd-titleを修正）
// ============================================================
// GAS（Google Apps Script）バックエンド接続
// ============================================================
const GAS_URL = 'https://script.google.com/macros/s/AKfycbyLt4nDzttOHvJlPtgOuQix3Gcq30S5x2KNvdD6ujCcw8Q92l4QhNWqpqgPGu-0DFVi1A/exec';

const API = {
  // ------------------------------------------------------------
  // 低レベル呼び出し（v3：拡張機能対策）
  //  1) まず通常の fetch でデータを取得する。
  //     → fetch は <script> タグを注入しないため、広告ブロック等の
  //       拡張機能に止められにくい（今回の「承認待ちが空」問題の対策）。
  //  2) 万一 fetch がブロック/失敗した場合の"保険"として、従来の JSONP を試す。
  //  3) どちらも失敗したら例外を投げる（＝本当に通信できない）。
  //     → 呼び出し側（syncFromGAS）が検知して、画面に通信エラーを表示できる。
  // ------------------------------------------------------------
  async request(params) {
    try {
      const text = await this._fetchText(params);
      return this._parse(text);
    } catch (fetchErr) {
      // fetch がダメだったときだけ JSONP を試す（これも失敗すれば例外が伝播する）
      return await this.jsonp(params);
    }
  },

  // 通常の fetch で取得。callback付きで呼ぶ＝GASが必ずデータを返す既知の形。
  // （中身は cb({...}) で包まれて返るので、_parse で取り出す）
  async _fetchText(params) {
    const query = new URLSearchParams({ ...params, callback: 'cb' }).toString();
    const res = await fetch(GAS_URL + '?' + query, { method: 'GET', redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  },

  // GASの応答から中身を取り出す（純粋なJSONでも、cb({...})形式でも対応）
  _parse(text) {
    const t = (text || '').trim();
    const m = t.match(/^[\w$]+\s*\(([\s\S]*)\)\s*;?$/); // cb({...}) を剥がす
    return JSON.parse(m ? m[1] : t);
  },

  // 保険用の従来方式（<script>タグ注入。拡張機能に止められることがある）
  jsonp(params) {
    return new Promise((resolve, reject) => {
      const cb = 'cb_' + Date.now() + '_' + Math.floor(Math.random()*100000);
      const script = document.createElement('script');
      const query = new URLSearchParams({...params, callback: cb}).toString();
      script.src = GAS_URL + '?' + query;
      script.onerror = () => { delete window[cb]; reject(new Error('JSONP error')); };
      window[cb] = (data) => {
        delete window[cb];
        if (script.parentNode) document.head.removeChild(script);
        resolve(data);
      };
      document.head.appendChild(script);
      setTimeout(() => {
        if (window[cb]) { delete window[cb]; reject(new Error('timeout')); }
      }, 15000);
    });
  },

  async getStaff(garden) {
    try { const r = await this.request({action:'getStaff', garden: garden||''}); return r.ok ? r.data : []; }
    catch(e) { return []; }
  },
  async getRequests(staffId, garden) {
    try { const r = await this.request({action:'getRequests', staffId: staffId||'', garden: garden||''}); return r.ok ? r.data : []; }
    catch(e) { return []; }
  },
  async getPending(garden) {
    try { const r = await this.request({action:'getPending', garden: garden||''}); return r.ok ? r.data : []; }
    catch(e) { return []; }
  },
  async addRequest(data) {
    try { return await this.request({action:'addRequest', data: JSON.stringify(data)}); }
    catch(e) { return {ok:false, error:e.message}; }
  },
  async approveRequest(reqId, approver, garden) {
    try { return await this.request({action:'approveRequest', reqId, approver, garden: garden||''}); }
    catch(e) { return {ok:false, error:e.message}; }
  },
  async rejectRequest(reqId, approver, reason, garden) {
    try { return await this.request({action:'rejectRequest', reqId, approver, reason: reason||'', garden: garden||''}); }
    catch(e) { return {ok:false, error:e.message}; }
  },
};

// URLの ?garden=園名 パラメータを取得（園長画面など、園ごとにアクセスを絞りたい画面で使用）
function getUrlGarden(){
  return new URLSearchParams(location.search).get('garden');
}

// スプレッドシートから最新データを取得し、ローカルキャッシュ(localStorage)に反映する。
// 通信に失敗した場合は false を返し、既存のローカルキャッシュ（オフライン用）をそのまま使う。
let GAS_LAST_SYNC_OK = false;
async function syncFromGAS(garden) {
  try {
    // API.request は通信に失敗すると例外を投げるので、
    // 「本当に繋がらなかった（＝空ではなく通信エラー）」をここで正しく検知できる。
    const [staffRes, reqRes] = await Promise.all([
      API.request({action:'getStaff', garden: garden||''}),
      API.request({action:'getRequests', staffId:'', garden: garden||''}),
    ]);
    const staff = staffRes && staffRes.ok ? staffRes.data : [];
    const reqs  = reqRes  && reqRes.ok  ? reqRes.data  : [];
    if (staff && staff.length) DB.saveStaff(staff);
    if (reqs) DB.saveRequests(reqs);
    GAS_LAST_SYNC_OK = true;
    return true;
  } catch(e) {
    console.warn('GAS同期失敗、ローカルキャッシュを使用します:', e);
    GAS_LAST_SYNC_OK = false;
    return false;
  }
}

// 共有データストア (localStorage) ※GAS接続前のフォールバック/デモ用データとしても機能
const DB = {
  KEY_STAFF: 'ym_staff',
  KEY_REQUESTS: 'ym_requests',

  defaultStaff: [
    {id:'EMP001',name:'佐藤 花子',type:'正規',hire:'2019-04-01',grantDate:'2026-04-01',grant:18,carry:3,used:6,summerUsed:3,summerTotal:5,basicPay:250000,allowance:18000,avgMonthlyHours:160,email:'sato.hanako@shiba.ed.jp',garden:'しおどめ保育園○○'},
    {id:'EMP002',name:'鈴木 美咲',type:'正規',hire:'2021-04-01',grantDate:'2026-04-01',grant:14,carry:2,used:4,summerUsed:2,summerTotal:5,basicPay:230000,allowance:15000,avgMonthlyHours:160,email:'suzuki.misaki@shiba.ed.jp',garden:'しおどめ保育園○○'},
    {id:'EMP003',name:'高橋 由紀',type:'嘱託',hire:'2022-10-01',grantDate:'2026-04-01',grant:11,carry:1,used:3,summerUsed:0,summerTotal:5,basicPay:200000,allowance:10000,avgMonthlyHours:160,email:'takahashi.yuki@shiba.ed.jp',garden:'しおどめ保育園○○'},
    {id:'EMP004',name:'田中 彩香',type:'パート',hire:'2023-04-01',grantDate:'2026-04-01',grant:10,carry:2,used:1,summerUsed:0,summerTotal:0,basicPay:0,allowance:0,avgMonthlyHours:0,hourlyWage:1100,email:'tanaka.ayaka@shiba.ed.jp',garden:'しおどめ保育園○○'},
    {id:'EMP005',name:'渡辺 麻衣',type:'パート',hire:'2024-01-01',grantDate:'2026-04-01',grant:10,carry:0,used:0,summerUsed:0,summerTotal:0,basicPay:0,allowance:0,avgMonthlyHours:0,hourlyWage:1050,email:'watanabe.mai@shiba.ed.jp',garden:'しおどめ保育園○○'},
    {id:'EMP006',name:'伊藤 奈々',type:'正規',hire:'2017-04-01',grantDate:'2026-04-01',grant:20,carry:5,used:8,summerUsed:5,summerTotal:5,basicPay:270000,allowance:20000,avgMonthlyHours:160,email:'ito.nana@shiba.ed.jp',garden:'しおどめ保育園○○'},
    {id:'EMP007',name:'山本 千夏',type:'正規',hire:'2020-04-01',grantDate:'2026-04-01',grant:16,carry:2,used:5,summerUsed:3,summerTotal:5,basicPay:240000,allowance:16000,avgMonthlyHours:160,email:'yamamoto.chinatsu@shiba.ed.jp',garden:'しおどめ保育園○○'},
    {id:'EMP008',name:'中村 恵',type:'パート',hire:'2022-09-01',grantDate:'2026-04-01',grant:11,carry:1,used:2,summerUsed:0,summerTotal:0,basicPay:0,allowance:0,avgMonthlyHours:0,hourlyWage:1120,email:'nakamura.megumi@shiba.ed.jp',garden:'しおどめ保育園○○'},
    {id:'EMP009',name:'小林 遥',type:'正規',hire:'2023-04-01',grantDate:'2026-04-01',grant:10,carry:0,used:2,summerUsed:1,summerTotal:5,basicPay:210000,allowance:12000,avgMonthlyHours:160,email:'kobayashi.haruka@shiba.ed.jp',garden:'しおどめ保育園○○'},
    {id:'EMP010',name:'加藤 里奈',type:'パート',hire:'2021-06-01',grantDate:'2026-04-01',grant:11,carry:2,used:3,summerUsed:0,summerTotal:0,basicPay:0,allowance:0,avgMonthlyHours:0,hourlyWage:1080,email:'kato.rina@shiba.ed.jp',garden:'しおどめ保育園○○'},
    {id:'EMP011',name:'吉田 沙織',type:'嘱託',hire:'2020-10-01',grantDate:'2026-04-01',grant:12,carry:1,used:4,summerUsed:0,summerTotal:5,basicPay:205000,allowance:11000,avgMonthlyHours:160,email:'yoshida.saori@shiba.ed.jp',garden:'しおどめ保育園○○'},
    {id:'EMP012',name:'山田 真央',type:'パート',hire:'2024-04-01',grantDate:'2026-04-01',grant:10,carry:0,used:0,summerUsed:0,summerTotal:0,basicPay:0,allowance:0,avgMonthlyHours:0,hourlyWage:1050,email:'yamada.mao@shiba.ed.jp',garden:'しおどめ保育園○○'},
    {id:'EMP013',name:'佐々木 桃子',type:'正規',hire:'2019-10-01',grantDate:'2026-04-01',grant:18,carry:3,used:7,summerUsed:4,summerTotal:5,basicPay:245000,allowance:17000,avgMonthlyHours:160,email:'sasaki.momoko@shiba.ed.jp',garden:'しおどめ保育園○○'},
  ],

  defaultRequests: [
    {id:'REQ001',staffId:'EMP002',name:'鈴木 美咲',date:'2026-06-10',type:'全日',days:1,memo:'',status:'承認済',approver:'園長',approvedAt:'2026-06-05 14:20',rejectedReason:'',createdAt:'2026-06-05 09:12',category:'有給'},
    {id:'REQ002',staffId:'EMP007',name:'山本 千夏',date:'2026-06-20',type:'午前半休',days:0.5,memo:'通院のため',status:'承認済',approver:'園長',approvedAt:'2026-06-12 16:00',rejectedReason:'',createdAt:'2026-06-12 14:30',category:'有給'},
  ],

  init(){
    if(!localStorage.getItem(this.KEY_STAFF)) localStorage.setItem(this.KEY_STAFF, JSON.stringify(this.defaultStaff));
    if(!localStorage.getItem(this.KEY_REQUESTS)) localStorage.setItem(this.KEY_REQUESTS, JSON.stringify(this.defaultRequests));
    // 既存データに新フィールドがなければマージ
    const staff = this.getStaff();
    let updated = false;
    staff.forEach(s => {
      if(s.summerUsed === undefined){ s.summerUsed = 0; updated = true; }
      if(s.summerTotal === undefined){ s.summerTotal = s.type==='正規'||s.type==='嘱託' ? 5 : 0; updated = true; }
      if(s.basicPay === undefined){ s.basicPay = 0; updated = true; }
      if(s.allowance === undefined){ s.allowance = 0; updated = true; }
      if(s.avgMonthlyHours === undefined){ s.avgMonthlyHours = 160; updated = true; }
      if(s.category === undefined){ s.category = '有給'; updated = true; }
      if(s.grantDate === undefined){ s.grantDate = ''; updated = true; }
    });
    if(updated) this.saveStaff(staff);
  },

  getStaff(){ return JSON.parse(localStorage.getItem(this.KEY_STAFF)||'[]'); },
  getRequests(){ return JSON.parse(localStorage.getItem(this.KEY_REQUESTS)||'[]'); },
  getStaffById(id){ return this.getStaff().find(s=>s.id===id); },
  saveRequests(reqs){ localStorage.setItem(this.KEY_REQUESTS, JSON.stringify(reqs)); },
  saveStaff(staff){ localStorage.setItem(this.KEY_STAFF, JSON.stringify(staff)); },

  addRequest(req){
    const reqs = this.getRequests();
    const id = 'REQ'+String(Date.now()).slice(-6);
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const newReq = {...req, id, status:'申請中', approver:'', approvedAt:'', rejectedReason:'', createdAt:ts};
    reqs.unshift(newReq);
    this.saveRequests(reqs);
    return newReq;
  },

  approveRequest(reqId, approver){
    const reqs = this.getRequests();
    const req = reqs.find(r=>r.id===reqId);
    if(!req) return;
    req.status='承認済';
    req.approver=approver;
    const now = new Date();
    req.approvedAt=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    this.saveRequests(reqs);
    const staff = this.getStaff();
    const s = staff.find(s=>s.id===req.staffId);
    if(s){
      if(req.category==='夏期'){
        s.summerUsed = parseFloat((s.summerUsed + req.days).toFixed(1));
      } else {
        s.used = parseFloat((s.used + req.days).toFixed(1));
      }
      this.saveStaff(staff);
    }
  },

  rejectRequest(reqId, approver, reason){
    const reqs = this.getRequests();
    const req = reqs.find(r=>r.id===reqId);
    if(!req) return;
    req.status='却下'; req.approver=approver; req.rejectedReason=reason||'';
    const now = new Date();
    req.approvedAt=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    this.saveRequests(reqs);
  },

  reset(){
    localStorage.removeItem(this.KEY_STAFF);
    localStorage.removeItem(this.KEY_REQUESTS);
    this.init();
  },

  // ★デモ固定用：ブラウザに残る「本番同期時の実データ」を初回だけ一掃し、以降は
  //   園長用(encho.html)・職員用(staff_standalone.html)で入力したデモの申請を共有し続ける
  DEMO_VERSION: 'demo-v1',
  ensureDemoData(){
    if(localStorage.getItem('ym_demo_version') !== this.DEMO_VERSION){
      this.reset();
      localStorage.setItem('ym_demo_version', this.DEMO_VERSION);
    } else {
      this.init();
    }
  },

  getRemain(s){ return parseFloat((s.grant + s.carry - s.used).toFixed(1)); },
  getSummerRemain(s){ return Math.max(0, (s.summerTotal||0) - (s.summerUsed||0)); },
  getObligDone(s){ return s.used >= 5; },

  // 基準日（直近の有給付与日）と、そこから法定2年で失効するまでの日数
  getExpireDate(s){
    if(!s.grantDate) return null;
    const g = new Date(s.grantDate);
    if(isNaN(g)) return null;
    return new Date(g.getFullYear()+2, g.getMonth(), g.getDate());
  },
  getExpireDays(s){
    const exp = this.getExpireDate(s);
    if(!exp) return null;
    const today = new Date(); today.setHours(0,0,0,0);
    return Math.ceil((exp - today) / (24*3600*1000));
  },

  // 時間給計算（給与規程第17・18条）
  calcHourlyWage(s){
    if(s.type==='パート') return s.hourlyWage || 0;
    if(!s.basicPay || !s.avgMonthlyHours) return 0;
    return Math.round((s.basicPay + (s.allowance||0)) / s.avgMonthlyHours);
  },
  calcOvertimePay(s, hours){ return Math.round(this.calcHourlyWage(s) * hours * 1.25); },
  calcNightPay(s, hours){ return Math.round(this.calcHourlyWage(s) * hours * 0.25); },
  calcHolidayPay(s, hours){ return Math.round(this.calcHourlyWage(s) * hours * 1.35); },
  calcDeductPay(s, hours){ return Math.round(this.calcHourlyWage(s) * hours); },
};
