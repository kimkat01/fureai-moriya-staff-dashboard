// ============================================================
// UQ checker - Google Apps Script バックエンド v2
// スプレッドシートID: 15ZFzHY_QS_8pE8t_2w2ElqPTDDVusmhGoM0YdR5rfyw
// ============================================================

const SS_ID = '15ZFzHY_QS_8pE8t_2w2ElqPTDDVusmhGoM0YdR5rfyw';
const SS = SpreadsheetApp.openById(SS_ID);

const SHEET_STAFF    = '職員マスタ';
const SHEET_REQUESTS = '申請ログ';

// ============================================================
// レスポンス（JSONP対応でCORS回避）
// ============================================================
function response(data, callback) {
  const json = JSON.stringify(data);
  if (callback) {
    // JSONPモード
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// GETリクエスト（JSONPでCORS回避）
// ============================================================
function doGet(e) {
  try {
    const action   = e.parameter.action;
    const callback = e.parameter.callback; // JSONPコールバック

    if (action === 'getStaff') {
      return response({ ok: true, data: getAllStaff() }, callback);
    }
    if (action === 'getStaffById') {
      return response({ ok: true, data: getStaffById(e.parameter.id) }, callback);
    }
    if (action === 'getRequests') {
      return response({ ok: true, data: getAllRequests(e.parameter.staffId) }, callback);
    }
    if (action === 'getPending') {
      return response({ ok: true, data: getPendingRequests() }, callback);
    }
    if (action === 'initSheets') {
      initSheets();
      return response({ ok: true, message: 'シートを初期化しました' }, callback);
    }
    // POSTをGETで受け付ける（ローカルファイル用）
    if (action === 'addRequest') {
      const data = JSON.parse(e.parameter.data);
      const req = addRequest(data);
      sendMailToEncho(req);
      return response({ ok: true, data: req }, callback);
    }
    if (action === 'approveRequest') {
      const req = updateRequestStatus(e.parameter.reqId, '承認済', e.parameter.approver, '');
      if(req) sendMailToStaff(req, '承認');
      return response({ ok: true, data: req }, callback);
    }
    if (action === 'rejectRequest') {
      const req = updateRequestStatus(e.parameter.reqId, '却下', e.parameter.approver, e.parameter.reason || '');
      if(req) sendMailToStaff(req, '却下');
      return response({ ok: true, data: req }, callback);
    }

    return response({ ok: false, error: 'Unknown action' }, callback);
  } catch(err) {
    return response({ ok: false, error: err.message }, (e.parameter||{}).callback);
  }
}

// POSTも念のため残す
function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action;
    if (action === 'addRequest') {
      const req = addRequest(body.data);
      sendMailToEncho(req);
      return response({ ok: true, data: req });
    }
    if (action === 'approveRequest') {
      const req = updateRequestStatus(body.reqId, '承認済', body.approver, '');
      if(req) sendMailToStaff(req, '承認');
      return response({ ok: true, data: req });
    }
    if (action === 'rejectRequest') {
      const req = updateRequestStatus(body.reqId, '却下', body.approver, body.reason || '');
      if(req) sendMailToStaff(req, '却下');
      return response({ ok: true, data: req });
    }
    return response({ ok: false, error: 'Unknown action' });
  } catch(err) {
    return response({ ok: false, error: err.message });
  }
}

// ============================================================
// シート初期化
// ============================================================
function initSheets() {
  let staffSheet = SS.getSheetByName(SHEET_STAFF);
  if (!staffSheet) staffSheet = SS.insertSheet(SHEET_STAFF);
  if (staffSheet.getLastRow() === 0) {
    staffSheet.appendRow([
      '職員ID','氏名','雇用形態','採用日',
      '今年度付与','繰越','取得済み',
      '夏季付与','夏季取得済',
      '時間単位付与','時間単位取得済',
      '基本給','手当','月平均所定時間','時給',
      'メールアドレス','園名','園長メール','基準日（直近付与日）'
    ]);
    staffSheet.getRange(1,1,1,19).setFontWeight('bold').setBackground('#4169e1').setFontColor('#ffffff');
    staffSheet.appendRow([
      'EMP001','山田 花子','正規','2021-04-01',
      14,2,4,5,2,5,2,
      220000,15000,160,0,
      'hanako@shiba.ed.jp','しおどめ保育園','encho@shiba.ed.jp','2026-04-01'
    ]);
  }
  let reqSheet = SS.getSheetByName(SHEET_REQUESTS);
  if (!reqSheet) reqSheet = SS.insertSheet(SHEET_REQUESTS);
  if (reqSheet.getLastRow() === 0) {
    reqSheet.appendRow([
      '申請ID','職員ID','氏名','園名',
      '取得希望日','種別','消化数','カテゴリ','メモ',
      'ステータス','承認者','承認日時','却下理由','申請日時'
    ]);
    reqSheet.getRange(1,1,1,14).setFontWeight('bold').setBackground('#4169e1').setFontColor('#ffffff');
  }
}

// ============================================================
// 職員マスタ
// ============================================================
function getAllStaff() {
  const sheet = SS.getSheetByName(SHEET_STAFF);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  return rows.slice(1).map(row => rowToStaff(row));
}

function getStaffById(id) {
  return getAllStaff().find(s => s.id === id) || null;
}

