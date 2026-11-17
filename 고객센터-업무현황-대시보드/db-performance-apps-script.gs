/**
 * DB 실적(알뜰폰 OB 청약대기 트래킹) → 대시보드 '업무 현황' 탭 DB 실적 표
 *
 * 대상: '[MVNO] 알뜰폰 OB 청약대기 트래킹' 스프레드시트 (이 스크립트를 그 시트에 설치)
 * '시트1'(실적)을 읽어 날짜별 건수만 돌려준다. 전화번호·계약번호·재컨텍 내용 등 고객 정보는 읽지도 보내지도 않는다.
 *
 *   인입      : '시트2'(로데이터) 계약번호 MVN{yyyyMMdd}xxxxxx 의 날짜 기준 (같은 계약번호는 1건)
 *   OB 건수   : OB 일자 기준 1행 = 1건
 *   유심 구매 : 유심구매여부 = Y 인 행, 구매일자 기준 (비어 있으면 OB 일자)
 *   개통완료  : 신청상태에 '개통완료'가 들어간 행(셀프개통완료 등), 개통일자 기준 (비어 있으면 OB 일자)
 *
 * 헤더는 1~10행 안에서 '신청상태'가 있는 행을 찾아 열 이름으로 읽는다(열 순서가 바뀌어도 됨).
 *
 * 배포: 배포 > 새 배포 > 유형: 웹 앱 / 실행 사용자: 나 / 액세스: 모든 사용자
 *       → 웹 앱 URL 을 대시보드 DB_PERF_WEBAPP_URL 에 넣는다.
 *       코드를 고친 뒤에는 배포 관리 > 편집 > 버전: 새 버전 으로 다시 배포해야 반영된다.
 * 확인: previewDbPerformance ▶ 실행 — 실행 로그에 집계 결과가 나온다.
 */

var DB_SHEET_NAME = '시트1';
var RAW_SHEET_NAME = '시트2';

function doGet() {
  try {
    return json_(readDbPerformance_());
  } catch (e) {
    return json_({ ok: false, message: String(e) });
  }
}

function previewDbPerformance() {
  var r = readDbPerformance_();
  var t = r.days.reduce(function (a, d) { a.inflow += d.inflow; a.ob += d.ob; a.usim += d.usim; a.opened += d.opened; return a; }, { inflow: 0, ob: 0, usim: 0, opened: 0 });
  Logger.log('인입 ' + t.inflow + '건, OB ' + t.ob + '건, 유심 구매 ' + t.usim + '건, 개통완료 ' + t.opened + '건 · ' + r.days.length + '일 · ' + r.updated +
    (r.skipped ? ' · 날짜 없는 행 ' + r.skipped + '건 제외' : ''));
}

function readDbPerformance_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(DB_SHEET_NAME);
  if (!sheet) throw new Error('"' + DB_SHEET_NAME + '" 시트가 없습니다.');
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
    var d = days[date] || (days[date] = { date: date, inflow: 0, ob: 0, usim: 0, opened: 0 });
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

  // 인입: 시트2 계약번호의 날짜(MVN + yyyyMMdd). 계약번호 자체는 내보내지 않는다.
  var raw = ss.getSheetByName(RAW_SHEET_NAME);
  if (raw) {
    var rv = raw.getDataRange().getDisplayValues();
    var rh = -1, rc = -1;
    for (var x = 0; x < Math.min(10, rv.length) && rh === -1; x++) {
      rc = rv[x].map(norm_).indexOf('계약번호');
      if (rc !== -1) rh = x;
    }
    var seenContract = {};
    if (rh !== -1) for (var y = rh + 1; y < rv.length; y++) {
      var no = norm_(rv[y][rc]);
      var m = no.match(/^MVN(\d{4})(\d{2})(\d{2})/i);
      if (!m || seenContract[no]) continue;
      seenContract[no] = true;
      bump(m[1] + '-' + m[2] + '-' + m[3], 'inflow');
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
