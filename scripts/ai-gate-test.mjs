/* 유료 전환 차단이 «정말로» 막는지 확인한다.
   가짜 fetch 를 끼워 넣어 어느 주소로 나갔는지 세어 본다.

   키는 이제 교사마다 다르다(teacher_ai_keys). generateText 는 «키 목록» 을
   받아 그 순서대로 시도한다 — 그래서 여기서도 keys 배열을 직접 넘긴다. */

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
  if (u.includes('api.upstage.ai') || u.includes('api.openai.com')) {
    return new Response(JSON.stringify({ choices: [{ message: { content: '유료로 만든 글' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return realFetch(url, init)
}

const paidCalls = () => calls.filter(u => u.includes('api.upstage.ai') || u.includes('api.openai.com')).length
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

// 업스테이지는 2027-04-30 까지 무료다. «지금» 과 «무료가 끝난 뒤» 를 나눠서 본다.
const FREE = new Date('2026-08-26T00:00:00Z')       // 무료 기간 안
const PAID_ERA = new Date('2027-05-01T00:00:00Z')   // 유료로 바뀐 뒤

const K = {
  gemini: { provider: 'gemini', key: 'fake-gemini' },
  upstage: { provider: 'upstage', key: 'fake-upstage' },
  openai: { provider: 'openai', key: 'fake-openai' },
}
const BASE = { AI_ALLOW_PAID: null }

// ① 요금 판단이 «시점» 을 본다
console.log('\n■ 무료 기간 판단')
check('지금 업스테이지는 무료다', AI.isPaidProvider('upstage', FREE) === false)
check('무료 마지막 날(한국시간)도 무료다',
  AI.isPaidProvider('upstage', new Date('2027-04-30T12:00:00Z')) === false)
check('2027-05-01 부터 유료다', AI.isPaidProvider('upstage', PAID_ERA) === true)
check('제미나이는 언제나 무료 등급', AI.isPaidProvider('gemini', PAID_ERA) === false)
check('OpenAI 는 언제나 유료 (무료 등급 없음)', AI.isPaidProvider('openai', FREE) === true)
check('요금 안내에 날짜가 들어 있다', AI.pricingNote('upstage').includes('2027-04-30'))

// ② 무료 기간 동안에는 «묻지 않고» 폴백이 그대로 동작해야 한다.
await scenario('무료 기간 · Gemini 429 → 묻지 않고 업스테이지로 넘어간다', BASE, async () => {
  const r = await AI.generateText({ user: '안녕', at: FREE }, [K.gemini, K.upstage])
  check('업스테이지가 답한다', r.provider === 'upstage', `(실제: ${r.provider})`)
  check('paid 표시가 꺼져 있다', r.paid === false, `(실제: ${r.paid})`)
  check('유료 주소로 요청이 나갔다(무료 기간이라 허용)', paidCalls() === 1, `(실제: ${paidCalls()}건)`)
})

// ③ 무료 기간이 끝나면 «코드를 고치지 않아도» 다시 막혀야 한다
await scenario('유료 기간 · 허락 없음 → 유료를 아예 안 부른다', BASE, async () => {
  let err = null
  try { await AI.generateText({ user: '안녕', at: PAID_ERA }, [K.gemini, K.upstage]) } catch (e) { err = e }
  check('PaidConfirmRequired 를 던진다', err?.name === 'PaidConfirmRequired', `(실제: ${err?.name})`)
  check('유료 주소로 나간 요청 0건', paidCalls() === 0, `(실제: ${paidCalls()}건)`)
  check('앞선 실패/건너뜀 이유를 함께 전달한다', (err?.freeFailures ?? []).length > 0, JSON.stringify(err?.freeFailures))
})

// ④ 사람이 «예» 를 눌렀을 때만 유료가 나간다
await scenario('allowPaid:true → 그때만 유료를 부른다', BASE, async () => {
  const r = await AI.generateText({ user: '안녕', allowPaid: true, at: PAID_ERA }, [K.gemini, K.upstage])
  check('업스테이지가 답한다', r.provider === 'upstage', `(실제: ${r.provider})`)
  check('paid 표시가 켜진다', r.paid === true, `(실제: ${r.paid})`)
  check('유료 주소로 나간 요청 1건', paidCalls() === 1, `(실제: ${paidCalls()}건)`)
})

// ⑤ 서버가 아예 허용해 둔 경우(AI_ALLOW_PAID=1)
await scenario('AI_ALLOW_PAID=1 → 묻지 않고 유료를 쓴다(일부러 켠 사람용)',
  { ...BASE, AI_ALLOW_PAID: '1' }, async () => {
  const r = await AI.generateText({ user: '안녕', at: PAID_ERA }, [K.gemini, K.upstage])
  check('업스테이지가 답한다', r.provider === 'upstage', `(실제: ${r.provider})`)
  check('paid 표시가 켜진다', r.paid === true)
})

// ⑥ OpenAI 만 등록돼 있으면 (언제나 유료) 확인 없이는 안 나간다
await scenario('OpenAI 단독 · 허락 없음 → 확인을 요구한다', BASE, async () => {
  let err = null
  try { await AI.generateText({ user: '안녕', at: FREE }, [K.openai]) } catch (e) { err = e }
  check('PaidConfirmRequired 를 던진다', err?.name === 'PaidConfirmRequired', `(실제: ${err?.name})`)
  check('OpenAI 로 나간 요청 0건', paidCalls() === 0, `(실제: ${paidCalls()}건)`)
})

// ⑦ 무료 키만 있고 그것이 실패하면 — 확인 요구가 아니라 그냥 실패
await scenario('Gemini 단독 · 429 → 확인 요구가 아니라 평범한 실패', BASE, async () => {
  let err = null
  try { await AI.generateText({ user: '안녕' }, [K.gemini]) } catch (e) { err = e }
  check('PaidConfirmRequired 가 아니다', err?.name !== 'PaidConfirmRequired', `(실제: ${err?.name})`)
  check('유료 주소로 나간 요청 0건', paidCalls() === 0)
})

// ⑧ 키가 하나도 없으면 NO_AI_KEYS
await scenario('키 목록이 비어 있으면 NO_AI_KEYS', BASE, async () => {
  let err = null
  try { await AI.generateText({ user: '안녕' }, []) } catch (e) { err = e }
  check('NO_AI_KEYS 를 던진다', err?.message === AI.NO_AI_KEYS, `(실제: ${err?.message})`)
})

// ⑨ 무료가 성공하면 유료는 건드리지도 않는다
await scenario('Gemini 성공 → 유료는 부르지 않는다', BASE, async () => {
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
  const r = await AI.generateText({ user: '안녕' }, [K.gemini, K.upstage])
  check('제미나이가 답한다', r.provider === 'gemini', `(실제: ${r.provider})`)
  check('paid 표시가 꺼져 있다', r.paid === false, `(실제: ${r.paid})`)
  check('유료 주소로 나간 요청 0건', paidCalls() === 0, `(실제: ${paidCalls()}건)`)
  globalThis.fetch = before
})

console.log(`\n===== 통과 ${pass} · 실패 ${fail} =====`)
process.exit(fail ? 1 : 0)
