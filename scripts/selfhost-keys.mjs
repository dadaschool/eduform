#!/usr/bin/env node
/**
 * 자체 호스팅용 키 생성기.
 *
 * Supabase 를 학교 서버에 직접 띄우면 클라우드 대시보드가 없으니
 * anon / service_role 키를 직접 만들어야 한다. 두 키는 JWT_SECRET 으로
 * HS256 서명한 JWT 이고, 서명이 어긋나면 모든 요청이 401 로 떨어진다.
 *
 *   node scripts/selfhost-keys.mjs            키 한 세트 생성
 *   node scripts/selfhost-keys.mjs --selftest 서명 로직 검증
 *
 * 출력된 값은 화면에만 나온다. 파일로 저장하지 않는다.
 */
import { createHmac, randomBytes } from 'node:crypto'

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const b64urlDecode = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()

/** HS256 JWT. */
function sign(payload, secret) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const sig = b64url(createHmac('sha256', secret).update(`${head}.${body}`).digest())
  return `${head}.${body}.${sig}`
}

const YEARS = 10

/** 키 한 세트. secret 을 주면 그 값으로 서명한다 (테스트용). */
function makeKeys(secret = alnum(48), now = Date.now()) {
  const iat = Math.floor(now / 1000)
  const exp = iat + YEARS * 365 * 24 * 60 * 60
  return {
    jwtSecret: secret,
    anonKey: sign({ role: 'anon', iss: 'supabase', iat, exp }, secret),
    serviceKey: sign({ role: 'service_role', iss: 'supabase', iat, exp }, secret),
  }
}

// base64 는 특수문자가 섞여 .env / 접속문자열에서 깨지므로 영숫자만 쓴다
function alnum(n) {
  const cs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from(randomBytes(n), (b) => cs[b % cs.length]).join('')
}

function selftest() {
  let pass = 0, fail = 0
  const check = (label, cond, detail = '') => {
    if (cond) { console.log(`  OK   ${label}`); pass++ }
    else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); fail++ }
  }

  // 1. HMAC-SHA256 자체가 맞는지. RFC 4231 공식 시험값.
  check('RFC 4231 case 1',
    createHmac('sha256', Buffer.alloc(20, 0x0b)).update('Hi There').digest('hex') ===
    'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7')
  check('RFC 4231 case 2',
    createHmac('sha256', 'Jefe').update('what do ya want for nothing?').digest('hex') ===
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')

  // 2. base64url — URL 에 못 쓰는 문자가 남으면 게이트웨이가 키를 잘라 읽는다
  const enc = b64url('?~??+/=')
  check('base64url 문자 제한', !/[+/=]/.test(enc), enc)
  check('base64url 왕복', b64urlDecode(b64url('{"role":"anon"}')) === '{"role":"anon"}')

  // 3. 헤더는 Supabase 가 기대하는 고정 문자열이어야 한다
  const { jwtSecret, anonKey, serviceKey } = makeKeys('test-secret-at-least-32-characters-long!!', 1700000000000)
  check('JWT 헤더', anonKey.split('.')[0] === 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', anonKey.split('.')[0])

  // 4. 서명 검증 — 같은 비밀로는 통과, 다른 비밀로는 실패해야 한다
  const verify = (token, secret) => {
    const [h, b, s] = token.split('.')
    return b64url(createHmac('sha256', secret).update(`${h}.${b}`).digest()) === s
  }
  check('올바른 비밀로 검증 통과', verify(anonKey, jwtSecret))
  check('다른 비밀은 검증 실패', !verify(anonKey, jwtSecret + 'x'))
  check('한 글자 위조는 검증 실패',
    !verify(anonKey.slice(0, -1) + (anonKey.at(-1) === 'A' ? 'B' : 'A'), jwtSecret))

  // 5. payload 내용 — role 이 틀리면 권한이 통째로 잘못 붙는다
  const anon = JSON.parse(b64urlDecode(anonKey.split('.')[1]))
  const svc = JSON.parse(b64urlDecode(serviceKey.split('.')[1]))
  check('anon role', anon.role === 'anon', anon.role)
  check('service_role role', svc.role === 'service_role', svc.role)
  check('iss', anon.iss === 'supabase', anon.iss)
  check('만료가 미래', anon.exp > Math.floor(Date.now() / 1000), String(anon.exp))
  check('만료가 10년 뒤', anon.exp - anon.iat === YEARS * 365 * 24 * 60 * 60)
  check('두 키는 서로 다르다', anonKey !== serviceKey)

  // 6. 비밀은 GoTrue 최소 길이(32)를 넘어야 한다
  check('생성 비밀 길이 >= 32', makeKeys().jwtSecret.length >= 32)
  check('생성 비밀은 영숫자만', /^[A-Za-z0-9]+$/.test(makeKeys().jwtSecret))

  console.log(`\n${pass} 통과, ${fail} 실패`)
  process.exit(fail === 0 ? 0 : 1)
}

if (process.argv.includes('--selftest')) selftest()

// --- 새 키 세트 ---
const { jwtSecret, anonKey, serviceKey } = makeKeys()
const pgPassword = alnum(32)
const dashPassword = alnum(20)
const host = process.env.EDUFORM_HOST || '<서버IP>'

console.log(`
================================================================
  1) selfhost/.env  (Supabase 스택용)
================================================================
POSTGRES_PASSWORD=${pgPassword}
JWT_SECRET=${jwtSecret}
ANON_KEY=${anonKey}
SERVICE_ROLE_KEY=${serviceKey}
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=${dashPassword}
SITE_URL=http://${host}:3000
API_EXTERNAL_URL=http://${host}:8000
SUPABASE_PUBLIC_URL=http://${host}:8000

================================================================
  2) .env.local  (에듀폼용)
================================================================
NEXT_PUBLIC_SUPABASE_URL=http://${host}:8000
NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}
SUPABASE_SERVICE_ROLE_KEY=${serviceKey}
SUPABASE_DB_URL=postgresql://postgres:${pgPassword}@localhost:5432/postgres

================================================================
  주의
================================================================
- <서버IP> 는 학생·교사 기기에서 접속할 주소다. localhost 로 두면
  서버 컴퓨터 브라우저에서만 로그인된다. (브라우저가 8000 번에 직접 붙는다)
  EDUFORM_HOST=10.91.10.127 node scripts/selfhost-keys.mjs 처럼 지정하면
  주소까지 채워서 출력한다.
- SERVICE_ROLE_KEY 는 RLS 를 무시한다. 깃·채팅·학생 기기에 절대 넣지 않는다.
- JWT_SECRET 을 바꾸면 위 두 키를 다시 만들어야 한다.
- 이 값들을 잃어버리면 DB 접속과 로그인이 모두 막힌다. 지금 안전한 곳에 옮겨둔다.
`)
