---
name: mvno_benefit
description: "LG 요금제 혜택 발송 대시보드 프로젝트 — 로컬 웹 대시보드, 암호화 엑셀 복호화, GitHub Pages 배포 현황"
metadata: 
  node_type: memory
  type: project
  originSessionId: b1a0f067-1a64-49e0-977e-aeb59adfde63
---

## 프로젝트 개요
LG 고객 요금제별 혜택 발송 관리용 로컬 웹 대시보드. 고객정보 보안을 위해 파일 데이터는 브라우저 메모리에만 유지(휘발성).

## 파일 위치
- **소스 HTML**: `C:\Users\user\Documents\Codex\2026-06-09\files-mentioned-by-the-user-lg\outputs\lg-plan-benefit-dashboard.html`
- **배포 사본**: `C:\Users\user\Documents\Codex\docs\index.html`
- **Node.js 서버**: `...\work\local_dashboard_server.mjs` (포트 8765, localhost only)
- **실행 배치**: `...\start-dashboard.bat`
- **공유 ZIP**: `C:\Users\user\Desktop\lg-benefit-dashboard.zip`
- **GitHub Pages**: `hyunmo-cmd/MVNO-Projects` 저장소, `docs/` 폴더 → `main` 브랜치 push로 배포
- **GitHub Pages URL**: https://hyunmo-cmd.github.io/MVNO-Projects/

## ZIP 구조 (최상위 폴더 없음, 그대로 압축)
```
outputs/lg-plan-benefit-dashboard.html
start-dashboard.bat
work/local_dashboard_server.mjs
```

## 2026-06-19 작업 현황 (완료)

### 핵심 버그 — AES-CBC PKCS#7 문제 (해결됨)
**원인**: `crypto.subtle.decrypt`(AES-CBC)는 항상 PKCS#7 패딩을 자동 제거함.  
OOXML AgileEncryption의 4096바이트 청크는 Zero-padding(PKCS#7 아님).  
→ 마지막 바이트 값에 따라 데이터 손상 또는 DOMException 발생.

**해결책 (`aesCbcDecryptRaw`)**: 각 청크 뒤에 "가짜 블록" 추가.  
가짜 블록 = `AES_ECB_enc(lastBlock XOR 0x10×16)` → CBC 복호화 시 `0x10×16`으로 복호화됨 → 유효한 16바이트 PKCS#7 패딩으로 인식 → 제거 후 원본 N바이트 반환.  
구현: `crypto.subtle.encrypt(AES-CBC, IV=0, aesInput)` 첫 16바이트 = AES_ECB_enc(aesInput).  
**Node.js로 검증 완료 — 로직 자체는 올바름.**

### 추가 수정 (commit `8395788`, 2026-06-19)
**문제**: `aesCbcDecryptRaw` 수정 후에도 사용자가 "안 된다"고 한 실제 원인:

1. **오해의 소지 있는 에러 메시지**: 복호화 실패 시 "브라우저 단독 페이지에서는 암호화된 Excel 해제가 제한됩니다"라고 표시 → 기능 자체가 없는 것처럼 보였음
   - **수정**: "파일 암호가 올바르지 않거나 복호화에 실패했습니다. 암호를 다시 확인해 주세요."로 변경

2. **성능 / UX**: `agileHashPassword` spinCount=100000 루프 → `await crypto.subtle.digest` 10만 번 호출 → Node.js 기준 ~4초 소요, 상태 메시지 변화 없어 멈춘 것처럼 보임
   - **수정**: 5,000번마다 `"복호화 중... 15%"` 진행률 표시
   - **최적화**: 반복마다 `new Uint8Array` 생성 대신 고정 버퍼 재사용 (GC 부하 감소)

### 현재 git HEAD (main 브랜치)
- commit `8395788`: Fix slow decryption and misleading error message
- 소스 파일과 docs/index.html 모두 동일하게 업데이트 및 커밋됨
- GitHub Pages 배포 완료 (200 응답 확인)

## 미해결 이슈 — GitHub Pages에서 파일 못 읽는 문제 (2026-06-19, 미완)

### 증상
- https://hyunmo-cmd.github.io/MVNO-Projects/ 접속은 됨
- 파일 업로드 시 아직 파일을 못 읽는다고 함 (구체적 에러 메시지 미확인)
- 테스트용 파일: `C:\Users\user\Downloads\LG개통내역_2026-06-19.xlsx`

### 다음 세션에서 해야 할 것
1. `LG개통내역_2026-06-19.xlsx` 파일 헤더 확인 → 암호화(CFB) 파일인지 일반 XLSX인지
2. 암호화 파일이면 → 실제 복호화 흐름 Node.js로 재검증 (browser vs Node 차이 여부)
3. 일반 XLSX이면 → `unzipEntries` / `parseSheet` 파싱 단계 디버깅
4. 브라우저 콘솔 에러 메시지 확인 요청 (F12 → Console 탭)

## 기술 스택 및 복호화 구조
- 단일 HTML 파일 (모든 JS 인라인)
- WebCrypto API (`crypto.subtle`) — HTTPS 또는 localhost(127.0.0.1)에서만 작동
- OOXML AgileEncryption 흐름:
  1. CFB 파일 파싱 → `EncryptionInfo`(XML), `EncryptedPackage` 스트림 추출
  2. XML에서 salt, packageSalt, spinCount, hashAlgorithm 파싱 (`xmlAttr` 함수)
  3. `agileHashPassword(password, salt, 100000, "SHA512")` → baseHash
  4. `agileDeriveKey(baseHash, blockKey)` → 파생키로 `encryptedKeyValue` 복호화 → secretKey(32bytes)
  5. 4096바이트 청크마다 `aesCbcDecryptRaw(chunkKey, iv, part)` → 실제 데이터 복호화
  6. `concatBytes(...chunks).slice(0, size)` → 복호화된 XLSX(ZIP) 반환

## 보안 요건 (변경 불가)
- 고객 데이터는 휘발성 — 완료 버튼 클릭 시 clearSession()으로 삭제
- 파일 업로드 + 별도 암호 입력란 유지
- 작업한 설정은 건드리지 말 것
