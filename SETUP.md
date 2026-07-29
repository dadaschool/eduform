# 에듀폼 배포 안내서

이 문서 순서대로 따라가면 배포가 완료됩니다. 예상 소요 20~30분.

---

## 왜 지금 배포가 안 됐는가

두 가지 원인이 겹쳐 있었습니다.

1. **Vercel에 환경변수를 등록하지 않았습니다.**
   `.env.local` 은 `.gitignore` 에 있어 깃에 올라가지 않습니다. Vercel은 그 파일을 볼 수 없습니다.
   로그인 페이지 3개가 빌드 시점에 미리 생성되는데, 그때 Supabase 주소가 없어서 빌드가 통째로 실패했습니다.
   → **코드를 수정해 이제 환경변수가 없어도 빌드는 성공합니다.** 다만 실제로 쓰려면 등록은 해야 합니다.

2. **기존 Supabase 프로젝트가 사라졌습니다.**
   `.env.local` 이 가리키던 주소가 DNS에 존재하지 않습니다(삭제된 프로젝트).
   그래서 새 프로젝트를 만들고 아래 SQL을 올려야 합니다.

---

## 1단계 — Supabase 프로젝트 만들기

1. https://supabase.com/dashboard 접속 → **New project**
2. 입력값
   - **Name**: `eduform`
   - **Database Password**: 강한 비밀번호 생성 후 **어딘가에 저장** (분실 시 재설정 필요)
   - **Region**: `Northeast Asia (Seoul)` — 한국에서 가장 빠릅니다
3. 생성까지 2~3분 기다립니다.

## 2단계 — DB 테이블 만들기

1. 왼쪽 메뉴 **SQL Editor** → **New query**
2. 이 저장소의 [`supabase/schema.sql`](supabase/schema.sql) **전체 내용을 복사해 붙여넣기**
3. **Run** (또는 `Ctrl+Enter`)
4. `Success. No rows returned` 가 나오면 성공입니다.

> 파일 하나에 테이블 15개 + 보안정책(RLS) + 트리거 + 초대코드 함수 + 실시간 쪽지 설정이 모두 들어 있습니다. 이것만 실행하면 됩니다.

**확인**: 왼쪽 **Table Editor** 에서 테이블 15개가 보이는지 봅니다.
`classes, invite_codes, profiles, badges, student_badges, assessments, assessment_classes,
assessment_items, student_assessment_checks, assignments, assignment_classes,
assignment_submissions, observations, student_record_drafts, messages`

## 3단계 — 이메일 확인 끄기 (권장)

학생이 초대코드로 가입할 때 이메일 인증을 요구하면 학교 환경에서 막힙니다.

**Authentication → Sign In / Providers → Email** 에서 **Confirm email** 을 **끕니다**.

## 4단계 — API 키 4개 확보

**Project Settings → API** 에서 세 개를 복사합니다.

| 화면에 있는 이름 | 넣을 환경변수 이름 |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| Project API keys → `anon` `public` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Project API keys → `service_role` | `SUPABASE_SERVICE_ROLE_KEY` |

네 번째는 Google에서 받습니다.

| 발급처 | 넣을 환경변수 이름 |
|---|---|
| https://aistudio.google.com/app/apikey → Create API key | `GEMINI_API_KEY` |

> `service_role` 키는 보안 규칙(RLS)을 무시하는 관리자 키입니다. **깃, 채팅, 문서에 절대 붙여넣지 마세요.** 서버에서만 쓰이고 브라우저로는 나가지 않습니다.

## 5단계 — 로컬에서 먼저 확인

프로젝트 폴더의 `.env.local` 을 열어 4개 값을 새 것으로 바꿉니다.
(`.env.example` 이 어떤 형식인지 보여주는 템플릿입니다)

```bash
npm run dev
```

http://localhost:3000 → 교사 로그인 화면이 뜨면 정상입니다.
**회원가입은 다음 단계에서** 합니다.

## 6단계 — 교사 계정 만들기

앱에는 교사 회원가입 화면이 없습니다(`/register` 는 학생 전용). 교사는 대시보드에서 직접 만듭니다.

1. Supabase **Authentication → Users → Add user → Create new user**
   - Email / Password 입력, **Auto Confirm User 체크**
   - 생성된 사용자의 **UID를 복사**
2. **SQL Editor** 에서 아래를 실행 (3곳을 본인 값으로 교체)

```sql
insert into profiles (id, email, name, role)
values (
  '여기에-복사한-UID',
  '교사이메일@example.com',
  '홍길동',
  'teacher'
);
```

3. `/login` 에서 그 이메일·비밀번호로 로그인 → `/teacher/dashboard` 로 들어가면 성공입니다.

## 7단계 — Vercel 환경변수 등록 (배포 성공의 핵심)

1. https://vercel.com/dashboard → **eduform** 프로젝트
2. **Settings → Environment Variables**
3. 4개를 하나씩 추가합니다. **Environment는 Production, Preview, Development 모두 체크**하세요.

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GEMINI_API_KEY
```

4. **Deployments** 탭 → 맨 위 배포의 `⋯` → **Redeploy**
   - **"Use existing Build Cache" 는 체크 해제**하세요. 환경변수가 새로 반영돼야 합니다.

## 8단계 — 최종 확인

배포된 URL에서 차례로 확인합니다.

- [ ] `/login` 화면이 뜬다
- [ ] 6단계에서 만든 교사 계정으로 로그인된다
- [ ] **반 관리**에서 반을 만들고 초대코드가 발급된다
- [ ] 시크릿 창에서 `/register` → 그 초대코드로 학생 가입이 된다
- [ ] 교사 화면 **학생 관리**에 그 학생이 보인다
- [ ] 교사가 쪽지를 보내면 학생 화면에 알림이 뜬다
- [ ] **생활기록부** 메뉴에서 AI 초안 생성이 된다 (Gemini 키 확인)

---

## 막혔을 때

**배포가 또 실패한다**
Vercel → Deployments → 실패한 배포 클릭 → **Building** 로그를 펼쳐 빨간 줄을 확인하세요.
로컬에서 똑같은 조건으로 재현하려면:

```bash
npm run build
```

**로그인은 되는데 화면이 비어 있다**
브라우저 개발자도구(F12) → Console 에 빨간 오류를 확인하세요.
`permission denied for table ...` 이면 2단계 SQL의 RLS 정책이 안 올라간 것입니다. schema.sql을 다시 실행하세요.

**"환경변수가 설정되지 않았습니다" 오류가 뜬다**
7단계를 안 했거나, 등록 후 Redeploy를 안 한 것입니다. 변수 이름의 오타(특히 `NEXT_PUBLIC_` 접두사)도 확인하세요.

**학생이 교사 화면에 안 보인다**
교사 화면은 `profiles.teacher_id` 기준으로 학생을 찾습니다. 초대코드로 가입하면 이 값이 자동으로 채워집니다.
Supabase에서 직접 학생 행을 만들었다면 `teacher_id` 를 교사 UID로 채워주세요.

**쪽지 실시간 알림이 안 온다**
Supabase **Database → Replication** 에서 `messages` 테이블이 켜져 있는지 확인하세요.
(2단계 SQL이 자동으로 켜지만, 실패하면 수동으로 켤 수 있습니다)
