/**
 * DB 실적(알뜰폰 OB 청약대기 트래킹) → 대시보드 '업무 현황' 탭 DB 실적 표
 *
 * 대상: '[MVNO] 알뜰폰 OB 청약대기 트래킹' 스프레드시트 (이 스크립트를 그 시트에 설치)
 * '트래킹'(실적)을 읽어 날짜별 건수만 돌려준다. 전화번호·계약번호·재컨텍 내용 등 고객 정보는 읽지도 보내지도 않는다.
 *
 *   인입      : '인입 및 개통상태 누적'(로데이터) 계약번호(contract_form_id) MVN{yyyyMMdd}xxxxxx 의 날짜 기준 (같은 계약번호는 1건)
 *   부재 · 고객제외 · 청약대기 : '인입 및 개통상태 누적' 상태(final_progress_name) (현재 상태), 인입일 기준
 *       부재 = 값에 '부재'가 들어간 것(가망부재1·2·3), 고객제외·청약대기 = 값이 정확히 일치
 *   OB 건수   : OB 일자 기준 1행 = 1건
 *   유심 구매 : 유심구매여부 = Y 인 행, 구매일자 기준 (비어 있으면 OB 일자)
 *   개통완료  : 신청상태에 '개통완료'가 들어간 행(셀프개통완료 등), 개통일자 기준 (비어 있으면 OB 일자)
 *
 * 탭·열 이름은 예전 이름(시트1·시트2·인입 누적, 계약번호·개통상태)도 함께 인식한다.
 * 로데이터 탭 이름이 또 바뀌어도 1행에 contract_form_id(계약번호) 열이 있는 탭을 자동으로 찾는다.
 * 헤더는 1~10행 안에서 '신청상태'가 있는 행을 찾아 열 이름으로 읽는다(열 순서가 바뀌어도 됨).
 *
 * 연동: 시트 → Supabase(db_perf_daily) → 대시보드
 *   (회사 정책으로 웹 앱 '모든 사용자' 공개가 막혀, 웹 앱 대신 시트가 직접 Supabase 로 보낸다)
 *   1) 프로젝트 설정 > 스크립트 속성 에 2개 추가 (업무 현황 시트 스크립트 속성과 같은 값)
 *        SYNC_URL          = https://qgqyzyrbrmwnvmhiteta.supabase.co/functions/v1/smooth-responder
 *        SHEET_SYNC_SECRET = (업무 현황 시트에 넣어 둔 것과 같은 비밀값)
 *   2) syncDbPerformance ▶ 실행 (처음 1회 권한 승인) — 실행 로그에 'HTTP 200' 이 나오면 성공
 *   3) installDbPerfTrigger ▶ 실행 — 30분마다 자동 전송
 *   코드를 고친 뒤에는 저장만 하면 된다(웹 앱 재배포 필요 없음).
 * 확인: previewDbPerformance ▶ 실행 — 실행 로그에 집계 결과가 나온다.
 */

function syncDbPerformance() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SYNC_URL');
  var secret = props.getProperty('SHEET_SYNC_SECRET');
  if (!url || !secret) throw new Error('스크립트 속성 SYNC_URL / SHEET_SYNC_SECRET 이 없습니다.');
  var r = readDbPerformance_();
  if (!r.days.length) throw new Error('보낼 데이터가 없습니다.');
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-sync-secret': secret },
    payload: JSON.stringify({ dataset: 'db_perf', rows: r.days }),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  Logger.log('HTTP ' + code + ' ' + res.getContentText().slice(0, 500) + ' · ' + r.days.length + '일');
  if (code !== 200) throw new Error('전송 실패 HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
}

function installDbPerfTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncDbPerformance') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncDbPerformance').timeBased().everyMinutes(30).create();
  Logger.log('30분 간격 자동 전송 트리거를 등록했습니다.');
}

// 탭·열 이름 후보 (앞에서부터 먼저 있는 것을 쓴다)
var DB_SHEET_NAMES = ['트래킹', '시트1'];
var RAW_SHEET_NAMES = ['인입 및 개통상태 누적', '인입 누적', '시트2'];
var RAW_CONTRACT_COLS = ['contract_form_id', '계약번호'];
var RAW_STATUS_COLS = ['final_progress_name', '개통상태'];

function sheetByNames_(ss, names) {
  for (var i = 0; i < names.length; i++) { var sh = ss.getSheetByName(names[i]); if (sh) return sh; }
  return null;
}
function colOf_(row, names) {
  var cells = row.map(norm_);
  for (var i = 0; i < names.length; i++) { var c = cells.indexOf(names[i]); if (c !== -1) return c; }
  return -1;
}

function doGet() {
  try {
    return json_(readDbPerformance_());
  } catch (e) {
    return json_({ ok: false, message: String(e) });
  }
}

function previewDbPerformance() {
  var r = readDbPerformance_();
  var keys = ['inflow', 'absent', 'excluded', 'pending', 'ob', 'usim', 'opened'];
  var t = {};
  keys.forEach(function (k) { t[k] = r.days.reduce(function (a, d) { return a + d[k]; }, 0); });
  Logger.log('인입 ' + t.inflow + '건 (부재 ' + t.absent + ', 고객제외 ' + t.excluded + ', 청약대기 ' + t.pending + '), OB ' + t.ob + '건, 유심 구매 ' + t.usim + '건, 개통완료 ' + t.opened + '건 · ' + r.days.length + '일 · ' + r.updated +
    (r.skipped ? ' · 날짜 없는 행 ' + r.skipped + '건 제외' : ''));
}

