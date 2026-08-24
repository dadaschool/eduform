# 에듀폼 교내 서버 설치 안내서 (Windows)

학교 안에 컴퓨터 한 대를 두고 거기서만 돌리는 방법입니다. 학생 자료가 학교 밖으로
나가지 않습니다. 클라우드(Vercel + Supabase)로 쓰실 거면 이 문서가 아니라
[SETUP.md](SETUP.md) 를 보세요.

> 예상 소요: 처음이면 2~3시간. 대부분 Docker 설치와 이미지 내려받기 대기 시간입니다.

---

## 먼저 — Access 나 MSSQL 로 바꿀 수 있나

**Access 로는 안 됩니다.** 이유는 셋입니다.

1. **에듀폼은 데이터베이스에 직접 붙지 않습니다.** 로그인·조회·저장·실시간 알림을 전부
   Supabase 의 HTTP API 로 주고받습니다. Access 에는 그런 API 가 없습니다.
2. **"내 반 학생만 보인다" 는 규칙이 DB 안에 있습니다.** 표 16개에 걸린 Postgres
   RLS 정책과 `security definer` 함수가 그 일을 합니다. Access 에는 행 단위 권한이
   아예 없어서 같은 규칙을 앱 코드로 다시 써야 합니다. 한 곳만 빠뜨리면 다른 반
   학생 기록이 노출됩니다.
3. **Access 는 파일 하나(.accdb)를 여럿이 잠금 걸며 나눠 쓰는 구조입니다.** 웹 서버 뒤에서
   수십 명이 동시에 붙는 용도가 아닙니다.

MSSQL 은 2번은 됩니다(행 수준 보안이 있습니다). 그래도 1번이 그대로 걸립니다.
바꾸려면 인증·전 화면의 질의·스키마·보안 정책을 모두 다시 만들어야 합니다. 사실상
재작성이고, 검증해 둔 보안 규칙을 처음부터 다시 세우는 일이 됩니다.

결론은 **Postgres 를 그대로 쓰고, 그 Postgres 를 학교 컴퓨터에서 돌리는 것** 입니다.
아래가 그 방법입니다.

---

## 무엇이 어디서 도는가

```
교사·학생 브라우저 ─┬─→ :3000   에듀폼 화면 (Next.js)
                   │
                   └─→ :8000   Supabase API — 로그인 · 데이터 · 실시간
                                    │
                                    └─ Postgres (컨테이너 안, :5432)
```

**브라우저가 8000 번에 직접 붙습니다.** 3000 번만 열어두면 화면은 뜨고 로그인이 안 됩니다.
두 포트 모두 교내망에 열려야 합니다.

이미 4000 번을 쓰는 프로그램(예: AI 코디네이터)이 있어도 상관없습니다. 겹치지 않습니다.

---

## 0단계 — 서버 컴퓨터 상태 확인

설치할 컴퓨터에서 PowerShell 을 열고 그대로 붙여넣습니다.

```powershell
$w = Get-CimInstance Win32_OperatingSystem
[pscustomobject]@{
  OS              = $w.Caption
  빌드            = $w.BuildNumber
  메모리GB        = [math]::Round($w.TotalVisibleMemorySize/1MB, 1)
  여유메모리GB    = [math]::Round($w.FreePhysicalMemory/1MB, 1)
  C드라이브여유GB = [math]::Round((Get-PSDrive C).Free/1GB, 1)
  IP              = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' }).IPAddress -join ', '
  가상화          = (Get-CimInstance Win32_ComputerSystem).HypervisorPresent
  Node            = (node -v 2>$null)
  Docker          = (docker -v 2>$null)
} | Format-List
Get-NetTCPConnection -State Listen | Select-Object -Expand LocalPort -Unique | Sort-Object
```

필요 조건:

| 항목 | 최소 | 비고 |
|---|---|---|
| 메모리 | 8GB | 16GB 권장 — Supabase 스택만 4GB 가까이 씁니다 |
| C 드라이브 여유 | 20GB | 이미지 8GB + 데이터가 계속 늘어납니다 |
| OS | Windows 10/11 64비트 | 가상화가 BIOS 에서 켜져 있어야 합니다 |
| 권한 | 관리자 계정 | Docker 설치와 방화벽 규칙에 필요합니다 |
| 포트 | 3000, 8000 | 위 목록에 없으면 비어 있습니다 |

