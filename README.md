# 에듀폼 (EduForm)

초·중등 교사용 학생 평가·기록 관리 웹앱. 평가 루브릭, 과제, 관찰기록, 디지털 배지, 쪽지를
한곳에서 관리하고, 쌓인 자료로 **생활기록부 세특 초안을 AI가 작성**합니다.

`Next.js 14` · `Supabase` · `Tailwind 4 / shadcn` · `Gemini / 업스테이지 Solar`

---

## 기능

**교사**

| 기능 | 내용 |
|---|---|
| 반 관리 | 반 생성, 초대코드 발급 (사용횟수·만료일 제한) |
| 학생 관리 | 계정 직접 생성, 비밀번호 초기화, **엑셀 명단 업로드** |
| 평가 | 평가지 설계, 항목별 6종 체크방식, 반별 배포, 학생별 일괄 체크 |
| 과제 | 출제(마감일), 제출물 확인, 개별 피드백 |
| 배지 | 디지털 배지 정의 및 수여 |
| 관찰기록 | 학생별 수시 관찰 누적 |
| 생활기록부 | **평가·과제·관찰을 종합해 AI가 세특 초안 생성** |
| 쪽지 | 학생과 1:1 대화 |

체크방식 6종: `O/X` · `상/중/하` · `완료/보류/미제출` · `숫자` · `1~5점` · `텍스트`

**학생** — 대시보드, 과제 제출, 내 배지, 쪽지(실시간 알림), 프로필

---

## 내 계정에 설치하기

### 0단계 — 내 저장소로 복사

이 저장소 오른쪽 위 **`Use this template`** → **`Create a new repository`**
(버튼이 없으면 **Fork** 하세요)

### 1단계 — Supabase 프로젝트 만들기

1. https://supabase.com/dashboard → **New project**
2. **Region** 은 `Northeast Asia (Seoul)` 을 고르세요 (한국에서 가장 빠릅니다)
3. **Database Password 는 어딘가에 저장하세요.** 앱 동작에는 필요 없지만,
   아래 3단계의 자동 설치를 쓰려면 필요합니다.

> ⚠️ 무료 등급은 **약 1주간 요청이 없으면 자동 일시정지**됩니다. 그러면 접속이 안 되고,
> 대시보드에서 `Resume project` 를 눌러야 다시 살아납니다. 데이터는 보존됩니다.

### 2단계 — 키 채우기

`.env.example` 을 복사해 `.env.local` 을 만들고 값을 넣으세요.

```bash
cp .env.example .env.local
```

| 변수 | 어디서 얻나 | 필수 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 같은 화면 → `anon` / `publishable` | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | 같은 화면 → `service_role` / `secret` | ✅ |
| `UPSTAGE_API_KEY` | https://console.upstage.ai | AI 기능용 |
| `GEMINI_API_KEY` | https://aistudio.google.com/app/apikey | AI 기능용 |
| `SUPABASE_DB_URL` | Project Settings → Database → Connection string (URI) | 3단계 자동설치용 |

AI 키는 **둘 중 하나만 있어도** 동작합니다. Gemini 를 먼저 쓰고 실패하면 업스테이지로
자동 전환됩니다. Gemini 가 막혀 있다면 `AI_PRIMARY=upstage` 를 넣어 건너뛰게 하세요.

> `service_role` 키는 보안 규칙(RLS)을 무시하는 관리자 키입니다. 서버에서만 쓰이고
> 브라우저로 나가지 않습니다. **깃·채팅·문서에 붙여넣지 마세요.**

### 3단계 — 데이터베이스 만들기

**방법 A — 명령 한 줄** (`SUPABASE_DB_URL` 을 넣었다면)

```bash
npm install
npm run db:seed
```

테이블 15개 + 보안정책 + 함수 + 실시간 설정 + 시범 데이터까지 한 번에 올라갑니다.
시범 데이터 없이 빈 상태로 시작하려면 `npm run db:setup` 을 쓰세요.

**방법 B — 대시보드에 붙여넣기** (터미널을 안 쓰거나 DB 비밀번호를 모를 때)

1. Supabase → **SQL Editor** → **New query**
2. [`supabase/schema.sql`](supabase/schema.sql) 전체를 붙여넣고 **Run**
3. 시범 데이터를 원하면 [`supabase/seed.sql`](supabase/seed.sql) 로 한 번 더

두 파일 모두 **여러 번 실행해도 안전합니다.** 기존 정책·트리거를 교체하되 데이터는 지우지 않습니다.

