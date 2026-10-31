# 📱 [PRD] ezForme 제품 요구사항 정의서 (Product Requirements Document)
### (Codex 웹사이트 생성 및 Render.com 통합 가이드 포함)

**문서 버전**: v1.0  
**작성일자**: 2026년 10월 26일  
**작성자**: AI 개발부장 'one' (one 개발부장)  
**수신/승인**: 아이그리드 대표님  
**배포 인프라**: Render.com (Node.js Express + WebSocket) + Cloudflare R2  
**도메인**: 단일 도메인 통합 아키텍처 (`ezforme.kr`)

---

## 1. 🎯 제품 개요 및 아키텍처 (Product Scope & Architecture)

### 1.1 제품 정의
ezForme은 사용자가 별도의 프로그램이나 앱을 설치하지 않고, 웹 브라우저와 QR코드를 통해 3초 만에 문서를 출력하고 결제할 수 있는 **'클라우드 릴레이 제로 드라이버 무선 인쇄 시스템'**입니다.

### 1.2 전체 시스템 아키텍처 다이어그램
```
[사용자 스마트폰 / 노트북] 
       │ (1. QR 스캔 / 파일 업로드 / 토스페이먼츠 결제)
       ▼
[Render.com 클라우드 웹서버 (Express + WebSocket)]  <── [Cloudflare R2 (임시 저장소)]
       │ (2. 웹소켓 실시간 작업 푸시: 6자리 PIN & 파일)
       ▼
[현장 라즈베리파이 허브 (Station Agent)]
       │ (3. 로컬 USB 케이블 직결 / CUPS 래스터 전송)
       ▼
[매장 일반 복합기 / 프린터] ──────> 🖨️ [인쇄물 즉시 배출]
```

### 1.3 단일 도메인 라우팅 맵 (Render.com `server.js` 매핑)
모든 웹페이지는 Render.com의 단일 웹 서비스 안에서 하부 경로(Sub-route)로 제공됩니다.

| URL 라우트 | 제공 파일 경로 | 기능 요약 및 사용자 |
| :--- | :--- | :--- |
| **`GET /`** | `public/index.html` | **공식 메인 랜딩페이지** (서비스 소개, 점주 도입 문의, 데모 체험) |
| **`GET /p/:stationId`** | `public/mobile.html` | **현장 모바일 인쇄 화면** (QR 스캔 시 열리는 업로드 & 결제창) |
| **`GET /signup`** | `public/signup.html` | **점주 가맹 신청 및 회원가입 페이지** |
| **`GET /login`** | `public/login.html` | **점주 / 관리자 로그인 페이지** |
| **`GET /admin`** | `public/admin.html` | **마스터 & B2B 점주 관리자 대시보드** (입주사 쿼터/월말 정산) |
| **`GET /kiosk`** | `public/kiosk.html` | **현장 모니터용 키오스크 화면** (QR 안내 및 6자리 PIN 입력기) |
| **`GET /demo`** | `public/demo.html` | **IR/시연용 듀얼 스플릿 뷰** (키오스크 + 모바일 라이브 시뮬레이션) |

---

## 2. 📄 페이지별 상세 UI/기능 명세 (Codex 개발 가이드)

> **💡 Codex 프롬프트 지침**:  
> Codex에게 HTML/CSS/JS 생성을 요청할 때, 아래의 태그 ID와 API 호출 규격을 그대로 유지하도록 지시하면 Render.com 서버와 수정 없이 100% 즉시 연동됩니다.

---

### 2.1 메인 랜딩페이지 (`/` ➡️ `public/index.html`)

#### 목적
* 서비스 가치(드라이버 0초, 앱 0개)를 시각적으로 전달하여 방문객을 매료시키고, 스터디카페 점주 및 공유오피스 매니저의 가맹 도입 문의를 유도.

#### 핵심 섹션 구성
1. **GNB 헤더 (Navbar)**:
   - 로고: `🖨️ ezForme`
   - 네비게이션 링크: `[서비스 소개]`, `[이용 방법]`, `[점주 혜택]`, `[요금 안내]`, `[FAQ]`
   - 우측 액션 버튼: `[노트북 빠른 출력]`, `[점주 콘솔 로그인]`, `[도입 신청하기]`
