# LG 요금제 혜택 발송 대시보드

## 배포 링크

**GitHub Pages**: https://hyunmo-cmd.github.io/MVNO-Projects/

## 파일

| 파일 | 설명 |
|---|---|
| `lg-혜택-발송-대시보드.zip` | 대시보드 HTML 단일 파일 — 브라우저에서 직접 열거나 공유 시 사용 |
| `../docs/index.html` | GitHub Pages 배포 소스 (이 파일을 수정 → push → 자동 배포) |

---

## 프로젝트 개요

LG 고객 요금제별 혜택 발송 관리용 웹 대시보드.

- **단일 HTML 파일** — 별도 서버 설치 없이 브라우저에서 바로 실행
- **암호화된 Excel(xlsx) 복호화 지원** — OOXML AgileEncryption 방식
- **고객 데이터 보안** — 업로드된 파일은 브라우저 메모리에만 유지, 완료 시 자동 삭제(휘발성)
- **WebCrypto API 사용** — HTTPS 또는 localhost(127.0.0.1) 환경에서만 작동

---

## 사용 방법

### 온라인 (GitHub Pages)
1. https://hyunmo-cmd.github.io/MVNO-Projects/ 접속
2. 암호화된 Excel 파일 업로드 + 암호 입력 → 자동 복호화
3. 혜택 발송 현황 확인 및 관리

### 오프라인 (ZIP 파일)
1. `lg-혜택-발송-대시보드.zip` 압축 해제
2. `index.html` 브라우저로 열기
3. (암호화 Excel 사용 시 localhost 환경 필요 — WebCrypto 제한)

---

## 기술 스택

- **단일 HTML** (JavaScript 인라인, 외부 의존성 없음)
- **WebCrypto API** (`crypto.subtle`) — OOXML AgileEncryption 복호화
- **암호화 흐름**:
  1. CFB 파일 파싱 → `EncryptionInfo`(XML), `EncryptedPackage` 스트림 추출
  2. `agileHashPassword` (SHA-512, spinCount=100,000) → 파생키 생성
  3. `aesCbcDecryptRaw` — Zero-padding 대응 (PKCS#7 자동제거 우회)
  4. 4,096바이트 청크 복호화 → 원본 XLSX(ZIP) 반환

---

## 주요 해결 이력

| 날짜 | 내용 |
|---|---|
| 2026-06-19 | AES-CBC PKCS#7 Zero-padding 버그 수정 (`aesCbcDecryptRaw` 도입) |
| 2026-06-19 | 복호화 진행률 표시 추가 (5,000번마다 퍼센트 업데이트) |
| 2026-06-20 | `encryptedKeyValue` 복호화 시 `aesCbcDecrypt` → `aesCbcDecryptRaw` 변경 |

---

## 보안 요건 (변경 불가)

- 고객 데이터는 휘발성 — 완료 버튼 클릭 시 `clearSession()`으로 즉시 삭제
- 파일 업로드 + 별도 암호 입력란 유지
- 개인정보 보호를 위해 서버 전송 없음 (순수 클라이언트 사이드)

---

*마지막 업데이트: 2026-06-20*
