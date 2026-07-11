/**
 * 유선 문의(STT 분류) 기록 저장/조회 API
 *
 * "유선 문의 기록" 시트에 날짜/상담사/통화시간/문의유형/신뢰도/건수 컬럼으로 누적 저장한다.
 * 헤더가 없으면 처음 실행 시 자동으로 만든다.
 *
 * 배포 방법:
 * 1. Google Sheets에서 새 스프레드시트를 만들고, 주소창의 ID를 복사해 아래 SPREADSHEET_ID에 붙여넣기
 *    (예: https://docs.google.com/spreadsheets/d/여기가ID/edit)
 * 2. 스프레드시트 메뉴 > 확장 프로그램 > Apps Script 에서 이 코드를 붙여넣기
 * 3. 배포 > 새 배포 > 유형: 웹 앱
 *    - 실행 사용자: 나
 *    - 액세스 권한이 있는 사용자: 전체
 * 4. 배포된 웹 앱 URL을 대시보드의 PHONE_API_URL 값으로 설정
 */

var SPREADSHEET_ID = 'REPLACE_WITH_YOUR_SPREADSHEET_ID';
var SHEET_NAME = '유선 문의 기록';
var HEADER = ['date', 'agent', 'durationMin', 'type', 'confidence', 'count'];

function doGet(e) {
  var records;
  try {
    records = readAllRecords();
  } catch (err) {
    return jsonOutput({ error: String(err), records: [] });
  }
  return jsonOutput({ records: records });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var records = body.records || [];
    appendRecords(records);
    return jsonOutput({ ok: true, appended: records.length });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  }
}

function getSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADER);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADER);
  }
  return sheet;
}

function readAllRecords() {
  var sheet = getSheet();
  var values = sheet.getDataRange().getValues();
  var records = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (!row[0]) continue;
    records.push({
      date: formatDateCell(row[0]),
      agent: String(row[1] || ''),
      durationMin: Number(row[2]) || 0,
      type: String(row[3] || ''),
      confidence: Number(row[4]) || 0,
      count: Number(row[5]) || 1
    });
  }
  return records;
}

function appendRecords(records) {
  var sheet = getSheet();
  records.forEach(function (r) {
    sheet.appendRow([r.date, r.agent, r.durationMin, r.type, r.confidence, r.count || 1]);
  });
}

function formatDateCell(cell) {
  if (cell instanceof Date) {
    return Utilities.formatDate(cell, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(cell);
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