2. **히어로 섹션 (Hero Section)**:
   - 메인 카피: **"드라이버 설치 0초, 앱 다운로드 0개. QR만 찍으면 즉시 인쇄!"**
   - 서브 카피: "전국 스터디카페, 공유오피스, 게스트하우스를 위한 가장 스마트한 제로 세팅 클라우드 프린팅"
   - CTA 버튼:
     - `<a href="#partner-inquiry" class="btn-primary">무상 단말기 도입 신청 (선착순 30곳)</a>`
     - `<a href="/demo" class="btn-secondary">3초 인쇄 라이브 데모 체험 ⚡</a>`
   - 노트북 사용자를 위한 빠른 접속 바:
     - `<input id="quickStationCode" placeholder="매장 코드 4자리 (예: 3829)">` + `<button id="btnQuickGo">바로 출력</button>`
3. **페인포인트 비교 섹션 (Before vs After)**:
   - 기존 방식: 300MB 드라이버 다운로드 15분 소요, 공용 PC 바이러스, 점주 문의 전화 폭탄.
   - ezForme: QR 스캔 ➡️ 업로드 ➡️ 카카오페이 결제 ➡️ 3초 배출 완료.
4. **B2B / B2C 2트랙 혜택 안내**:
   - **스터디카페/게스트하우스 (B2C)**: "기존 프린터에 박스 하나만 꽂으세요. 손 안 대고 매달 인쇄 부가수익 60% 자동 정산!"
   - **공유오피스 (B2B)**: "입주사별 무료 쿼터 차감 및 초과 과금 자동 추적! 월말 관리비 합산 엑셀 리포트 0초 다운로드."
5. **점주 예상 수익 계산기 (ROI Calculator)**:
   - 슬라이더 인터랙션: 매장 내 일일 이용객 수 선택 (예: 30명, 50명, 100명)
   - 실시간 예상 계산: `월 예상 인쇄량 X장` ➡️ `점주 월 순수익 000,000원 창출`
6. **도입 문의 및 가맹 신청 폼 (Partner Form)**:
   - 입력 필드: 매장명, 점주 성함, 연락처, 매장 유형(스터디카페/공유오피스/게하), 프린터 기종(모르면 '모름' 체크), 문의사항.
   - 버튼: `[무료 테스트 단말기 배송 신청하기]`
7. **푸터 (Footer)**:
   - 아이그리드 사업자 정보, 고객센터, 개인정보처리방침 (Zero-Trace 정책 명시).

---

### 2.2 현장 모바일 인쇄 웹 (`/p/:stationId` ➡️ `public/mobile.html`)

#### 목적
* 현장 사용자가 QR 스캔 또는 모바일로 접속했을 때 10초 안에 인쇄 작업을 완료하는 초경량 모바일 최적화 웹.

#### 핵심 UI 요소 및 ID 규격
1. **상단 매장 안내 배너**:
   - `<span id="stationNameBadge">토즈 스터디카페 신촌 1호점</span>`
   - 프린터 상태 인디케이터 (🟢 인쇄 준비 완료)
2. **파일 드롭존 & 파일 선택기**:
   - `<input type="file" id="fileInput" accept=".pdf,.png,.jpg,.jpeg">`
   - 드래그 앤 드롭 영역 및 선택된 파일명, 용량, 예상 페이지 수 실시간 표시 (`#fileMetaBox`).
3. **인쇄 옵션 컨트롤**:
   - 인쇄 색상: `<input type="radio" name="colorMode" value="bw" checked>` 흑백 (장당 100원) / `<input type="radio" name="colorMode" value="color">` 컬러 (장당 300원)
   - 인쇄 부수: `<input type="number" id="copiesInput" value="1" min="1" max="50">`
   - 단면/양면: `<select id="duplexSelect"><option value="single">단면 인쇄</option><option value="double">양면 인쇄</option></select>`
   - B2B 입주사 코드 입력 (선택): `<input type="text" id="tenantCodeInput" placeholder="공유오피스 입주사 코드 (예: ALPHA)">`
