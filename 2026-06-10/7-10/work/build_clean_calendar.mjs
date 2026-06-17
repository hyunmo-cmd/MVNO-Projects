import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = "C:/Users/user/Documents/Codex/2026-06-10/7-10";
const outputDir = path.join(root, "outputs");
const previewDir = path.join(root, "work", "clean-calendar-previews");
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });

const year = 2026;
const months = [
  { month: 7, title: "2026년 7월" },
  { month: 8, title: "2026년 8월" },
  { month: 9, title: "2026년 9월" },
];
const sheetNames = [
  "주 5일 근무_공휴일 포함",
  "주 5일 근무_공휴일 미포함",
  "주 4일 근무_공휴일 포함",
];
const dayNames = ["일", "월", "화", "수", "목", "금", "토"];

const holidays = new Map([
  ["2026-08-15", "광복절"],
  ["2026-08-17", "광복절 대체공휴일"],
  ["2026-09-24", "추석 연휴"],
  ["2026-09-25", "추석"],
  ["2026-09-26", "추석 연휴"],
  ["2026-09-27", "추석 연휴"],
  ["2026-09-28", "추석 대체공휴일"],
]);

function pad(n) {
  return String(n).padStart(2, "0");
}

function dateKey(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function isHoliday(month, day) {
  return holidays.has(dateKey(year, month, day));
}

function colorFor(month, day, dow) {
  if (!day) return "#94A3B8";
  if (isHoliday(month, day) || dow === 0) return "#D93025";
  if (dow === 6) return "#1A73E8";
  return "#111827";
}

function fillMonth(sheet, startRow, monthInfo) {
  const { month, title } = monthInfo;
  const firstDow = new Date(year, month - 1, 1).getDay();
  const lastDay = new Date(year, month, 0).getDate();

  sheet.getRangeByIndexes(startRow, 0, 1, 7).merge();
  const titleRange = sheet.getRangeByIndexes(startRow, 0, 1, 7);
  titleRange.values = [[title]];
  titleRange.format = {
    fill: "#17324D",
    font: { bold: true, color: "#FFFFFF", size: 14 },
    horizontalAlignment: "center",
    verticalAlignment: "middle",
    borders: { preset: "all", style: "thin", color: "#17324D" },
  };
  titleRange.format.rowHeightPx = 30;

  const header = sheet.getRangeByIndexes(startRow + 1, 0, 1, 7);
  header.values = [dayNames];
  header.format = {
    fill: "#DBEAFE",
    font: { bold: true, color: "#1F2937" },
    horizontalAlignment: "center",
    verticalAlignment: "middle",
    borders: { preset: "all", style: "thin", color: "#CBD5E1" },
  };
  sheet.getCell(startRow + 1, 0).format.font = { bold: true, color: "#D93025" };
  sheet.getCell(startRow + 1, 6).format.font = { bold: true, color: "#1A73E8" };

  let day = 1;
  for (let week = 0; week < 6; week++) {
    const row = startRow + 2 + week;
    const values = [];
    for (let dow = 0; dow < 7; dow++) {
      if ((week === 0 && dow < firstDow) || day > lastDay) {
        values.push("");
      } else {
        values.push(day);
        day += 1;
      }
    }
    sheet.getRangeByIndexes(row, 0, 1, 7).values = [values];
    for (let dow = 0; dow < 7; dow++) {
      const value = values[dow];
      const cell = sheet.getCell(row, dow);
      const holiday = value ? isHoliday(month, value) : false;
      cell.format = {
        fill: value ? "#FFFFFF" : "#F1F5F9",
        font: { bold: true, color: colorFor(month, value, dow), size: 12 },
        horizontalAlignment: "center",
        verticalAlignment: "middle",
        borders: { preset: "all", style: "thin", color: "#CBD5E1" },
      };
      if (holiday) {
        cell.format.fill = "#FFF1F2";
      }
    }
  }

  sheet.getRangeByIndexes(startRow + 8, 0, 1, 7).values = [["", "", "", "", "", "", ""]];
}

const workbook = Workbook.create();

for (const name of sheetNames) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  for (let col = 0; col < 7; col++) {
    sheet.getCell(0, col).format.columnWidthPx = 82;
  }
  let startRow = 0;
  for (const monthInfo of months) {
    fillMonth(sheet, startRow, monthInfo);
    startRow += 10;
  }
  sheet.freezePanes.freezeRows(0);
}

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan",
});
console.log(errors.ndjson);

for (const sheetName of sheetNames) {
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
const outPath = path.join(outputDir, "customer-center-calendar-2026-jul-sep.xlsx");
await output.save(outPath);
console.log(`saved=${outPath}`);