> **Windows Server 라면** Docker Desktop 은 지원 대상이 아닙니다. WSL2 안에 Ubuntu 를 넣고
> 그 안에서 Docker Engine 을 쓰는 방식으로 바꿔야 합니다. 절차가 달라지니 미리 확인하세요.

---

## 1단계 — 프로그램 3개 설치

관리자 PowerShell 에서:

```powershell
winget install -e --id Git.Git
winget install -e --id OpenJS.NodeJS.LTS
winget install -e --id Docker.DockerDesktop
```

설치 후 **재부팅**합니다. Docker Desktop 을 한 번 실행해 WSL2 설치 안내가 나오면 따라
진행하고, 고래 아이콘이 `Engine running` 이 될 때까지 기다립니다.

확인:

```powershell
node -v ; git --version ; docker compose version
```

> Docker Desktop 은 교육기관 사용이 무료 범위에 들어갑니다. 라이선스 조건은 바뀌니
> 학교 정보부에 한 번 확인해 두시는 편이 안전합니다.

---

## 2단계 — 파일 내려받기

```powershell
New-Item -ItemType Directory -Force C:\srv | Out-Null
cd C:\srv
git clone https://github.com/dadaschool/eduform.git
git clone --depth 1 https://github.com/supabase/supabase.git
```

`C:\srv\eduform` 이 앱, `C:\srv\supabase\docker` 가 데이터베이스 스택입니다.

---

## 3단계 — 키 만들기

클라우드 대시보드가 없으니 API 키를 직접 만듭니다. **서버 IP 를 넣어서** 실행하세요.

```powershell
cd C:\srv\eduform
npm install
$env:EDUFORM_HOST = "10.91.10.127"
node scripts\selfhost-keys.mjs
```

출력이 두 덩이로 나옵니다. **창을 닫기 전에 안전한 곳(비밀번호 관리자 등)에 옮겨 두세요.**
다시 만들면 기존 데이터에 접속할 수 없습니다.

서명 로직만 확인하려면:

```powershell
node scripts\selfhost-keys.mjs --selftest
```

---

## 4단계 — 설정 채우기

```powershell
cd C:\srv\supabase\docker
Copy-Item .env.example .env
notepad .env
```

3단계 출력의 **첫 덩이**를 그대로 반영합니다. 아래 항목만 바꾸고, **목록에 없는 항목은
기본값을 그대로 둡니다** (Supabase 버전에 따라 항목이 늘어납니다).

```
POSTGRES_PASSWORD=...
JWT_SECRET=...
ANON_KEY=...
SERVICE_ROLE_KEY=...
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=...
SITE_URL=http://10.91.10.127:3000
API_EXTERNAL_URL=http://10.91.10.127:8000
SUPABASE_PUBLIC_URL=http://10.91.10.127:8000

ENABLE_EMAIL_AUTOCONFIRM=true
DISABLE_SIGNUP=false
```

- `ENABLE_EMAIL_AUTOCONFIRM=true` — 교내망에는 메일 서버가 없습니다. 끄면 가입한 사람이
  확인 메일을 기다리다 로그인하지 못합니다.
- `DISABLE_SIGNUP=false` — 초대코드 가입이 이 경로를 씁니다. 막으면 초대코드가 동작하지 않습니다.

이어서 앱 쪽 설정 — 3단계 출력의 **둘째 덩이**:

```powershell
cd C:\srv\eduform
Copy-Item .env.example .env.local
notepad .env.local
```

AI 기능(평가 항목 추천·생활기록부 초안)을 쓰려면 `GEMINI_API_KEY` 또는 `UPSTAGE_API_KEY` 도
채웁니다. **이 두 기능만 바깥 인터넷이 필요합니다.** 교내망이 완전히 닫혀 있으면 AI 기능은
동작하지 않고 나머지는 정상입니다.