4. **실시간 견적 및 결제 금액 표시**:
   - `<div id="priceDisplay">총 1매 = 100원</div>` (B2B 무료 크레딧 일치 시 '0원 / 무료 크레딧 적용' 표시)
5. **액션 버튼**:
   - `<button id="btnUploadAndPay">인쇄 및 결제하기</button>`
6. **결제 및 PIN 발급 완료 모달 (`#pinModal`)**:
   - 결제 완료 안내 문구.
   - **대형 6자리 PIN 번호 표시 (`#issuedPinNumber`)** (예: `739241`)
   - "프린터 앞 화면에 위 번호를 입력하시면 즉시 종이가 출력됩니다." 안내.
   - Zero-Kiosk 모드일 경우: `<button id="btnDirectPrintNow">즉시 출력 시작</button>`

---

### 2.3 회원가입 및 도입 신청 페이지 (`/signup` ➡️ `public/signup.html`)

#### 목적
* 점주 및 일반 사용자의 계정 등록 및 신규 프린터 스테이션 설치 접수.

#### 폼 필드 구성
* 계정 유형 선택: `[매장 점주 / 파트너]` vs `[일반 사용자 / B2B 입주사]`
* 아이디(이메일), 비밀번호, 비밀번호 확인
* 점주 추가 정보: 매장명, 사업자등록번호, 정산받을 계좌번호 및 예금주, 단말기 수령 주소
* 가입 완료 버튼: `<button type="submit" id="btnSubmitSignup">가입 및 단말기 신청 완료</button>`

---

### 2.4 로그인 페이지 (`/login` ➡️ `public/login.html`)

#### 목적
* 점주 및 본사 관리자의 대시보드 접근 인증.

#### 폼 필드 구성
* 이메일, 비밀번호
* 로그인 버튼: `<button id="btnLogin">로그인</button>`
* 카카오 1초 간편 로그인 버튼: `<button id="btnKakaoLogin">카카오로 시작하기</button>`

---

### 2.5 마스터 & B2B 점주 관리자 대시보드 (`/admin` ➡️ `public/admin.html`)

#### 목적
* 대표님(본사) 및 공유오피스/스터디카페 매니저를 위한 실시간 관제 및 정산 리포트 센터.

#### 핵심 기능 및 위젯 구성
1. **요약 메트릭 카드 4종**:
   - 이번 달 총 인쇄량 (흑백 N장 / 컬러 N장)
   - 이번 달 누적 매출 및 수수료 정산액
   - 활성 스테이션 수 (온라인 / 오프라인 상태)
   - B2B 초과 과금 청구 예정 총액
2. **공유오피스 입주사별 쿼터 모니터링 테이블 (`#tenantTable`)**:
   - 컬럼: 입주사 코드, 회사명, 무료 쿼터(흑백/컬러), 당월 사용량, 초과량, 과금 합산액, 프로그레스 바
3. **신규 입주사 등록 모달**:
   - 코드, 회사명, 월 기본 흑백/컬러 제공량, 담당자 이메일 등록.
4. **월말 정산 엑셀(CSV) 원클릭 다운로드 버튼**:
   - `<a href="/api/b2b/monthly-report?format=csv" id="btnDownloadCsv" class="btn-export">📊 입주사 관리비 합산 청구서 (.CSV) 다운로드</a>`
5. **실시간 인쇄 작업 로그 리스트 (`#recentJobsList`)**:
   - WebSocket 연동으로 새 작업이 들어올 때마다 실시간 갱신.

---

## 3. 🔌 백엔드 API 명세 (Render.com `server.js` 완벽 연동)

> 프론트엔드 JavaScript에서 백엔드와 통신할 때 사용하는 실제 엔드포인트 목록입니다. (이미 `server.js`에 100% 구현되어 있습니다.)

