/**
 * 업무 현황(통화 수신·발신 / 채널톡) 시트 → Supabase 동기화
 *
 * 시트 양식 (시트 이름: WORK_SHEET_NAME, 1~5행 안에 아래 헤더가 있는 행을 자동으로 찾음)
 *   날짜 | 상담사 | 수신 건수 | 수신 시간 | 발신 건수 | 발신 시간 | 채널톡 건수 | 채널톡 시간
 *   - 한 행 = 하루 × 상담사 1명. 같은 날짜·상담사가 두 줄이면 동기화를 중단한다.
 *   - 시간 열은 기본적으로 [h]:mm:ss 서식(예: 1:05:30, 24시간 초과 가능).
 *     숫자로 넣고 싶으면 헤더를 "수신 시간(초)" 또는 "수신 시간(분)"처럼 단위를 붙인다.
 *   - 상담사는 실명으로 적어도 되고, 전송 직전에 김*옥 형태로 마스킹된다.
 *   - 건수·시간이 모두 0/빈칸인 업무는 보내지 않는다.
 *
 * 스크립트 속성(프로젝트 설정 > 스크립트 속성)에 등록:
 *   SYNC_URL           = https://<프로젝트ref>.supabase.co/functions/v1/sheet-sync
 *   SHEET_SYNC_SECRET  = Edge Function 에 넣은 것과 같은 비밀값
 *
 * 실행할 함수
 *   previewWorkDaily()        : 전송 없이 시트 양식만 검사 (Supabase 없이도 실행 가능)
 *   syncWorkDaily()           : 지금 바로 동기화 (최초 전체 반영 포함)
 *   installHourlyTrigger()    : 1시간마다 syncWorkDaily 자동 실행 등록 (한 번만)
 *   syncWorkDailyAllowShrink(): 행을 대량 삭제한 게 의도된 경우에만 1회 실행
 */

var WORK_SHEET_NAME = '업무 일별';
var LOG_SHEET_NAME = '동기화 로그';

var COLUMNS = [
  { header: '수신', type: 'call_in' },
  { header: '발신', type: 'call_out' },
  { header: '채널톡', type: 'chat' },
];

function previewWorkDaily() {
  var result = readWorkSheet_();
  var msg = result.errors.length
    ? '오류 ' + result.errors.length + '건:\n' + result.errors.slice(0, 30).join('\n')
    : '양식 정상 — 전송 대상 ' + result.rows.length + '행 (' + summarize_(result.rows) + ')';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* 트리거/편집기 실행 시 UI 없음 */ }
}

function syncWorkDaily() { sync_(false); }
function syncWorkDailyAllowShrink() { sync_(true); }

function installHourlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncWorkDaily') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncWorkDaily').timeBased().everyHours(1).create();
  Logger.log('1시간 간격 자동 동기화 트리거를 등록했습니다.');
}

function sync_(allowShrink) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SYNC_URL');
  var secret = props.getProperty('SHEET_SYNC_SECRET');
  if (!url || !secret) return writeLog_('error', null, '스크립트 속성 SYNC_URL / SHEET_SYNC_SECRET 이 없습니다.');

  var result = readWorkSheet_();
  if (result.errors.length) {
    return writeLog_('error', null, '시트 검증 실패 — 전송하지 않음: ' + result.errors.slice(0, 20).join(' / '));
  }
  if (!result.rows.length) return writeLog_('error', 0, '보낼 데이터가 없습니다.');

  var res;
  try {
    res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-sync-secret': secret },
      payload: JSON.stringify({ dataset: 'work_daily', rows: result.rows, allowShrink: !!allowShrink }),
      muteHttpExceptions: true,
    });
  } catch (e) {
    return writeLog_('error', result.rows.length, '요청 실패: ' + e);
  }
  var code = res.getResponseCode();
  var text = res.getContentText().slice(0, 1000);
  if (code === 200) writeLog_('success', result.rows.length, text);
  else writeLog_('error', result.rows.length, 'HTTP ' + code + ': ' + text);
}

function readWorkSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(WORK_SHEET_NAME);
  if (!sheet) return { rows: [], errors: ['"' + WORK_SHEET_NAME + '" 시트가 없습니다.'] };
  var tz = ss.getSpreadsheetTimeZone();
  var values = sheet.getDataRange().getValues();
  var display = sheet.getDataRange().getDisplayValues();

  // 헤더 행 찾기
  var headerRow = -1;
  for (var r = 0; r < Math.min(5, values.length); r++) {
    var cells = display[r].map(norm_);
    if (cells.indexOf('날짜') !== -1 && cells.indexOf('상담사') !== -1) { headerRow = r; break; }
  }
  if (headerRow === -1) return { rows: [], errors: ['1~5행에서 "날짜", "상담사" 헤더를 찾지 못했습니다.'] };
  var head = display[headerRow].map(norm_);
  var idx = { date: head.indexOf('날짜'), agent: head.indexOf('상담사') };
  var errors = [];
  var cols = COLUMNS.map(function (c) {
    var countIdx = head.indexOf(c.header + ' 건수');
    var timeIdx = -1, unit = 'duration';
    head.forEach(function (h, i) {
      var m = h.match(new RegExp('^' + c.header + ' 시간(?:\\((초|분)\\))?$'));
      if (m) { timeIdx = i; unit = m[1] === '초' ? 'sec' : m[1] === '분' ? 'min' : 'duration'; }
    });
    if (countIdx === -1) errors.push('"' + c.header + ' 건수" 열이 없습니다.');
    if (timeIdx === -1) errors.push('"' + c.header + ' 시간" 열이 없습니다.');
    return { type: c.type, header: c.header, countIdx: countIdx, timeIdx: timeIdx, unit: unit };
  });
  if (errors.length) return { rows: [], errors: errors };

  var rows = [];
  var seen = {};
  for (var i = headerRow + 1; i < values.length; i++) {
    var line = (i + 1) + '행';
    var rawDate = values[i][idx.date];
    var rawAgent = norm_(display[i][idx.agent]);
    if (rawDate === '' && !rawAgent) continue; // 빈 행
    var date = toDateKey_(rawDate, display[i][idx.date], tz);
    if (!date) { errors.push(line + ': 날짜 형식 오류 (' + display[i][idx.date] + ')'); continue; }
    if (!rawAgent) { errors.push(line + ': 상담사가 비어 있습니다.'); continue; }
    var agent = maskName_(rawAgent);
    var key = date + '|' + agent;
    if (seen[key]) { errors.push(line + ': ' + date + ' ' + agent + ' 중복 (' + seen[key] + '과 같은 날짜·상담사)'); continue; }
    seen[key] = line;

    cols.forEach(function (c) {
      var count = toNumber_(display[i][c.countIdx]);
      var seconds = toSeconds_(values[i][c.timeIdx], display[i][c.timeIdx], c.unit);
      if (count === null || count < 0 || Math.floor(count) !== count) { errors.push(line + ': ' + c.header + ' 건수 오류 (' + display[i][c.countIdx] + ')'); return; }
      if (seconds === null) { errors.push(line + ': ' + c.header + ' 시간 오류 (' + display[i][c.timeIdx] + ') — [h]:mm:ss 서식이거나 헤더에 (초)/(분) 단위 필요'); return; }
      if (!count && !seconds) return;
      rows.push({ date: date, agent: agent, work_type: c.type, count: count, seconds: seconds });
    });
  }
  return { rows: rows, errors: errors };
}

function norm_(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }

function toNumber_(text) {
  var s = norm_(text).replace(/,/g, '');
  if (s === '') return 0;
  var n = Number(s);
  return isNaN(n) ? null : n;
}

// 시간 셀 → 초. duration 서식은 표시값 h:mm:ss 를 읽는다(24시간 초과 표시 그대로 해석).
function toSeconds_(raw, text, unit) {
  var s = norm_(text);
  if (s === '') return 0;
  if (unit === 'sec' || unit === 'min') {
    var n = Number(s.replace(/,/g, ''));
    if (isNaN(n) || n < 0) return null;
    return Math.round(unit === 'min' ? n * 60 : n);
  }
  var m = s.match(/^(\d+):([0-5]?\d):([0-5]?\d)$/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function toDateKey_(raw, text, tz) {
  if (raw instanceof Date && !isNaN(raw.getTime())) return Utilities.formatDate(raw, tz, 'yyyy-MM-dd');
  var m = norm_(text).match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (!m) return null;
  return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}

// 대시보드와 같은 마스킹 규칙: 2글자 → 김*, 3글자 이상 → 김*옥 (이미 *가 있으면 그대로)
function maskName_(name) {
  if (name.indexOf('*') !== -1 || name.length <= 1) return name;
  if (name.length === 2) return name[0] + '*';
  return name[0] + new Array(name.length - 1).join('*') + name[name.length - 1];
}

function summarize_(rows) {
  var t = {};
  rows.forEach(function (r) { t[r.work_type] = (t[r.work_type] || 0) + r.count; });
  return '수신 ' + (t.call_in || 0) + '건, 발신 ' + (t.call_out || 0) + '건, 채널톡 ' + (t.chat || 0) + '건';
}

function writeLog_(status, rowCount, message) {
  Logger.log(status + ' ' + message);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(LOG_SHEET_NAME) || ss.insertSheet(LOG_SHEET_NAME);
  if (sheet.getLastRow() === 0) sheet.appendRow(['시각', '결과', '행 수', '메시지']);
  sheet.appendRow([new Date(), status === 'success' ? '성공' : '실패', rowCount == null ? '' : rowCount, message]);
  var extra = sheet.getLastRow() - 501;
  if (extra > 0) sheet.deleteRows(2, extra); // 최근 500건만 보관
}