---

## 5단계 — 데이터베이스 띄우기

```powershell
cd C:\srv\supabase\docker
docker compose pull
docker compose up -d
docker compose ps
```

처음 `pull` 은 5~15분 걸립니다. 모든 서비스가 `running` / `healthy` 여야 합니다.

브라우저에서 `http://10.91.10.127:8000` 을 열면 관리 화면(Studio)이 뜹니다. 4단계에서 정한
`DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` 로 들어갑니다.

---

## 6단계 — 표 만들고 관리자 지정

```powershell
cd C:\srv\supabase\docker
docker compose cp C:\srv\eduform\supabase\schema.sql db:/tmp/schema.sql
docker compose exec db psql -U postgres -d postgres -f /tmp/schema.sql
```

`schema.sql` 은 몇 번 실행해도 안전합니다. 샘플 데이터도 넣어 보시려면 `seed.sql` 로 한 번 더.

**첫 관리자 계정** — Studio(`:8000`) → **Authentication** → **Users** → **Add user** →
이메일과 비밀번호를 넣고 **Auto Confirm User** 를 켠 뒤 만듭니다. 그다음:

```powershell
docker compose exec db psql -U postgres -d postgres -c "insert into profiles (id, email, name, role) select id, email, '관리자', 'admin' from auth.users where email = 'dadat@geoje-m.gne.go.kr' on conflict (id) do update set role = 'admin';"
```

이 계정으로 로그인하면 반과 교사·학생을 등록할 수 있습니다. 나머지 계정은 전부
관리자 화면에서 엑셀로 넣습니다.

---

## 7단계 — 에듀폼 실행

```powershell
cd C:\srv\eduform
npm ci
npm run build
npm run start
```

`http://10.91.10.127:3000` 에서 로그인해 봅니다.

> `NEXT_PUBLIC_` 로 시작하는 값은 **빌드할 때 코드에 박힙니다.** 서버 IP 나 키를 바꾸면
> `npm run build` 를 다시 해야 합니다. `.env.local` 만 고치고 재시작해도 반영되지 않습니다.
>
> 빌드에는 바깥 인터넷이 필요하지 않습니다. 웹폰트를 쓰지 않고 기기에 있는 글꼴만 씁니다.
> (`npm ci` 로 패키지를 받을 때만 인터넷이 필요합니다)

점검 명령도 있습니다:

```powershell
npm run doctor
```

---

## 8단계 — 방화벽 열기

관리자 PowerShell (교내망에서만 접속되도록 대역을 제한합니다):

```powershell
New-NetFirewallRule -DisplayName "에듀폼 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -RemoteAddress 10.0.0.0/8
New-NetFirewallRule -DisplayName "Supabase API 8000" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -RemoteAddress 10.0.0.0/8
```

학교 대역이 `10.x` 가 아니면 `-RemoteAddress` 를 실제 대역으로 바꾸세요. 대역 제한을 빼면
학교망 전체에 열립니다.

다른 컴퓨터에서 확인:

```powershell
Test-NetConnection 10.91.10.127 -Port 3000
Test-NetConnection 10.91.10.127 -Port 8000
```

---

## 9단계 — 재부팅 후에도 켜지게

**Docker Desktop 이 먼저 걸립니다.** 이 프로그램은 **누군가 로그인해야** 시작합니다. 정전 뒤
컴퓨터만 켜지고 아무도 로그인하지 않으면 데이터베이스가 뜨지 않습니다. 둘 중 하나를 해야 합니다.

- Docker Desktop 설정에서 `Start Docker Desktop when you sign in` 을 켜고, 서버 계정을
  **자동 로그인**으로 둡니다 (가장 간단합니다).
- 또는 WSL2 안의 Docker Engine 으로 옮깁니다 (로그인 없이 뜹니다. 설정이 더 복잡합니다).

컨테이너 자체는 `restart` 정책이 있어 Docker 가 뜨면 함께 올라옵니다.

**에듀폼 앱**은 작업 스케줄러에 등록합니다.

