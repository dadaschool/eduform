/* 유료 전환 차단이 «정말로» 막는지 확인한다.
   가짜 fetch 를 끼워 넣어 어느 주소로 나갔는지 세어 본다. */

const AI = await import(new URL('../src/lib/ai.ts', import.meta.url).href)

const calls = []
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  const u = String(url?.url ?? url)
  calls.push(u)
  if (u.includes('generativelanguage')) {
    // 학교 계정 키가 실제로 내던 응답을 흉내 낸다
    return new Response(JSON.stringify({ error: { code: 429, message: 'Quota exceeded, limit: 0' } }),
      { status: 429, headers: { 'Content-Type': 'application/json' } })
  }
  if (u.includes('api.upstage.ai')) {
    return new Response(JSON.stringify({ choices: [{ message: { content: '유료로 만든 글' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return realFetch(url, init)
}

const upstageCalls = () => calls.filter(u => u.includes('api.upstage.ai')).length
let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${detail}`) }
}

async function scenario(title, env, run) {
  console.log(`\n■ ${title}`)
  for (const [k, v] of Object.entries(env)) {
    if (v === null) delete process.env[k]; else process.env[k] = v
  }
  calls.length = 0
  await run()
}

const BASE = { GEMINI_API_KEY: 'fake-gemini', UPSTAGE_API_KEY: 'fake-upstage', AI_ALLOW_PAID: null }

// ① 지금 실제 설정 : AI_PRIMARY=upstage (유료가 1순위) + 허락 없음
await scenario('AI_PRIMARY=upstage · 허락 없음 → 유료를 아예 안 불러야 한다',
  { ...BASE, AI_PRIMARY: 'upstage' }, async () => {
  let err = null
  try { await AI.generateText({ user: '안녕' }) } catch (e) { err = e }
  check('PaidConfirmRequired 를 던진다', err?.name === 'PaidConfirmRequired', `(실제: ${err?.name})`)
  check('업스테이지로 나간 요청 0건', upstageCalls() === 0, `(실제: ${upstageCalls()}건)`)
  check('무료 실패 이유를 함께 전달한다', (err?.freeFailures ?? []).length > 0, JSON.stringify(err?.freeFailures))
})

// ② 기본 설정 : gemini 먼저, 실패해도 유료로 넘어가지 않아야 한다
await scenario('AI_PRIMARY 없음 · Gemini 429 → 조용히 유료로 넘어가면 안 된다',
  { ...BASE, AI_PRIMARY: null }, async () => {
  let err = null
  try { await AI.generateText({ user: '안녕' }) } catch (e) { err = e }
  check('PaidConfirmRequired 를 던진다', err?.name === 'PaidConfirmRequired', `(실제: ${err?.name})`)
  check('업스테이지로 나간 요청 0건', upstageCalls() === 0, `(실제: ${upstageCalls()}건)`)
})

// ③ 사람이 «예» 를 눌렀을 때만 유료가 나간다
await scenario('allowPaid:true → 그때만 유료를 부른다',
  { ...BASE, AI_PRIMARY: null }, async () => {
  const r = await AI.generateText({ user: '안녕', allowPaid: true })
  check('업스테이지가 답한다', r.provider === 'upstage', `(실제: ${r.provider})`)
  check('paid 표시가 켜진다', r.paid === true, `(실제: ${r.paid})`)
  check('업스테이지로 나간 요청 1건', upstageCalls() === 1, `(실제: ${upstageCalls()}건)`)
})

// ④ 서버가 아예 허용해 둔 경우(AI_ALLOW_PAID=1)
await scenario('AI_ALLOW_PAID=1 → 묻지 않고 유료를 쓴다(일부러 켠 사람용)',
  { ...BASE, AI_PRIMARY: null, AI_ALLOW_PAID: '1' }, async () => {
  const r = await AI.generateText({ user: '안녕' })
  check('업스테이지가 답한다', r.provider === 'upstage', `(실제: ${r.provider})`)
  check('paid 표시가 켜진다', r.paid === true)
})

// ⑤ 유료 키가 아예 없을 때는 예전처럼 평범한 실패여야 한다
await scenario('업스테이지 키 없음 → 확인 요구가 아니라 그냥 실패',
  { ...BASE, UPSTAGE_API_KEY: null, AI_PRIMARY: null }, async () => {
  let err = null
  try { await AI.generateText({ user: '안녕' }) } catch (e) { err = e }
  check('PaidConfirmRequired 가 아니다', err?.name !== 'PaidConfirmRequired', `(실제: ${err?.name})`)
  check('업스테이지로 나간 요청 0건', upstageCalls() === 0)
})

// ⑥ 무료가 성공하면 유료는 건드리지도 않는다
await scenario('Gemini 성공 → 유료는 부르지 않는다', { ...BASE, AI_PRIMARY: null }, async () => {
  const before = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const u = String(url?.url ?? url)
    calls.push(u)
    if (u.includes('generativelanguage')) {
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '무료로 만든 글' }] } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return before(url, init)
  }
  const r = await AI.generateText({ user: '안녕' })
  check('제미나이가 답한다', r.provider === 'gemini', `(실제: ${r.provider})`)
  check('paid 표시가 꺼져 있다', r.paid === false, `(실제: ${r.paid})`)
  check('업스테이지로 나간 요청 0건', upstageCalls() === 0, `(실제: ${upstageCalls()}건)`)
  globalThis.fetch = before
})

console.log(`\n===== 통과 ${pass} · 실패 ${fail} =====`)
process.exit(fail ? 1 : 0)
