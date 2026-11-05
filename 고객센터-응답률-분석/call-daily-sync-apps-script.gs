/**
 * "일별 응답률" 시트 → Supabase call_daily 테이블 동기화 (대시보드 '통화 현황' 탭)
 *
 * 대상 스프레드시트: mvno 고객센터 응답률
 * https://docs.google.com/spreadsheets/d/1YZWhHDTcUGycjrpYxlIT0BPh-0RGCUNh6V9AlgEitEk
 *
 * "일별 응답률" 시트는 월별로 [날짜, 전체 인입, 응답, 미응답, 응답률] 5개 컬럼이
 * 가로로 반복되는 구조(5월 블록, 6월 블록, ...). 헤더 행에서 "날짜"가 포함된
 * 셀을 모두 찾아 각 블록의 시작 컬럼으로 삼기 때문에, 다음 달 블록이 오른쪽에
 * 추가돼도 코드 수정 없이 자동으로 인식한다.
 *
 * 날짜 셀 값은 "10월 1일"처럼 연도가 없어서, 오늘 날짜 기준으로 "이번 달보다
 * 미래 월이면 작년"으로 연도를 추정한다(resolveYear).
 *
 * 전송 경로: 이 스크립트 → Edge Function(sheet-sync, dataset "call_daily") → call_daily
 * 쓰기 권한은 Edge Function 만 갖는다(브라우저용 키로는 call_daily 에 쓸 수 없음).
 * 시트 전체를 스냅샷으로 보내며, 시트에서 지운 날짜는 DB에서도 지워진다.
 *
 * 설치:
 * 1. 이 스프레드시트에서 확장 프로그램 > Apps Script, 이 파일 내용 전체 붙여넣기
 * 2. 프로젝트 설정(톱니바퀴) > 스크립트 속성에 추가
 *      SYNC_URL          = https://<프로젝트ref>.supabase.co/functions/v1/sheet-sync
 *      SHEET_SYNC_SECRET = Edge Function Secrets 에 넣은 것과 같은 값
 *    (업무 현황용 work-sheet-sync.gs 와 같은 값을 쓰면 된다)
 * 3. previewCallDaily ▶ 실행 — 전송 없이 읽힌 행 수/기간만 확인 (최초 1회 권한 허용)
 * 4. syncCallDaily ▶ 실행 — 실제 반영
 * 5. createDailyTrigger ▶ 1회 실행 — 매일 07시·13시·19시 자동 동기화
 */

var SPREADSHEET_ID = '1YZWhHDTcUGycjrpYxlIT0BPh-0RGCUNh6V9AlgEitEk';
var SHEET_NAME = '일별 응답률';

function previewCallDaily() {
  var rows = readCallDailyRows();
  var msg = rows.length
    ? '전송 대상 ' + rows.length + '일 (' + rows[0].date + ' ~ ' + rows[rows.length - 1].date + ')'
    : '읽힌 행이 없습니다. 시트 구조를 확인하세요.';
  notify_(msg);
}

function syncCallDaily() { sync_(false); }
// 시트에서 날짜를 대량으로 지운 게 의도된 경우에만 1회 실행
function syncCallDailyAllowShrink() { sync_(true); }

function sync_(allowShrink) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SYNC_URL');
  var secret = props.getProperty('SHEET_SYNC_SECRET');
  if (!url || !secret) return notify_('스크립트 속성 SYNC_URL / SHEET_SYNC_SECRET 이 없습니다.');

  var rows = readCallDailyRows();
  if (!rows.length) return notify_('반영할 행이 없습니다. 시트 구조를 확인하세요.');

  var res;
  try {
    res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-sync-secret': secret },
      payload: JSON.stringify({ dataset: 'call_daily', rows: rows, allowShrink: !!allowShrink }),
      muteHttpExceptions: true
    });
  } catch (e) {
    return notify_('요청 실패: ' + e);
  }
  var code = res.getResponseCode();
  var text = res.getContentText().slice(0, 1000);
  notify_(code === 200 ? '성공 (' + rows.length + '일): ' + text : '실패 HTTP ' + code + ': ' + text);
}

function readCallDailyRows() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('시트를 찾을 수 없습니다: ' + SHEET_NAME);

  // 날짜 셀이 날짜 서식이어도 "10월 1일" 문자열로 받도록 표시값을 쓴다
  var values = sheet.getDataRange().getDisplayValues();
  var headerRow = -1, dateCols = [];
  for (var r = 0; r < Math.min(5, values.length) && headerRow === -1; r++) {
    var cols = [];
    for (var c = 0; c < values[r].length; c++) {
      if (String(values[r][c] || '').indexOf('날짜') !== -1) cols.push(c);
    }
    if (cols.length) { headerRow = r; dateCols = cols; }
  }
  if (headerRow === -1) throw new Error('헤더 행에서 "날짜" 컬럼을 찾지 못했습니다.');

  var byDate = {};
  dateCols.forEach(function (dateCol) {
    for (var r2 = headerRow + 1; r2 < values.length; r2++) {
      var label = String(values[r2][dateCol] || '').trim();
      var m = label.match(/^(\d{1,2})월\s*(\d{1,2})일/);
      if (!m) continue; // 빈 행/합계 행은 자동 제외

      var month = Number(m[1]);
      var day = Number(m[2]);
      var date = resolveYear(month) + '-' + pad2_(month) + '-' + pad2_(day);

      var total = toCount_(values[r2][dateCol + 1]);
      var answered = toCount_(values[r2][dateCol + 2]);
      var unanswered = toCount_(values[r2][dateCol + 3]);
      if (!total && !answered && !unanswered) continue; // 아직 입력 전인 날짜

      byDate[date] = { date: date, total_calls: total, answered: answered, unanswered: unanswered };
    }
  });

  return Object.keys(byDate).sort().map(function (d) { return byDate[d]; });
}

function resolveYear(month) {
  var today = new Date();
  var curYear = today.getFullYear();
  var curMonth = today.getMonth() + 1;
  return month > curMonth ? curYear - 1 : curYear;
}

function toCount_(raw) {
  var n = Number(String(raw == null ? '' : raw).replace(/[,\s건]/g, ''));
  return isNaN(n) || n < 0 ? 0 : Math.round(n);
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

function notify_(msg) {
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* 트리거/편집기 실행 시 UI 없음 */ }
}

function createDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncCallDaily') ScriptApp.deleteTrigger(t);
  });
  [7, 13, 19].forEach(function (h) {
    ScriptApp.newTrigger('syncCallDaily').timeBased().everyDays(1).atHour(h).create();
  });
  Logger.log('매일 07·13·19시 자동 동기화 트리거 등록 완료.');
}
