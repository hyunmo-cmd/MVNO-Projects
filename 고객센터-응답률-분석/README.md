# 고객센터 응답률 분석 자동화

## 작업 목적

Google Sheets에 저장된 고객센터 인입전화 데이터를 분석하여, **일별·월별 응답률 통계 시트를 자동 생성**하는 것이 목표입니다.

- 원본 데이터: 5월/6월 고객센터 인입전화 로그
- 목표 결과물: "고객센터 응답률 분석" 시트 (일별/월별 응답률 집계)

---

## 대상 스프레드시트

- **URL**: https://docs.google.com/spreadsheets/d/1YZWhHDTcUGycjrpYxlIT0BPh-0RGCUNh6V9AlgEitEk/edit
- **Spreadsheet ID**: `1YZWhHDTcUGycjrpYxlIT0BPh-0RGCUNh6V9AlgEitEk`

### 시트 목록

| 시트 이름 | 설명 |
|---|---|
| `5월 고객센터 인입전화` | 2026년 5월 인입전화 로그 |
| `6월 고객센터 인입 전화` | 2026년 6월 인입전화 로그 (시트명에 공백 주의) |
| `고객센터 응답률 분석` | **생성 목표** — 아직 미완성 |

---

## 원본 데이터 구조

각 시트의 열 구성 (헤더 행 기준):

| 열 | 컬럼명 | 분석 사용 여부 | 설명 |
|---|---|---|---|
| A | 전체 내보내기 완료 | ✗ | |
| B | 부분 결과 타임스탬프 | ✗ | |
| C | 필터 | ✗ | |
| D | 미디어 유형 | ✗ | 모두 "음성" |
| **E** | **사용자** | ✅ | **응답한 직원명. 공백이면 미응답** |
| F | 원격 | ✗ | |
| **G** | **날짜** | ✅ | **통화 날짜 (Date 객체)** |
| H | 기간 | ✗ | 밀리초 단위 통화 시간 |
| I | 방향 | ✗ | 모두 "수신" |
| J | ANI | ✗ | 발신자 번호 (개인정보) |
| K | DNIS | ✗ | 수신 번호 |
| **L** | **큐** | ✅ | **콜 큐. 공백이면 해당 행 분석에서 제외** |
| M | 마무리 | ✗ | |

### 핵심 비즈니스 룰

1. **L열(큐)이 공백인 행은 전체 제외** — 유효한 인입 건으로 보지 않음
2. **E열(사용자)이 공백이면 미응답** — 아무도 응답하지 않은 콜
3. **개인정보(이름, 전화번호 등)는 결과 시트에 포함하지 않음**

---

## 데이터 현황 (WebFetch 부분 집계, 참고용)

> WebFetch 도구의 한계로 각 시트의 일부 데이터만 수집됨. Apps Script 실행 시 전체 데이터 처리됨.

### 5월 (부분 집계, ~5/12까지)

| 날짜 | 응답 | 미응답 | 합계 |
|---|---|---|---|
| 5/1 | 10 | 8 | 18 |
| 5/2 | 5 | 8 | 13 |
| 5/3 | 0 | 4 | 4 |
| 5/4 | 60 | 48 | 108 |
| 5/5 | 12 | 0 | 12 |
| 5/6 | 65 | 50 | 115 |
| 5/7 | 42 | 16 | 58 |
| 5/8 | 82 | 45 | 127 |
| 5/9 | 3 | 13 | 16 |
| 5/10 | 0 | 11 | 11 |
| 5/11 | 148 | 292 | 440 |
| 5/12 | 19 | 28 | 47 |
| **소계** | **446** | **523** | **969** |

### 6월 (부분 집계, ~6/12까지)

| 날짜 | 응답 | 미응답 | 합계 |
|---|---|---|---|
| 6/1 | 13 | 19 | 32 |
| 6/2 | 10 | 33 | 43 |
| 6/3 | 10 | 10 | 20 |
| 6/4 | 32 | 47 | 79 |
| 6/5 | 20 | 50 | 70 |
| 6/6 | 4 | 15 | 19 |
| 6/7 | 0 | 4 | 4 |
| 6/8 | 22 | 43 | 65 |
| 6/9 | 25 | 48 | 73 |
| 6/10 | 31 | 70 | 101 |
| 6/11 | 21 | 45 | 66 |
| 6/12 | 11 | 23 | 34 |
| **소계** | **179** | **337** | **516** |

---

## 생성한 코드 (Google Apps Script)

스프레드시트에서 **확장 프로그램 → Apps Script** 에 붙여넣고 실행하면 `고객센터 응답률 분석` 시트가 자동 생성됩니다.

