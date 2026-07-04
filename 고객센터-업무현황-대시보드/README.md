# MVNO 고객센터 업무현황 대시보드

**배포 URL**: [https://hyunmo-cmd.github.io/MVNO-Projects/cs-dashboard.html](https://hyunmo-cmd.github.io/MVNO-Projects/cs-dashboard.html)

---

## 개요

MVNO(알뜰폰) 고객센터 상담원별 업무 현황을 시각화하는 단일 HTML 대시보드입니다. Google Sheets 동기화, 채널톡/전화 엑셀 파일 업로드, AI 자연어 입력을 통해 데이터를 수집하고, Canvas2D 기반 차트와 랭킹 테이블로 현황을 표시합니다.

---

## 주요 기능

### 데이터 수집 방식

| 방식 | 설명 |
|---|---|
| **Google Sheets 동기화** | gviz API를 통해 실시간 스프레드시트 데이터 로드 |
| **파일 업로드** | 전화 상담(Excel), 채널톡(Excel) 파일 업로드 및 파싱 |
| **AI 자연어 입력** | 키워드 패턴 매칭 기반 자연어 업무 데이터 입력 |

### 화면 구성

- **1행**: KPI 카드 (총 상담, 평균 처리시간, 채널톡 건수, 처리율)
- **2행**: 채널별 도넛 차트 + 일자별 트렌드 라인 차트
- **3행**: 트렌드 차트 + 처리율 수평 막대 차트 + 처리시간 순위 (TOP 5)
- **4행**: 상담원별 상세 테이블 + 업로드 파일 현황 테이블

---

## 데이터 저장 구조

브라우저 `localStorage`에 3개의 독립 키로 저장:

```
mvno-dashboard-rows-v1    → Google Sheets 동기화 데이터
mvno-upload-rows-v1       → 파일 업로드 데이터 (Excel/CSV)
mvno-manual-rows-v1       → AI/수동 입력 데이터
mvno-ai-learning-v1       → AI 학습 데이터 (키워드 매핑)
```

**분리 이유**: 동기화 버튼 클릭 시 Google Sheets 데이터만 갱신되고, 파일 업로드·수동 입력 데이터는 유지됩니다. `loadRows()` 호출마다 세 키의 데이터를 병합(`mergeUploadRowsIntoState`, `mergeManualRows`)하여 최종 표시합니다.

---

## 파일 구조

```
고객센터-업무현황-대시보드/
├── mvno-dashboard.html    # 개발 원본
└── README.md              # 이 파일

docs/
└── cs-dashboard.html      # GitHub Pages 배포 파일 (mvno-dashboard.html과 동기화)
```

---

## 주요 기술 결정 사항

### 채널톡 처리시간 계산

채널톡 Excel의 `totalReplyTime` 필드는 **누적 대기 시간(초)** 이며, 전화 상담의 '통화시간'과 성격이 다릅니다.

```javascript
const totalSec = toNumber(rec["totalReplyTime"]);
const rawMin = Math.round(totalSec / managers.length / 60);
const minutes = Math.min(10, Math.max(5, rawMin || 5));  // 건당 5~10분 고정
```

- 원시값을 그대로 사용하면 1000분 이상의 이상값 발생
- 채널톡 특성상 건당 5~10분으로 클램핑 처리

### AI 자연어 입력

외부 API 없이 규칙 기반 키워드 패턴 매칭으로 구현:

```
"오전 10시에 유선 상담 5건 처리했어요" →
  날짜: 오늘, 채널: 유선상담, 건수: 5
```

사용자가 입력할수록 `mvno-ai-learning-v1`에 패턴이 누적되어 인식률 향상.

**날짜 인식 우선순위**:
1. `YYYY-MM-DD` / `YYYY.MM.DD` / `YYYY/MM/DD`
2. `M월 D일`
3. `M/D` 또는 `M.D` (월 1-12, 일 1-31 범위 검증 포함)
4. 없으면 로컬 기준 오늘 날짜

날짜+건수가 같은 줄에 있어도(`6/27 채널톡 5건`) 다음 줄에 날짜가 전파됩니다.

### 상담원 ID 매핑

```
623139 → 김*옥
623618 → 진*진
```

채널톡 Excel의 숫자형 담당자 ID를 이름으로 변환하여 표시.

### 도넛 차트 빈틈 제거

세그먼트 사이 흰색 `fillRect` 구분선 코드 제거 → 자연스러운 연결.

---

## 주요 변경 이력

| 항목 | 내용 |
|---|---|
| UI/UX 전면 리디자인 | 디자인 토큰 기반 CSS, KPI 카드·차트·테이블 레이아웃 재구성 |
| 데이터 영속성 수정 | 동기화 버튼이 파일 업로드·수동 입력 데이터를 지우던 버그 수정 |
| 채널톡 처리시간 수정 | 1000분 이상 이상값 → 건당 5~10분 클램핑 |
| AI 자연어 입력 | 수동 폼 → 자연어 텍스트 입력 + 규칙 기반 NLP |
| 파일 업로드 취소 | 업로드된 파일 개별 취소(X 버튼) 기능 추가 |
| 도넛 차트 빈틈 제거 | 세그먼트 간 흰색 구분선 제거 |
| 처리시간 순위 TOP 5 | 랭킹 표시를 5위까지로 제한 |
| 다중 날짜 파싱 | AI 입력 시 날짜 헤더 줄 기준으로 각 행의 날짜 개별 적용 |
| AI 날짜 자동인식 버그 수정 | 날짜+건수 동일 줄일 때 다음 줄 날짜 미전파 / 분수·소수 오탐지 → 비유효 날짜로 입력칸 빈칸 표시 / today 계산 UTC→로컬 변환 |

---

## 로컬 실행

별도 빌드 불필요. 브라우저에서 파일 직접 열기:

```
open mvno-dashboard.html
```

또는 개발 서버 없이 GitHub Pages URL로 접근.
