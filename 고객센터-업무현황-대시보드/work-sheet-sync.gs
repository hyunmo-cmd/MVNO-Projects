/**
 * 업무 현황 시트 → Supabase 동기화 (대시보드 '업무 현황' 탭)
 *
 * 대상: '상담사 업무 현황_통화, 채널톡, 개통' 스프레드시트 (이 스크립트를 그 시트에 설치)
 * 원본 탭을 그대로 읽어 날짜 × 상담사 × 업무 단위로 합산한 뒤 전송한다. 탭 양식은 바꿀 필요 없음.
 *
 *   제네시스_<이름>  (Genesys 상담원 성능 상세, 하루 1행)
 *     간격 시작(날짜) · 상담원 이름 · 응답됨(=수신 건수) · 발신(=발신 건수) · 총 대화(ms)
 *     - 총 대화 시간은 수신·발신 구분이 없어 건수 비율로 나눈다.
 *     - 새 상담사가 오면 '제네시스_이름' 탭을 추가하기만 하면 자동으로 읽는다.
 *   채널톡  (채팅 목록, 채팅 1건 = 1행)
 *     managedAt(날짜) · managerIds(참여 상담사 ID, 쉼표 구분)
 *     - 참여한 상담사마다 1건씩 센다. CHANNEL_MANAGERS 에 없는 ID(봇·관리자 등)는 건너뛴다.
 *     - 시간 열이 없어 건수만 보낸다(대시보드가 건당 시간으로 환산).
 *   개통  (날짜 · 상담사 · 구분 · 건수 · 소요시간(분))
 *     - 구분 '개통 업무'·'수동 개통'을 모두 개통으로 합산한다.
 *
 * 상담사 이름은 전송 직전에 김*옥 형태로 마스킹된다. 고객 정보는 읽지도 보내지도 않는다.
 *
 * 스크립트 속성(프로젝트 설정 > 스크립트 속성)에 등록:
 *   SYNC_URL           = https://<프로젝트ref>.supabase.co/functions/v1/sheet-sync
 *   SHEET_SYNC_SECRET  = Edge Function 에 넣은 것과 같은 비밀값
 *
 * 실행할 함수
 *   previewWorkDaily()        : 전송 없이 읽힌 내용만 확인 (Supabase 없이도 실행 가능)
 *   syncWorkDaily()           : 지금 바로 동기화 (최초 전체 반영 포함)
 *   installHourlyTrigger()    : 1시간마다 syncWorkDaily 자동 실행 등록 (한 번만)
 *   syncWorkDailyAllowShrink(): 행을 대량 삭제한 게 의도된 경우에만 1회 실행
 */

var GENESYS_PREFIX = '제네시스_';
var CHANNEL_SHEET = '채널톡';
var OPEN_SHEET = '개통';
var LOG_SHEET_NAME = '동기화 로그';

// 채널톡 상담사 ID → 이름. 새 상담사가 오면 여기에 추가한다.
var CHANNEL_MANAGERS = {
  '623139': '김순옥',
  '623618': '진수진',
  '670617': '박재혁',
  '695140': '민지영',
};

