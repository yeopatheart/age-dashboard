# AI 협업 기반 풀스택 웹 프로젝트 셋업 플레이북 (Playbook)

**작성일**: 2026-04-04  
**목적**: 아이디어 단계부터 PRD 작성, UI 디자인 연동, 클라우드 인프라 셋업, Vercel/Supabase 배포까지의 전 과정을 표준화하여 향후 다른 프로젝트 구축 시 참고할 수 있는 가이드라인 제공.

---

## 1. 🛠️ 활용 도구 및 기술 스택 (Tech Stack & Tools)

새로운 프로젝트를 시작할 때 아래 도구표를 기준으로 구성하면, 인프라 비용 $0(무료)으로 프로덕션 레벨의 서비스를 구축할 수 있습니다.

| 영역 | 도구 (Tool) | 활용 방식 및 이유 |
|------|------------|------------------|
| **에이전트/IDE** | Antigravity (AI) | 로컬 파일 생성, 터미널 제어, 코드 작성 전반 가이드 및 자동화 |
| **기획서 / 문서** | Markdown (PRD) | AI 에이전트가 완벽하게 이해하고 코드로 변환할 수 있는 표준 규격 |
| **UI/UX 디자인** | Figma (+ Figma Make) | 화면 스케치 및 프론트엔드 코드화를 위한 디자인 연동 (MCP 활용) |
| **버전 관리** | GitHub | 소스코드 형상 관리, Vercel 배포 자동화(CI/CD)의 필수 전제 조건 |
| **프레임워크** | Next.js (App Router) | 프론트엔드와 백엔드 API를 하나의 프로젝트로 통합 (시간 단축) |
| **데이터베이스** | Supabase (PostgreSQL) | 무료 클라우드 DB, Realtime 동기화, 사용자 인증(Auth) 제공 |
| **클라우드 배포** | Vercel | GitHub main 브랜치 Push 시 자동 도메인 할당 및 빌드, 무중단 배포 |

---

## 2. 📝 Step-by-Step 진행 프로세스

### 단계 1: 아이디어 발산 및 PRD(제품 요구사항 정의서) 작성
* **무엇을 했나**: 단순한 문제(화이트보드 수기 작성의 불편함)를 AI에게 설명하고, 이를 바탕으로 기능, 역할, 화면 구성이 담긴 PRD 문서를 마크다운(`.md`)으로 작성.
* **핵심 노하우**: 
  - 코딩을 바로 시작하지 않고 **반드시 PRD를 먼저 작성**하여 요구사항을 텍스트로 확정 지어야 함.
  - 모호한 부분(예: 카카오톡 파싱 메세지 규격)은 실제 샘플 데이터를 AI에게 먹여서 구체적인 데이터 형식으로 정형화함 (`kakao-message-format-guide.md` 작성 방법론 참고).

### 단계 2: 기반 환경 확인 및 Node.js 설치
* **무엇을 했나**: 에이전트와 플러그인이 동작할 수 있도록 로컬 PC의 환경을 검증하고 필수 런타임인 Node.js를 설치함.
* **핵심 노하우**:
  - Mac 환경에서는 `nvm`(Node Version Manager)을 사용하여 Node.js를 설치하는 것이 패키지 충돌과 권한 오류를 막는 가장 깔끔한 방법임.
  - 터미널 명령어: `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash` 이후 `nvm install 24`

### 단계 3: Figma MCP (디자인-코드 연동 플러그인) 설정
* **무엇을 했나**: Figma 디자인을 AI 에이전트가 직접 읽어와서 PRD와 크로스체크/코딩할 수 있도록 연결 고리(MCP)를 세팅함.
* **핵심 노하우**:
  1. Figma 계정 설정(Settings) -> Security 탭 -> **Personal Access Token** 발급.
  2. 로컬에 `mcp_config.json` 파일을 만들고 `figma-developer-mcp` 패키지를 `npx`로 실행하도록 설정.
  > 이 세팅 하나로 인해 UI 퍼블리싱 단계에서 인간 개발자의 단순 HTML/CSS 복사-붙여넣기 작업이 90% 이상 감축됨.