```javascript
function createResponseRateAnalysis() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const MAY_SHEET  = '5월 고객센터 인입전화';
  const JUNE_SHEET = '6월 고객센터 인입 전화';
  const OUT_SHEET  = '고객센터 응답률 분석';

  const COL_USER  = 4;   // E열: 응답 직원
  const COL_DATE  = 6;   // G열: 날짜
  const COL_QUEUE = 11;  // L열: 큐 (공백이면 제외)

  function processSheet(sheetName) {
    const src = ss.getSheetByName(sheetName);
    if (!src) { Logger.log('시트 없음: ' + sheetName); return null; }

    const data = src.getDataRange().getValues();
    const daily = {};

    for (let i = 1; i < data.length; i++) {
      const row   = data[i];
      const queue = (row[COL_QUEUE] || '').toString().trim();
      if (!queue) continue;   // L열 공백 → 제외

      const dateVal = row[COL_DATE];
      let key = '';
      if (dateVal instanceof Date) {
        const d = dateVal;
        key = d.getFullYear() + '-'
            + String(d.getMonth() + 1).padStart(2, '0') + '-'
            + String(d.getDate()).padStart(2, '0');
      } else {
        key = dateVal.toString().trim();
      }
      if (!key) continue;

      if (!daily[key]) daily[key] = { answered: 0, total: 0 };
      daily[key].total++;

      const user = (row[COL_USER] || '').toString().trim();
      if (user) daily[key].answered++;
    }
    return daily;
  }

  // 출력 시트 준비
  let out = ss.getSheetByName(OUT_SHEET);
  if (out) { out.clear(); } else { out = ss.insertSheet(OUT_SHEET, 0); }

  const mayDaily  = processSheet(MAY_SHEET);
  const juneDaily = processSheet(JUNE_SHEET);

  let r = 1;

  function row5(row) { return out.getRange(row, 1, 1, 5); }

  // 전체 타이틀
  row5(r).merge()
    .setValue('고객센터 응답률 분석')
    .setBackground('#0d47a1').setFontColor('#ffffff')
    .setFontSize(14).setFontWeight('bold').setHorizontalAlignment('center');
  r += 2;

  const results = {};

  function writeSection(label, daily) {
    if (!daily) return { total: 0, answered: 0 };

    row5(r).merge()
      .setValue('【' + label + ' 일별 응답률】')
      .setBackground('#1565c0').setFontColor('#ffffff').setFontWeight('bold');
    r++;

    row5(r).setValues([['날짜', '전체 인입', '응답', '미응답', '응답률']])
      .setBackground('#bbdefb').setFontWeight('bold').setHorizontalAlignment('center');
    r++;

    const dates = Object.keys(daily).sort();
    let mTotal = 0, mAnswered = 0;

    for (const d of dates) {
      const { total, answered } = daily[d];
      const unanswered = total - answered;
      const rate = total > 0 ? (answered / total * 100).toFixed(1) : '0.0';

      let label2 = d;
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        const p = d.split('-');
        label2 = parseInt(p[1]) + '월 ' + parseInt(p[2]) + '일';
      }

      row5(r).setValues([[label2, total, answered, unanswered, rate + '%']])
        .setHorizontalAlignment('center');

      const n = parseFloat(rate);
      if      (n >= 70) out.getRange(r, 5).setBackground('#c8e6c9');
      else if (n >= 50) out.getRange(r, 5).setBackground('#fff9c4');
      else              out.getRange(r, 5).setBackground('#ffcdd2');

      mTotal += total; mAnswered += answered;
      r++;
    }

    const mRate = mTotal > 0 ? (mAnswered / mTotal * 100).toFixed(1) : '0.0';
    row5(r).setValues([[label + ' 합계', mTotal, mAnswered, mTotal - mAnswered, mRate + '%']])
      .setFontWeight('bold').setBackground('#e3f2fd').setHorizontalAlignment('center');
    const n = parseFloat(mRate);
    if      (n >= 70) out.getRange(r, 5).setBackground('#a5d6a7');
    else if (n >= 50) out.getRange(r, 5).setBackground('#fff176');
    else              out.getRange(r, 5).setBackground('#ef9a9a');
    r += 2;

    return { total: mTotal, answered: mAnswered };
  }

  results.may  = writeSection('5월', mayDaily);
  results.june = writeSection('6월', juneDaily);

  // 월별 요약 테이블
  row5(r).merge()
    .setValue('【월별 요약】')
    .setBackground('#1565c0').setFontColor('#ffffff').setFontWeight('bold');
  r++;

  row5(r).setValues([['구분', '전체 인입', '응답', '미응답', '응답률']])
    .setBackground('#bbdefb').setFontWeight('bold').setHorizontalAlignment('center');
  r++;

  function summaryRow(label, res) {
    const rate = res.total > 0 ? (res.answered / res.total * 100).toFixed(1) : '0.0';
    row5(r).setValues([[label, res.total, res.answered, res.total - res.answered, rate + '%']])
      .setHorizontalAlignment('center');
    const n = parseFloat(rate);
    if      (n >= 70) out.getRange(r, 5).setBackground('#c8e6c9');
    else if (n >= 50) out.getRange(r, 5).setBackground('#fff9c4');
    else              out.getRange(r, 5).setBackground('#ffcdd2');
    r++;
  }

  summaryRow('5월', results.may);
  summaryRow('6월', results.june);

  const allTotal    = results.may.total    + results.june.total;
  const allAnswered = results.may.answered + results.june.answered;
  const allRate     = allTotal > 0 ? (allAnswered / allTotal * 100).toFixed(1) : '0.0';
  row5(r).setValues([['전체', allTotal, allAnswered, allTotal - allAnswered, allRate + '%']])
    .setFontWeight('bold').setBackground('#e3f2fd').setHorizontalAlignment('center');
  const allN = parseFloat(allRate);
  if      (allN >= 70) out.getRange(r, 5).setBackground('#a5d6a7');
  else if (allN >= 50) out.getRange(r, 5).setBackground('#fff176');
  else                 out.getRange(r, 5).setBackground('#ef9a9a');

  [120, 80, 80, 80, 80].forEach((w, i) => out.setColumnWidth(i + 1, w));

  SpreadsheetApp.getUi().alert('✅ 고객센터 응답률 분석 시트가 생성되었습니다!\n\n응답률 색상 기준:\n🟢 70% 이상\n🟡 50~69%\n🔴 50% 미만');
}
```

