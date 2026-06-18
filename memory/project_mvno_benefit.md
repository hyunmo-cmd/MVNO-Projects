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

## ZIP 구조 (최상위 폴더 없음, 그대로 압축)
```
outputs/lg-plan-benefit-dashboard.html
start-dashboard.bat
work/local_dashboard_server.mjs
```

## 오늘(2026-06-18) 작업 현황

### 완료
- per-category 매핑 에디터 (사이드바 + 폼 2패널)
- 요약 카드 컬러 액센트 CSS
- 서버 API 경로 제거 → 전면 클라이언트 사이드 복호화로 전환
- DOMParser XML 파싱 → 정규식 기반 `xmlAttr()` 함수로 교체 (namespace 문제 해결)
- `encryptedKey.getAttribute` 잔여 참조 수정
- `console.error` 추가 (catch 블록)
- **AES-CBC PKCS#7 unpadding 버그 수정** (commit `3eb35ee`)

### 핵심 버그 — AES-CBC PKCS#7 문제
**원인**: `crypto.subtle.decrypt`(AES-CBC)는 항상 PKCS#7 패딩을 자동 제거함.  
그런데 OOXML AgileEncryption의 4096바이트 청크는 Zero-padding(PKCS#7 아님).  
→ 마지막 바이트 값에 따라 데이터 묵시적 손상(1~16이면 그 만큼 잘림) 또는 DOMException 발생.  
서버는 `setAutoPadding(false)`로 해결했지만 WebCrypto API에는 해당 옵션 없음.

**해결책 (`aesCbcDecryptRaw`)**: 각 청크 뒤에 "가짜 블록" 추가.  
가짜 블록 = `AES_ECB_enc(lastBlock XOR 0x10×16)` → CBC 복호화 시 `0x10×16`으로 복호화됨 → 유효한 16바이트 PKCS#7 패딩으로 인식 → 제거 후 원본 N바이트 반환.  
구현: `crypto.subtle.encrypt(AES-CBC, IV=0, aesInput)` 첫 16바이트 = AES_ECB_enc(aesInput).

### 미해결 — 여전히 안됨 (2026-06-18 기준)
AES-CBC PKCS#7 fix를 배포했으나 사용자가 "안된다"고 함.  
추가 디버깅 필요. 다음 시도 포인트:
1. GitHub Pages 캐시 (Ctrl+Shift+R 강제 새로고침 확인)
2. F12 콘솔 → 빨간 오류 메시지 정확히 캡처
3. 혹시 `agileHashPassword` spinCount=100000 루프가 너무 느린지 확인 (브라우저 freeze)
4. EncryptedKeyValue 복호화 후 secretKey 길이 확인 (32바이트여야 함)

## 보안 요건 (변경 불가)
- 고객 데이터는 휘발성 — 완료 버튼 클릭 시 clearSession()으로 삭제
- 파일 업로드 + 별도 암호 입력란 유지
- `작업한 설정은 건드리지 말 것`

## 기술 스택
- 단일 HTML 파일 (모든 JS 인라인)
- Node.js 로컬 서버 (포트 8765, `outputs/` 폴더 서빙)
- WebCrypto API (`crypto.subtle`) — HTTPS 또는 localhost(127.0.0.1)에서만 작동
- 혜택-요금제 매핑은 `localStorage` 저장
- OOXML AgileEncryption: CFB 파싱 → AES-256-CBC 복호화 (SHA-512 키 스트레칭, spinCount=100000)