function rowToStaff(row) {
  return {
    id: row[0], name: row[1], type: row[2],
    hire: formatDate(row[3]),
    grant: Number(row[4])||0, carry: Number(row[5])||0, used: Number(row[6])||0,
    summerTotal: Number(row[7])||0, summerUsed: Number(row[8])||0,
    hourLeaveGrant: Number(row[9])||5, hourLeaveUsed: Number(row[10])||0,
    basicPay: Number(row[11])||0, allowance: Number(row[12])||0,
    avgMonthlyHours: Number(row[13])||160, hourlyWage: Number(row[14])||0,
    email: row[15]||'', garden: row[16]||'', enchoEmail: row[17]||'',
    grantDate: formatDate(row[18]),
  };
}

function formatDate(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd');
  return String(val);
}

// ============================================================
// 申請ログ
// ============================================================
function getAllRequests(staffId) {
  const sheet = SS.getSheetByName(SHEET_REQUESTS);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  let reqs = rows.slice(1).map(row => rowToRequest(row));
  if (staffId) reqs = reqs.filter(r => r.staffId === staffId);
  return reqs.reverse();
}

function getPendingRequests() {
  return getAllRequests().filter(r => r.status === '申請中');
}

function rowToRequest(row) {
  return {
    id: row[0], staffId: row[1], name: row[2], garden: row[3],
    date: formatDate(row[4]), type: row[5],
    days: Number(row[6])||0, category: row[7], memo: row[8],
    status: row[9], approver: row[10],
    approvedAt: row[11] ? Utilities.formatDate(new Date(row[11]),'Asia/Tokyo','yyyy-MM-dd HH:mm') : '',
    rejectedReason: row[12]||'',
    createdAt: row[13] ? Utilities.formatDate(new Date(row[13]),'Asia/Tokyo','yyyy-MM-dd HH:mm') : '',
  };
}

function addRequest(data) {
  const sheet = SS.getSheetByName(SHEET_REQUESTS);
  const now = new Date();
  const id = 'REQ' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMddHHmmss');
  const ts = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  const staff = getStaffById(data.staffId);
  const garden = staff ? staff.garden : '';
  sheet.appendRow([id,data.staffId,data.name,garden,data.date,data.type,data.days,
    data.category||'有給',data.memo||'','申請中','','','',ts]);
  return {id,staffId:data.staffId,name:data.name,garden,date:data.date,type:data.type,
    days:data.days,category:data.category||'有給',memo:data.memo||'',
    status:'申請中',approver:'',approvedAt:'',rejectedReason:'',createdAt:ts};
}

function updateRequestStatus(reqId, status, approver, reason) {
  const sheet = SS.getSheetByName(SHEET_REQUESTS);
  const rows = sheet.getDataRange().getValues();
  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === reqId) {
      sheet.getRange(i+1,10).setValue(status);
      sheet.getRange(i+1,11).setValue(approver);
      sheet.getRange(i+1,12).setValue(now);
      sheet.getRange(i+1,13).setValue(reason);
      if (status === '承認済') updateStaffUsed(rows[i][1], Number(rows[i][6]), rows[i][7]);
      return rowToRequest(sheet.getRange(i+1,1,1,14).getValues()[0]);
    }
  }
  return null;
}

function updateStaffUsed(staffId, days, category) {
  const sheet = SS.getSheetByName(SHEET_STAFF);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === staffId) {
      if (category === '夏期') {
        sheet.getRange(i+1,9).setValue((Number(rows[i][8])||0) + days);
      } else if (category === '時間単位') {
        sheet.getRange(i+1,11).setValue((Number(rows[i][10])||0) + days);
      } else {
        sheet.getRange(i+1,7).setValue(parseFloat(((Number(rows[i][6])||0) + days).toFixed(1)));
      }
      break;
    }
  }
}

// ============================================================
// メール通知
// ============================================================
function sendMailToEncho(req) {
  try {
    const staff = getStaffById(req.staffId);
    if (!staff || !staff.enchoEmail) return;
    const cat = req.category==='夏期'?'夏季休暇':req.category==='時間単位'?'時間単位有給':'年次有給休暇';
    GmailApp.sendEmail(staff.enchoEmail,
      `【UQ checker】有給申請 - ${req.name} (${req.date})`,
      `${staff.garden} 園長 様\n\n${req.name}さんから${cat}の申請が届きました。\n\n` +
      `■ 取得希望日：${req.date}\n■ 種別：${req.type}（${req.days}日/時間）\n` +
      `■ メモ：${req.memo||'なし'}\n■ 申請日時：${req.createdAt}\n\n` +
      `園長画面から承認・却下をお願いします。\n\n──\nUQ checker`);
  } catch(e) { Logger.log('メール送信エラー: '+e.message); }
}

function sendMailToStaff(req, result) {
  try {
    const staff = getStaffById(req.staffId);
    if (!staff || !staff.email) return;
    GmailApp.sendEmail(staff.email,
      `【UQ checker】申請${result}のお知らせ - ${req.date}`,
      `${req.name} さん\n\n${req.date}の有給申請が【${result}】されました。\n\n` +
      `■ 取得希望日：${req.date}\n■ 種別：${req.type}\n■ 承認者：${req.approver}\n` +
      (req.rejectedReason?`■ 却下理由：${req.rejectedReason}\n`:'') +
      `\n──\nUQ checker`);
  } catch(e) { Logger.log('メール送信エラー: '+e.message); }
}