### 4단계 — 이메일 확인 끄기

학생이 초대코드로 가입할 때 이메일 인증을 요구하면 학교 환경에서 막힙니다.

Supabase → **Authentication → Sign In / Providers → Email** → **Confirm email** 끄기

### 5단계 — 점검

```bash
npm run doctor
```

환경변수, Supabase 연결, 테이블·함수, 보안정책, 계정, AI 키를 한 번에 확인하고
빠진 것과 해야 할 일을 알려줍니다. 비밀값은 출력하지 않습니다.

### 6단계 — 실행

```bash
npm run dev
```

http://localhost:3000 → 교사 로그인 화면

**시범 데이터를 넣었다면** `teacher@eduform.test` / `edu1234` 로 바로 들어갈 수 있습니다.
학생 계정은 `s01@eduform.test` ~ `s08@eduform.test`, 비밀번호는 같습니다.

> ⚠️ 시범 계정은 비밀번호가 전부 같습니다. **실제 학생을 받기 전에 지우세요.**
> `supabase/seed.sql` 맨 아래 주석 처리된 `delete` 블록을 실행하면 샘플만 삭제됩니다.

### 7단계 — 배포 (Vercel)

1. https://vercel.com/new → 내 저장소 선택
2. **Framework Preset 이 `Next.js` 인지 확인하세요.**
   `Other` 로 두면 빌드는 성공하는데 **모든 주소가 404** 가 됩니다.
3. **Environment Variables** 에 2단계의 값을 넣습니다
   (`SUPABASE_DB_URL` 은 넣지 않아도 됩니다 — 로컬 설치용입니다)
4. **Deploy**

배포 후 접속했을 때 `Login – Vercel` 페이지가 나오면,
**Settings → Deployment Protection → Vercel Authentication** 을 끄세요.
켜져 있으면 교사·학생이 로그인 화면에조차 접근할 수 없습니다.

---

## 교사 계정 만들기

앱에 교사 회원가입 화면은 없습니다 (`/register` 는 학생 전용). 직접 만듭니다.

1. Supabase → **Authentication → Users → Add user → Create new user**
   - Email / Password 입력, **Auto Confirm User 체크**
   - 생성된 **UID 복사**
2. **SQL Editor** 에서 실행 (3곳을 본인 값으로 교체)

```sql
insert into profiles (id, email, name, role)
values ('복사한-UID', '이메일@example.com', '홍길동', 'teacher');
```

3. `/login` 에서 로그인 → `/teacher/dashboard`

학생은 교사가 **학생 관리**에서 만들거나, 학생이 **초대코드로 가입**하면 됩니다.

---

## 명령어

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm run doctor` | 설치 상태 전체 점검 |
| `npm run db:setup` | DB 스키마 적용 |
| `npm run db:seed` | DB 스키마 + 시범 데이터 |
| `npm run lint` | 코드 검사 |

---

## 구조

```
src/
  app/
    (auth)/       로그인 · 학생로그인 · 초대코드 가입
    (teacher)/    교사 화면 16개
    (student)/    학생 화면 6개
    api/
      gemini/     AI 평가항목 추천 · 세특 초안 생성
      teacher/    학생 계정 생성 · 비밀번호 초기화 (service_role 사용)
  lib/
    ai.ts         Gemini → 업스테이지 폴백
    supabase/     브라우저 · 서버 · 미들웨어 클라이언트
supabase/
  schema.sql      테이블 15개 + RLS + 트리거 + 함수 + Realtime
  seed.sql        시범 데이터
scripts/
  db-setup.mjs    DB 자동 구축
  doctor.mjs      설치 점검
```

**보안 구조**: 모든 테이블에 RLS 가 걸려 있습니다. 교사는 자기가 담당한 학생과 자기가 만든
자료만, 학생은 자기 것과 자기 반 것만 접근합니다. 화면 접근은 `(teacher)` / `(student)`
레이아웃이 서버에서 검사해 되돌립니다.

---

## 막혔을 때

증상별 해결책은 [SETUP.md](SETUP.md) 의 **막혔을 때** 항목에 정리해 두었습니다.
자주 걸리는 것:

- **모든 주소가 404** → Vercel Framework Preset 이 `Other`
- **Vercel 로그인 페이지가 나온다** → Deployment Protection 켜져 있음
- **접속이 아예 안 된다** → Supabase 프로젝트 일시정지 (`Resume project`)
- **화면이 비어 있다** → `npm run doctor` 로 확인