### 단계 4: 프론트엔드 뼈대(Boilerplate) 셋업
* **무엇을 했나**: Next.js 프로젝트를 초기화하고 필요한 기반 최신 라이브러리들을 설치함.
* **핵심 노하우**:
  - `npx create-next-app@latest` 명령어를 통해 TypeScript, Tailwind CSS, ESLint 옵션을 기본적으로 포함시켜 세팅함.
  - 패키지명 제약(띄어쓰기 금지 등)이 있을 경우, 임시 폴더(`temp_app`)에 생성한 뒤 최상위(Root) 디렉토리로 파일만 `rsync`나 `cp`로 옮기는 테크닉 사용.

### 단계 5: 버전 관리(GitHub) 및 초기 세팅 백업
* **무엇을 했나**: 로컬에서 작업한 문서와 프로젝트 뼈대를 GitHub Repository에 업로드함.
* **핵심 노하우**:
  1. 쓰레기 파일이 올라가지 않도록 반드시 `.gitignore` 파일을 작성함.
  2. 현재 GitHub는 일반 비밀번호로 Push가 불가능하므로, **Personal Access Token(Classic)**을 GitHub Settings -> Developer settings에서 발급받아 `https://[토큰]@github.com/...` 형식으로 연동함.

### 단계 6: 배포 환경 & 데이터베이스 연결 (Vercel + Supabase)
* **무엇을 했나**: 로컬에서만 도는 앱을 전 세계 어디서나 접속할 수 있는 인터넷 웹앱으로 연결함.
* **핵심 노하우**:
  - **Vercel 자동 배포**: Vercel.com에서 "Add Project" 후 방금 만든 GitHub Repository만 클릭해주면 끝. 코드가 업데이트될 때마다 자동으로 배포 됨.
  - **Supabase DB 할당**: Supabase에서 새 프로젝트를 생성하면 `DATABASE_URL` (Postgres 연결 문자열)과 `API Key`가 발급되며, 이를 `.env.local`에 기입하여 연동.

---

## 3. 💡 협업 프로세스 팁 (Best Practices)

### 3-1. "PRD -> Design -> DB" 순서의 원칙
- **절대 데이터베이스나 모델 설계를 먼저 하지 말 것**. 화면(Figma)이 완전히 확정(Fix)되어 입력 폼과 노출 시킬 테이블 모양이 결정된 뒤에 ERD를 짜는 것이 애자일/AI 개발 방식의 불문율임.
- **순서 요약**: ① PRD 작성 → ② Figma 디자인 → ③ 디자인 URL을 AI에게 주고 PRD와 충돌 없는지 크로스체크 → ④ DB 설계(ERD) 진행 → ⑤ 소스코드 구현

### 3-2. AI 에이전트 다루기
- **배경 지식 부여**: 프로젝트 도메인(수산물 유통, 물봉 등)에 대한 사전 배경 지식을 최대한 길고 자세하게 프롬프트로 전달할수록 AI 시스템 내부의 이해도 스코어가 크게 향상됨.
- **병렬 타스크 처리**: 본인이 Figma 등 시각적 작업을 하는 동안, 에이전트에게는 "환경 구축해 놔", "계정 설정용 .env 구조 짜놔" 와 같은 독립적인 CLI 명령어 기반 백그라운드 작업을 위임하여 리소스를 200% 활용할 것.

---

## 4. 재사용 가능한 환경변수(.env) 템플릿

미래의 프로젝트에서도 무조건 사용하는 기본 `.env` 포맷입니다. (로컬에는 `.env.local`로 생성하고, Vercel Dashboard 설정에도 동일하게 입력함)

```env
# == Database (Supabase) ==
DATABASE_URL="postgresql://postgres.[프로젝트ID]:[비밀번호]@aws-0-[리전].pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[프로젝트ID]:[비밀번호]@aws-0-[리전].pooler.supabase.com:5432/postgres"

# == Supabase Authentication & Realtime ==
NEXT_PUBLIC_SUPABASE_URL="https://[프로젝트ID].supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="ey..."
SUPABASE_SERVICE_ROLE_KEY="ey..."

# == NextAuth (로그인 세션) ==
NEXTAUTH_URL="http://localhost:3000" # 실제 배포시 Vercel URL
NEXTAUTH_SECRET="임의로_생성한_보안_해시_문자열"
```