---

## 해결한 문제

| 문제 | 해결 방법 |
|---|---|
| 데이터 구조 파악 | WebFetch로 CSV 접근 (gviz/tq 엔드포인트 활용) |
| 유효 인입 건 필터링 | L열(큐) 공백 여부로 판단 |
| 응답 여부 판단 | E열(사용자) 공백 여부로 판단 |
| 개인정보 제외 | 집계값(숫자)만 결과 시트에 기록, 이름/번호 미포함 |
| 응답률 시각화 | 70%↑ 초록 / 50~69% 노랑 / 50%↓ 빨강 색상 코딩 |

---

## 현재 진행 상황

- [x] 스프레드시트 데이터 구조 파악
- [x] 분석 로직 설계 (L열 필터 + E열 응답 여부)
- [x] Google Apps Script 코드 작성 완료
- [ ] **스프레드시트에 결과 시트 실제 생성** ← 미완료

---

## 남은 작업

### 즉시 실행 가능한 방법 (권장)

**Apps Script 실행 (약 30초 소요):**
1. 스프레드시트 열기
2. 상단 메뉴 **확장 프로그램 → Apps Script**
3. 기존 코드 전체 삭제
4. 위 코드 붙여넣기
5. **▶ 실행** 클릭 → 권한 허용
6. `고객센터 응답률 분석` 시트 자동 생성 확인

### 향후 자동화 고려사항

- **7월 이후 시트 추가 대응**: `processSheet()` 호출을 추가하고 `writeSection()`에 해당 월 데이터 전달
- **월별 시트 자동 감지**: 시트 이름 패턴(`*월 고객센터*`)으로 자동 수집하도록 확장 가능
- **정기 업데이트**: Apps Script의 트리거 기능으로 매일 자동 실행 설정 가능 (`createTrigger` 추가)

---

## 환경 및 제약사항

### Google Drive MCP 인증 문제

- Claude Code(CLI/데스크톱) 환경에서 `claude.ai Google Drive` MCP는 직접 인증 불가
- 해당 MCP는 **claude.ai 웹 브라우저 환경에서만 정상 작동**
- Claude Code에서 Google Sheets를 직접 편집하려면 별도 서비스 계정 키 또는 OAuth 토큰 필요

### 대안

| 방법 | 가능 여부 |
|---|---|
| Apps Script 직접 실행 | ✅ 바로 가능 |
| claude.ai 웹에서 Google Drive 연동 후 편집 | ✅ 가능 |
| Claude Code에서 Google Drive MCP 직접 쓰기 | ❌ 현재 환경에서 불가 |

---

## 다음 세션에서 이어받는 방법

1. 이 README를 먼저 읽어 전체 맥락 파악
2. Apps Script가 아직 실행되지 않았다면 위 코드를 실행
3. 실행 완료 후 추가 요청사항(예: 큐별 분석, 시간대별 분석, 차트 추가) 이어서 작업
4. 7월 데이터 시트가 추가되면 스크립트 내 `JUNE_SHEET` 아래에 동일한 패턴으로 월 추가

---

*작업일: 2026-06-17*