### 3.1 파일 업로드 및 인쇄 등록 API
* **Endpoint**: `POST /api/upload`
* **Content-Type**: `multipart/form-data`
* **Form Data**:
  - `file`: 업로드할 파일 바이너리 (PDF, 이미지)
  - `colorMode`: `'bw'` | `'color'`
  - `copies`: 인쇄 부수 (정수, 1~50)
  - `duplex`: `'single'` | `'double'`
  - `stationId`: 매장 식별코드 (예: `'STATION-01'`)
  - `tenantCode`: (선택) B2B 입주사 코드 (예: `'ALPHA'`)
* **Response (JSON)**:
```json
{
  "success": true,
  "job": {
    "id": "JOB-M1ABC123",
    "pin": "739241",
    "originalName": "과제제출.pdf",
    "totalPages": 2,
    "totalPrice": 200,
    "status": "READY_TO_PAY",
    "b2b": { "isB2B": false }
  }
}
```

### 3.2 토스페이먼츠 결제 승인 시뮬레이션 API
* **Endpoint**: `POST /api/jobs/:id/pay`
* **Body (JSON)**: `{ "method": "tosspayments_card" }`
* **Response**: `{ "success": true, "job": { "status": "PAID" } }`

### 3.3 PIN 입력을 통한 현장 인쇄 트리거 API
* **Endpoint**: `POST /api/jobs/print-by-pin`
* **Body (JSON)**: `{ "pin": "739241" }`
* **Response**: `{ "success": true, "message": "프린터로 스풀링 전송을 시작합니다." }`

### 3.4 B2B 입주사 목록 및 실시간 잔여량 조회 API
* **Endpoint**: `GET /api/b2b/tenants`
* **Response (JSON)**:
```json
{
  "success": true,
  "branchName": "패스트파이브 강남 1호점",
  "tenants": [
    {
      "code": "ALPHA",
      "name": "(주)알파테크",
      "monthlyQuota": { "bw": 100, "color": 20 },
      "currentUsage": { "bw": 32, "color": 6 },
      "overage": { "amount": 0 }
    }
  ]
}
```

### 3.5 B2B 월간 정산 엑셀(CSV) 다운로드
* **Endpoint**: `GET /api/b2b/monthly-report?format=csv`
* **Response**: UTF-8 BOM 한글 엑셀 호환 CSV 파일 다운로드.

### 3.6 실시간 웹소켓 이벤트 (`ws://...`)
* 서버에서 브로드캐스트되는 이벤트 타입:
  - `JOB_CREATED`: 신규 인쇄 작업 생성
  - `JOB_PAID`: 결제 완료
  - `PRINT_STARTED`: 프린터 출력 시작
  - `PRINT_COMPLETED`: 인쇄 완료
  - `B2B_USAGE_UPDATED`: B2B 입주사 쿼터 차감

---

## 4. 🚀 Codex 협업 및 Render.com 배포 절차 (Work Protocol)

### Step 1: Codex에게 코드 생성 요청
1. 위 PRD 문서를 Codex에 전달하며 각 페이지(`index.html`, `signup.html`, `login.html`, `admin.html`)의 HTML, CSS, JS 작성을 지시합니다.
2. Codex에게 **"API 엔드포인트와 HTML Element ID를 PRD 2장과 3장에 명시된 규격과 정확히 일치시켜라"**고 전달합니다.

### Step 2: 대표님의 소스코드 전달
* Codex가 완성한 파일들(`index.html`, `signup.html`, `admin.html`, CSS, JS 파일 등)을 프로젝트의 `public/` 폴더에 넣거나 대화창으로 전달해 주시면 됩니다.

### Step 3: 원개발부장의 Render.com 완벽 통합 및 배포
1. **정적 파일 및 라우팅 연결**: 전달받은 파일들을 `server.js`의 라우트(`/`, `/signup`, `/admin`, `/p/:id` 등)에 오차 없이 매핑.
2. **WebSocket & API 연동 검증**: 실시간 상태 변화, 파일 업로드, 결제 모달, CSV 다운로드가 브라우저에서 원활히 동작하는지 검증.
3. **Render.com 무중단 배포**: Git 커밋 및 푸시를 통해 글로벌 라이브 서버에 즉시 자동 반영.

---
**[승인 및 확인]**  
* 작성자: AI 개발부장 one  
* 승인자: 아이그리드 대표님