function previewWorkDaily() {
  var result = readWorkSheet_();
  var msg = (result.errors.length
    ? '오류 ' + result.errors.length + '건:\n' + result.errors.slice(0, 30).join('\n')
    : '정상 — 전송 대상 ' + result.rows.length + '행 (' + summarize_(result.rows) + ')') +
    (result.notes.length ? '\n\n참고:\n' + result.notes.join('\n') : '');
  Logger.log(msg);
  // alert 는 시트 탭에서 확인을 누를 때까지 실행을 멈추므로 쓰지 않는다. 결과는 실행 로그 + 시트 토스트로만 알린다.
  try { SpreadsheetApp.getActiveSpreadsheet().toast(msg.slice(0, 900), '결과', 30); } catch (e) { /* 트리거 실행 시 UI 없음 */ }
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
  var tz = ss.getSpreadsheetTimeZone();
  var errors = [], notes = [];
  var totals = {}; // date|agent|type -> { count, seconds }
  var add = function (date, name, type, count, seconds) {
    if (!count && !seconds) return;
    var key = date + '|' + maskName_(name) + '|' + type;
    var t = totals[key] || (totals[key] = { count: 0, seconds: 0 });
    t.count += count;
    t.seconds += seconds;
  };

  // ── 제네시스_<이름> : 통화 수신·발신 ──
  var genesysTabs = ss.getSheets().filter(function (s) { return s.getName().indexOf(GENESYS_PREFIX) === 0; });
  if (!genesysTabs.length) errors.push('"' + GENESYS_PREFIX + '이름" 탭이 없습니다.');
  genesysTabs.forEach(function (sheet) {
    var tab = sheet.getName();
    var t = readTable_(sheet, ['간격 시작', '상담원 이름', '응답됨', '발신', '총 대화']);
    if (t.error) return errors.push(tab + ': ' + t.error);
    var seen = {};
    t.rows.forEach(function (row) {
      var line = tab + ' ' + row.line + '행';
      var name = norm_(row.text['상담원 이름']) || tab.slice(GENESYS_PREFIX.length);
      var date = toDateKey_(row.raw['간격 시작'], row.text['간격 시작'], tz);
      if (!date) return errors.push(line + ': 날짜 형식 오류 (' + row.text['간격 시작'] + ')');
      if (seen[date]) return errors.push(line + ': ' + date + ' 중복 (' + seen[date] + '행과 같은 날짜)');
      seen[date] = row.line;
      var inCnt = toNumber_(row.text['응답됨']), outCnt = toNumber_(row.text['발신']);
      var talkMs = toNumber_(String(row.raw['총 대화']));
      if (inCnt === null || outCnt === null || talkMs === null) return errors.push(line + ': 숫자 형식 오류');
      var talkSec = Math.round(talkMs / 1000);
      var both = inCnt + outCnt;
      var inSec = both ? Math.round(talkSec * inCnt / both) : 0;
      add(date, name, 'call_in', inCnt, inSec);
      add(date, name, 'call_out', outCnt, both ? talkSec - inSec : 0);
    });
  });

  // ── 채널톡 : 채팅 1건 = 1행, 참여 상담사마다 1건 ──
  var ch = ss.getSheetByName(CHANNEL_SHEET);
  if (!ch) errors.push('"' + CHANNEL_SHEET + '" 탭이 없습니다.');
  else {
    var t2 = readTable_(ch, ['managedAt', 'managerIds']);
    if (t2.error) errors.push(CHANNEL_SHEET + ': ' + t2.error);
    else {
      var seenChat = {}, dup = 0;
      t2.rows.forEach(function (row) {
        var id = norm_(row.text['id']);
        if (id) { if (seenChat[id]) { dup++; return; } seenChat[id] = true; }
        var date = toDateKey_(row.raw['managedAt'], row.text['managedAt'], tz);
        if (!date) return errors.push(CHANNEL_SHEET + ' ' + row.line + '행: 날짜 형식 오류 (' + row.text['managedAt'] + ')');
        String(row.text['managerIds']).split(/[,\s]+/).filter(Boolean).forEach(function (mid) {
          var name = CHANNEL_MANAGERS[mid];
          if (name) add(date, name, 'chat', 1, 0);
        });
      });
      if (dup) notes.push('채널톡: 같은 id 중복 ' + dup + '행은 1번만 셌습니다.');
    }
  }

  // ── 개통 ──
  var op = ss.getSheetByName(OPEN_SHEET);
  if (!op) errors.push('"' + OPEN_SHEET + '" 탭이 없습니다.');
  else {
    var t3 = readTable_(op, ['날짜', '상담사', '건수', '소요시간(분)']);
    if (t3.error) errors.push(OPEN_SHEET + ': ' + t3.error);
    else t3.rows.forEach(function (row) {
      var line = OPEN_SHEET + ' ' + row.line + '행';
      var name = norm_(row.text['상담사']);
      var date = toDateKey_(row.raw['날짜'], row.text['날짜'], tz);
      if (!date) return errors.push(line + ': 날짜 형식 오류 (' + row.text['날짜'] + ')');
      if (!name) return errors.push(line + ': 상담사가 비어 있습니다.');
      var cnt = toNumber_(row.text['건수']), min = toNumber_(row.text['소요시간(분)']);
      if (cnt === null || min === null || cnt < 0 || min < 0) return errors.push(line + ': 건수·소요시간 형식 오류');
      add(date, name, 'open', Math.round(cnt), Math.round(min * 60));
    });
  }

  var rows = Object.keys(totals).sort().map(function (key) {
    var p = key.split('|');
    return { date: p[0], agent: p[1], work_type: p[2], count: totals[key].count, seconds: totals[key].seconds };
  });
  return { rows: rows, errors: errors, notes: notes };
}

// 1~5행에서 필수 헤더가 모두 있는 행을 찾아, 이후 행을 { line, raw{헤더:값}, text{헤더:표시값} } 로 돌려준다.
function readTable_(sheet, required) {
  var range = sheet.getDataRange();
  var values = range.getValues(), display = range.getDisplayValues();
  var headerRow = -1;
  for (var r = 0; r < Math.min(5, display.length) && headerRow === -1; r++) {
    var cells = display[r].map(norm_);
    if (required.every(function (h) { return cells.indexOf(h) !== -1; })) headerRow = r;
  }
  if (headerRow === -1) return { error: '1~5행에서 헤더(' + required.join(', ') + ')를 찾지 못했습니다.' };
  var head = display[headerRow].map(norm_);
  var rows = [];
  for (var i = headerRow + 1; i < values.length; i++) {
    if (display[i].every(function (v) { return norm_(v) === ''; })) continue;
    var raw = {}, text = {};
    head.forEach(function (h, c) { if (h && !(h in raw)) { raw[h] = values[i][c]; text[h] = display[i][c]; } });
    rows.push({ line: i + 1, raw: raw, text: text });
  }
  return { rows: rows };
}

function norm_(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }

function toNumber_(text) {
  var s = norm_(text).replace(/,/g, '');
  if (s === '') return 0;
  var n = Number(s);
  return isNaN(n) ? null : n;
}

// 날짜 셀 → yyyy-MM-dd. 날짜 값, '2026-05-01 9:03', '26. 5. 1 0:00'(연도 2자리) 모두 인식.
function toDateKey_(raw, text, tz) {
  if (raw instanceof Date && !isNaN(raw.getTime())) return Utilities.formatDate(raw, tz, 'yyyy-MM-dd');
  var m = norm_(text).match(/^(\d{2}|\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (!m) return null;
  var y = m[1].length === 2 ? '20' + m[1] : m[1];
  return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
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
  return '수신 ' + (t.call_in || 0) + '건, 발신 ' + (t.call_out || 0) + '건, 채널톡 ' + (t.chat || 0) + '건, 개통 ' + (t.open || 0) + '건';
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
