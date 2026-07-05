/**
 * 채널톡 문의 유형 / 고객 대기시간 데이터 API
 *
 * 대상 스프레드시트: 채널톡 민원 관리
 * https://docs.google.com/spreadsheets/d/1RnjRMLbEsood4QMqugtj0N6U-FKOsKILPMkiIbewgX8
 *
 * "문의 유형_*" 시트와 "문의별 고객 평균 대기시간(DAY)_*" 시트를 이름 패턴으로 자동 탐색해
 * 월이 추가돼도 코드 수정 없이 동작한다. 각 시트에서 "날짜" 헤더 셀을 찾아 그 오른쪽 컬럼들을
 * 문의 유형 카테고리로 읽고, "총 계"로 시작하는 행은 집계에서 제외한다.
 *
 * 배포 방법:
 * 1. 스프레드시트 메뉴 > 확장 프로그램 > Apps Script 에서 이 코드를 붙여넣기
 * 2. 배포 > 새 배포 > 유형: 웹 앱
 *    - 실행 사용자: 나
 *    - 액세스 권한이 있는 사용자: 전체
 * 3. 배포된 웹 앱 URL을 대시보드의 CT_API_URL 값으로 설정
 */

var SPREADSHEET_ID = '1RnjRMLbEsood4QMqugtj0N6U-FKOsKILPMkiIbewgX8';
var COUNT_SHEET_PREFIX = '문의 유형';
var WAIT_SHEET_PREFIX = '문의별 고객 평균 대기시간';

function doGet(e) {
  var payload;
  try {
    payload = buildPayload();
  } catch (err) {
    payload = { error: String(err), categories: [], days: [] };
  }
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function buildPayload() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var countSheetsByMonth = {};
  var waitSheetsByMonth = {};

  ss.getSheets().forEach(function (sheet) {
    var name = sheet.getName().trim();
    if (name.indexOf(WAIT_SHEET_PREFIX) === 0) {
      waitSheetsByMonth[monthKey(name, WAIT_SHEET_PREFIX)] = sheet;
    } else if (name.indexOf(COUNT_SHEET_PREFIX) === 0) {
      countSheetsByMonth[monthKey(name, COUNT_SHEET_PREFIX)] = sheet;
    }
  });

  var categorySeen = {};
  var categoryOrder = [];
  var days = [];

  Object.keys(countSheetsByMonth).forEach(function (month) {
    var countTable = readSheetTable(countSheetsByMonth[month]);
    var waitTable = waitSheetsByMonth[month] ? readSheetTable(waitSheetsByMonth[month]) : null;

    var waitByDate = {};
    if (waitTable) {
      waitTable.rows.forEach(function (row) { waitByDate[row.date] = row.values; });
    }

    countTable.categories.forEach(function (name) {
      if (!categorySeen[name]) {
        categorySeen[name] = true;
        categoryOrder.push(name);
      }
    });

    countTable.rows.forEach(function (row) {
      var waitValues = waitByDate[row.date];
      var weightedSum = 0;
      var weightTotal = 0;
      if (waitValues) {
        countTable.categories.forEach(function (name) {
          var cnt = row.values[name] || 0;
          var sec = waitValues[name] || 0;
          if (cnt > 0 && sec > 0) {
            weightedSum += cnt * sec;
            weightTotal += cnt;
          }
        });
      }
      days.push({
        date: row.date,
        total: row.total,
        counts: row.values,
        avgWaitSec: weightTotal > 0 ? Math.round(weightedSum / weightTotal) : null
      });
    });
  });

  days.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });

  return {
    generatedAt: new Date().toISOString(),
    categories: categoryOrder,
    days: days
  };
}

function monthKey(sheetName, prefix) {
  var rest = sheetName.substring(prefix.length);
  var underscoreIdx = rest.lastIndexOf('_');
  return (underscoreIdx >= 0 ? rest.substring(underscoreIdx + 1) : rest).trim();
}

function readSheetTable(sheet) {
  var values = sheet.getDataRange().getValues();
  var headerRow = -1, dateCol = -1;

  for (var r = 0; r < values.length && headerRow === -1; r++) {
    for (var c = 0; c < values[r].length; c++) {
      if (String(values[r][c]).trim() === '날짜') {
        headerRow = r;
        dateCol = c;
        break;
      }
    }
  }
  if (headerRow === -1) return { categories: [], rows: [] };

  var categories = [];
  for (var c2 = dateCol + 1; c2 < values[headerRow].length; c2++) {
    var label = String(values[headerRow][c2]).trim();
    if (label) categories.push(label);
  }

  var rows = [];
  for (var r2 = headerRow + 1; r2 < values.length; r2++) {
    var rawDate = values[r2][dateCol];
    var dateLabel = String(rawDate).trim();
    if (!dateLabel || dateLabel.indexOf('총') === 0) continue;

    var isoDate = normalizeDate(rawDate);
    if (!isoDate) continue;

    var rowValues = {};
    var total = 0;
    for (var i = 0; i < categories.length; i++) {
      var n = toNumber(values[r2][dateCol + 1 + i]);
      rowValues[categories[i]] = n;
      total += n;
    }
    rows.push({ date: isoDate, values: rowValues, total: total });
  }

  return { categories: categories, rows: rows };
}

function toNumber(raw) {
  if (raw instanceof Date) {
    return raw.getHours() * 3600 + raw.getMinutes() * 60 + raw.getSeconds();
  }
  var n = Number(raw);
  return isNaN(n) ? 0 : n;
}

function normalizeDate(cell) {
  if (cell instanceof Date) {
    return Utilities.formatDate(cell, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(cell).trim();
  var m = s.match(/(\d{4})[.\s]+(\d{1,2})[.\s]+(\d{1,2})/);
  if (!m) return null;
  return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}