```powershell
@"
@echo off
cd /d C:\srv\eduform
"C:\Program Files\nodejs\node.exe" node_modules\next\dist\bin\next start -p 3000 >> C:\srv\eduform-log.txt 2>&1
"@ | Set-Content -Encoding OEM C:\srv\eduform-start.cmd

schtasks /create /tn "에듀폼" /tr "C:\srv\eduform-start.cmd" /sc onstart /ru SYSTEM /rl HIGHEST /f
schtasks /run /tn "에듀폼"
```

Docker 가 아직 안 떴을 때 앱이 먼저 시작하면 로그인만 실패합니다. 잠시 뒤 저절로 정상이 됩니다.

---

## 10단계 — 백업

**이제 학생 기록이 이 컴퓨터 한 대에만 있습니다.** 디스크가 죽으면 끝입니다. 백업은 필수입니다.

```powershell
New-Item -ItemType Directory -Force C:\srv\backup | Out-Null

@"
@echo off
set D=%date:~0,4%%date:~5,2%%date:~8,2%
cd /d C:\srv\supabase\docker
docker compose exec -T db pg_dump -U postgres -d postgres --clean --if-exists > C:\srv\backup\eduform_%D%.sql
forfiles /p C:\srv\backup /m eduform_*.sql /d -30 /c "cmd /c del @path" 2>nul
"@ | Set-Content -Encoding OEM C:\srv\eduform-backup.cmd

schtasks /create /tn "에듀폼 백업" /tr "C:\srv\eduform-backup.cmd" /sc daily /st 03:00 /ru SYSTEM /rl HIGHEST /f
```

한 번 손으로 돌려서 파일이 생기는지 확인하고, **`C:\srv\backup` 을 학교 공용 폴더나 외부
디스크로 주 1회 복사**하세요. 같은 디스크에 둔 백업은 디스크가 죽을 때 같이 죽습니다.

되돌리기:

```powershell
docker compose cp C:\srv\backup\eduform_20260824.sql db:/tmp/restore.sql
docker compose exec db psql -U postgres -d postgres -f /tmp/restore.sql
```

---

## 알아둘 것

- **HTTP 입니다.** 교내망이라 인증서를 붙이지 않았습니다. 같은 망에 있는 사람이 통신을
  들여다보면 비밀번호가 보입니다. 신경 쓰이면 인증서를 넣으세요.
- **학교 밖에서는 접속되지 않습니다.** 사설 IP 입니다. 집에서 쓰려면 별도 조치가 필요하고,
  그 순간 "학교 안에만 둔다" 는 전제가 깨집니다.
- **AI 기능만 바깥 인터넷을 씁니다.** 막혀 있으면 그 두 기능만 안 됩니다.
- **정전.** 상시 서버라면 UPS 를 두는 편이 좋습니다. Postgres 가 쓰는 중에 전원이 끊기면
  복구에 시간이 걸립니다.

---

## 막혔을 때

**Studio 는 열리는데 앱에서 로그인이 안 된다**
`.env.local` 의 `NEXT_PUBLIC_SUPABASE_URL` 이 `localhost` 로 되어 있을 가능성이 높습니다.
브라우저가 8000 번에 직접 붙기 때문에 서버 IP 여야 합니다. 고친 뒤 `npm run build` 를 다시 하세요.

**모든 요청이 401 로 떨어진다**
`ANON_KEY` 가 `JWT_SECRET` 으로 서명된 것이 아닙니다. 3단계를 다시 실행해 세 값을
한 세트로 맞추세요. 섞어 쓰면 안 됩니다.

**가입은 되는데 로그인이 안 된다**
`ENABLE_EMAIL_AUTOCONFIRM=true` 인지 확인하고 `docker compose up -d auth` 로 다시 띄웁니다.

**컨테이너가 계속 재시작한다**

```powershell
docker compose logs --tail 50 db
docker compose logs --tail 50 auth
```

메모리 부족이면 Docker Desktop → Settings → Resources 에서 할당을 올립니다.

**표가 없다고 나온다**
6단계를 건너뛰었습니다. 확인:

```powershell
docker compose exec db psql -U postgres -d postgres -c "\dt"
```
