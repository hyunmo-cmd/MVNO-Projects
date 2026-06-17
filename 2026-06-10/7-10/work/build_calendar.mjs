import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = "C:/Users/user/Documents/Codex/2026-06-10/7-10";
const outputDir = path.join(root, "outputs");
const previewDir = path.join(root, "work", "previews");
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });

const workbook = Workbook.create();

const year = 2026;
const months = [6, 7, 8, 9]; // zero-based: Jul-Oct
const monthNames = ["7월", "8월", "9월", "10월"];
const dayNames = ["일", "월", "화", "수", "목", "금", "토"];

const colors = {
  navy: "#18324A",
  blue: "#EAF3FB",
  paleBlue: "#F6FAFD",
  line: "#CAD8E4",
  redText: "#B42318",
  grayText: "#526273",
  weekendFill: "#FBF4F3",
  todayFill: "#FFF7D6",
  workFill: "#FFFFFF",
  headerFill: "#DDEBF7",
  noteFill: "#F8FAFC",
};

function setBox(range, fill = colors.workFill) {
  range.format = {
    fill,
    font: { color: "#1F2937" },
    borders: { preset: "all", style: "thin", color: colors.line },
    wrapText: true,
    verticalAlignment: "top",
  };
}

function setHeader(range, fill = colors.navy) {
  range.format = {
    fill,
    font: { bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "middle",
    borders: { preset: "all", style: "thin", color: colors.navy },
  };
}

const settings = workbook.worksheets.add("설정");
settings.showGridLines = false;
settings.getRange("A1:E1").merge();
settings.getRange("A1").values = [["고객센터 근무표 설정"]];
setHeader(settings.getRange("A1:E1"));
settings.getRange("A3:B3").values = [["근무코드", "설명"]];
setHeader(settings.getRange("A3:B3"), colors.headerFill);
settings.getRange("A3:B3").format.font = { bold: true, color: "#18324A" };
settings.getRange("A4:B11").values = [
  ["주간", "주간 근무"],
  ["오전", "오전 근무"],
  ["오후", "오후 근무"],
  ["야간", "야간 근무"],
  ["휴무", "휴무"],
  ["연차", "연차/휴가"],
  ["교육", "교육/회의"],
  ["기타", "기타"],
];
setBox(settings.getRange("A4:B11"));
settings.getRange("D3:E3").values = [["상담원", "비고"]];
setHeader(settings.getRange("D3:E3"), colors.headerFill);
settings.getRange("D3:E3").format.font = { bold: true, color: "#18324A" };
settings.getRange("D4:E23").values = Array.from({ length: 20 }, (_, i) => [`상담원 ${i + 1}`, ""]);
setBox(settings.getRange("D4:E23"));
settings.getRange("A13:E13").merge();
settings.getRange("A13").values = [["사용 메모"]];
setHeader(settings.getRange("A13:E13"), colors.headerFill);
settings.getRange("A13:E13").format.font = { bold: true, color: "#18324A" };
settings.getRange("A14:E18").merge();
settings.getRange("A14").values = [["각 월 탭의 날짜 칸에 상담원명 / 근무코드 / 시간을 자유롭게 입력하세요. 필요 시 이 설정 탭에서 상담원명과 근무코드를 바꿔 사용할 수 있습니다."]];
setBox(settings.getRange("A14:E18"), colors.noteFill);
settings.getRange("A:E").format.autofitColumns();

for (let idx = 0; idx < months.length; idx++) {
  const month = months[idx];
  const sheet = workbook.worksheets.add(`${monthNames[idx]} 근무표`);
  sheet.showGridLines = false;

  sheet.getRange("A1:G1").merge();
  sheet.getRange("A1").values = [[`고객센터 상담원 스케줄 근무표 - ${year}년 ${monthNames[idx]}`]];
  setHeader(sheet.getRange("A1:G1"));
  sheet.getRange("A1:G1").format.font = { bold: true, color: "#FFFFFF", size: 16 };
  sheet.getRange("A1:G1").format.rowHeightPx = 34;

  sheet.getRange("A2:G2").values = [dayNames];
  setHeader(sheet.getRange("A2:G2"), colors.headerFill);
  sheet.getRange("A2:G2").format.font = { bold: true, color: "#18324A" };
  sheet.getRange("A2:G2").format.rowHeightPx = 24;

  for (let c = 0; c < 7; c++) {
    sheet.getCell(1, c).format.columnWidthPx = 140;
  }

  const first = new Date(year, month, 1);
  const lastDate = new Date(year, month + 1, 0).getDate();
  let day = 1;
  for (let week = 0; week < 6; week++) {
    const row = 3 + week * 4;
    sheet.getRangeByIndexes(row - 1, 0, 4, 7).format.rowHeightPx = 27;
    for (let dow = 0; dow < 7; dow++) {
      const dateRow = row;
      const entryStart = row + 1;
      const cellDate = sheet.getCell(dateRow - 1, dow);
      const block = sheet.getRangeByIndexes(dateRow - 1, dow, 4, 1);
      const isBeforeStart = week === 0 && dow < first.getDay();
      const isAfterEnd = day > lastDate;
      if (isBeforeStart || isAfterEnd) {
        setBox(block, "#F3F6F9");
        cellDate.values = [[""]];
        continue;
      }

      const display = `${day}일`;
      cellDate.values = [[display]];
      const isWeekend = dow === 0 || dow === 6;
      setBox(block, isWeekend ? colors.weekendFill : colors.workFill);
      cellDate.format = {
        fill: isWeekend ? "#FCE8E6" : colors.blue,
        font: { bold: true, color: dow === 0 ? colors.redText : "#18324A" },
        borders: { preset: "all", style: "thin", color: colors.line },
        horizontalAlignment: "left",
        verticalAlignment: "middle",
      };
      sheet.getRangeByIndexes(entryStart - 1, dow, 3, 1).values = [[""], [""], [""]];
      day++;
    }
  }

  sheet.getRange("A28:G28").merge();
  sheet.getRange("A28").values = [["월간 메모"]];
  setHeader(sheet.getRange("A28:G28"), colors.headerFill);
  sheet.getRange("A28:G28").format.font = { bold: true, color: "#18324A" };
  sheet.getRange("A29:G33").merge();
  sheet.getRange("A29").values = [[""]];
  setBox(sheet.getRange("A29:G33"), colors.noteFill);

  sheet.getRange("A35:D35").values = [["근무코드", "설명", "인원/시간 메모", "확인"]];
  setHeader(sheet.getRange("A35:D35"), colors.headerFill);
  sheet.getRange("A35:D35").format.font = { bold: true, color: "#18324A" };
  sheet.getRange("A36:D43").values = [
    ["주간", "주간 근무", "", ""],
    ["오전", "오전 근무", "", ""],
    ["오후", "오후 근무", "", ""],
    ["야간", "야간 근무", "", ""],
    ["휴무", "휴무", "", ""],
    ["연차", "연차/휴가", "", ""],
    ["교육", "교육/회의", "", ""],
    ["기타", "기타", "", ""],
  ];
  setBox(sheet.getRange("A36:D43"));

  sheet.freezePanes.freezeRows(2);
}

const inspect = await workbook.inspect({
  kind: "sheet,table",
  maxChars: 5000,
  tableMaxRows: 8,
  tableMaxCols: 8,
});
console.log(inspect.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan",
});
console.log(errors.ndjson);

for (const sheetName of ["7월 근무표", "8월 근무표", "9월 근무표", "10월 근무표", "설정"]) {
  const preview = await workbook.render({
    sheetName,
    autoCrop: "all",
    scale: 1,
    format: "png",
  });
  await fs.writeFile(
    path.join(previewDir, `${sheetName}.png`),
    new Uint8Array(await preview.arrayBuffer()),
  );
}

const output = await SpreadsheetFile.exportXlsx(workbook);
const outPath = path.join(outputDir, "customer-service-schedule-calendar-2026-jul-oct.xlsx");
await output.save(outPath);
console.log(`saved=${outPath}`);