function readDbPerformance_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = sheetByNames_(ss, DB_SHEET_NAMES);
  if (!sheet) throw new Error('"' + DB_SHEET_NAMES.join('" / "') + '" 시트가 없습니다.');
  var tz = ss.getSpreadsheetTimeZone();
  var range = sheet.getDataRange();
  var values = range.getValues(), display = range.getDisplayValues();

  var headerRow = -1;
  for (var r = 0; r < Math.min(10, display.length) && headerRow === -1; r++) {
    if (display[r].map(norm_).indexOf('신청상태') !== -1) headerRow = r;
  }
  if (headerRow === -1) throw new Error('1~10행에서 "신청상태" 헤더를 찾지 못했습니다.');
  var head = display[headerRow].map(norm_);
  var col = function (name) { return head.indexOf(name); };
  // 계약번호 열은 '실제 데이터 행인지' 판단에만 쓰고 값은 내보내지 않는다(빈 체크박스 행 구분용)
  var C = { ob: col('OB 일자'), contract: col('계약번호'), usim: col('유심구매여부'), usimDate: col('구매일자'), openDate: col('개통일자'), status: col('신청상태') };
  if (C.ob === -1) throw new Error('"OB 일자" 열이 없습니다.');

  var days = {}, skipped = 0;
  var bump = function (date, key) {
    var d = days[date] || (days[date] = { date: date, inflow: 0, absent: 0, excluded: 0, pending: 0, ob: 0, usim: 0, opened: 0 });
    d[key]++;
  };
  var dateAt = function (i, c) { return c === -1 ? null : toDateKey_(values[i][c], display[i][c], tz); };

  for (var i = headerRow + 1; i < values.length; i++) {
    var obDate = dateAt(i, C.ob);
    if (!obDate) { if (C.contract !== -1 && norm_(display[i][C.contract])) skipped++; continue; }
    bump(obDate, 'ob');
    if (C.usim !== -1 && norm_(display[i][C.usim]).toUpperCase() === 'Y') bump(dateAt(i, C.usimDate) || obDate, 'usim');
    if (C.status !== -1 && norm_(display[i][C.status]).indexOf('개통완료') !== -1) bump(dateAt(i, C.openDate) || obDate, 'opened');
  }

  // 인입: 인입 누적 계약번호의 날짜(MVN + yyyyMMdd). 계약번호 자체는 내보내지 않는다.
  // 탭 이름이 목록에 없으면 1행에 계약번호 열(contract_form_id 등)이 있는 탭을 찾아 쓴다.
  var raw = sheetByNames_(ss, RAW_SHEET_NAMES) || ss.getSheets().filter(function (s) {
    if (s.getSheetId() === sheet.getSheetId() || s.getLastRow() < 1) return false;
    return colOf_(s.getRange(1, 1, 1, Math.max(1, s.getLastColumn())).getDisplayValues()[0], RAW_CONTRACT_COLS) !== -1;
  })[0];
  if (!raw) throw new Error('인입 로데이터 탭(' + RAW_SHEET_NAMES.join(' / ') + ')을 찾지 못했습니다.');
  if (raw) {
    var rv = raw.getDataRange().getDisplayValues();
    var rh = -1, rc = -1, sc = -1;
    for (var x = 0; x < Math.min(10, rv.length) && rh === -1; x++) {
      rc = colOf_(rv[x], RAW_CONTRACT_COLS);
      if (rc !== -1) { rh = x; sc = colOf_(rv[x], RAW_STATUS_COLS); }
    }
    var seenContract = {};
    if (rh !== -1) for (var y = rh + 1; y < rv.length; y++) {
      var no = norm_(rv[y][rc]);
      var m = no.match(/^MVN(\d{4})(\d{2})(\d{2})/i);
      if (!m || seenContract[no]) continue;
      seenContract[no] = true;
      var inflowDate = m[1] + '-' + m[2] + '-' + m[3];
      bump(inflowDate, 'inflow');
      var st = sc === -1 ? '' : norm_(rv[y][sc]);
      if (st.indexOf('부재') !== -1) bump(inflowDate, 'absent');
      else if (st === '고객제외') bump(inflowDate, 'excluded');
      else if (st === '청약대기') bump(inflowDate, 'pending');
    }
  }

  return {
    ok: true,
    updated: norm_(display[0] && display[0][0]), // A1 'Last updated: …'
    skipped: skipped,
    days: Object.keys(days).sort().map(function (k) { return days[k]; }),
  };
}

function norm_(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }

function toDateKey_(raw, text, tz) {
  if (raw instanceof Date && !isNaN(raw.getTime())) return Utilities.formatDate(raw, tz, 'yyyy-MM-dd');
  var m = norm_(text).match(/^(\d{2}|\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (!m) return null;
  var y = m[1].length === 2 ? '20' + m[1] : m[1];
  return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
