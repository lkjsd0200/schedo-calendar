# Schedo Calendar

함께 보는 공유 캘린더 — 방 코드와 비밀번호로 참여, 참여자별 일정 색상 구분, 카테고리 지원.

## 빠른 시작 (로컬)

```bash
# 1. 의존성 설치 (최초 1회)
npm install

# 2. 서버 실행
node server.js

# 3. 브라우저에서 접속
http://localhost:3000
```

## 클라우드 배포 (Cloudflare Workers — 24시간 상시)

```bash
npm install -g wrangler
wrangler login       # 브라우저에서 Cloudflare 로그인
wrangler deploy      # 배포 완료 → 고정 URL 발급
```

## 카테고리
📋 일반 / 🖥️ 온라인행사 / 🏖️ 연차 / ☀️ 반차 / ☕ 반반차 / 🚗 외근 / 👥 부서일정

## 단축키
| 키 | 동작 |
|---|---|
| N | 새 일정 추가 |
| ← / → | 이전/다음 이동 |
| T | 오늘 |
| M / W | 월간 / 주간 뷰 |
| Enter | 저장 |
| Esc | 닫기 |

## 구글 로그인 설정 (선택)
1. Google Cloud Console → OAuth 2.0 클라이언트 ID 생성
2. `wrangler.toml`의 `GOOGLE_CLIENT_ID = ""` 안에 클라이언트 ID 입력
3. `wrangler deploy` 재실행

## 기술 스택
- **로컬**: Node.js + Express + JSON 파일 DB
- **클라우드**: Cloudflare Workers + D1 (SQLite)
- **프론트**: 바닐라 HTML/CSS/JavaScript (폴링 방식 실시간 동기화)
