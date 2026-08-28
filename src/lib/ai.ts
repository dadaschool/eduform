import { GoogleGenerativeAI } from '@google/generative-ai'

/**
 * AI 텍스트 생성 — 넘겨받은 키 목록을 «순서대로» 시도한다.
 *
 * 키는 교사마다 다르다 (teacher_ai_keys). 어떤 키를 어떤 순서로 쓸지는 호출부
 * (src/lib/ai-keys.ts) 가 정해서 넘기고, 이 파일은 그 순서대로 한 곳씩 시도하다
 * 실패하면 다음으로 넘어가는 일을 한다.
 *
 * ─────────────────────────────────────────────
 * 요금 판단 — 유료 제공자로 «조용히» 넘어가지 않는다
 * ─────────────────────────────────────────────
 * ⚠ 실제로 겪은 일이다 — 학교 구글 계정으로 발급한 Gemini 키가 관리자 정책에 막혀
 *   `429 limit: 0` 을 내자, 폴백이 아무 말 없이 유료 제공자로 넘어가 요금이 청구됐다.
 *   무료 쪽이 죽으면 «기능이 멈추는» 것이 아니라 «과금이 시작되는» 구조였다.
 *   그래서 유료 제공자는 부르는 쪽이 명시적으로 허락(allowPaid)해야만 호출한다.
 *
 * 교사가 자기 키를 등록하는 구조가 됐어도 이 문은 그대로 둔다 — 무료 등급으로
 * 발급한 Gemini 키가 막히는 상황은 여전하고, 그때 교사 본인이 등록한 OpenAI
 * 키로 조용히 넘어가면 «내가 안 시킨 요금» 이 되는 건 마찬가지다.
 *
 * «유료» 는 고정된 사실이 아니다. 업스테이지는 2027-04-30 까지 무료다.
 * 그 기간에 확인 창을 띄우면 헛수고이고, 매번 묻는 창은 결국 사람이 눈감고
 * 누르게 만든다. 그래서 날짜를 담아 둔다 — 무료 기간이 끝나면 코드를 고치지
 * 않아도 다시 막힌다. 제공자를 새로 추가할 때 PRICING 에 반드시 적을 것.
 */

export type AIProvider = 'gemini' | 'upstage' | 'openai'

export interface ProviderKey {
  provider: AIProvider
  key: string
  /** 어디서 온 키인지 — 오류 메시지에만 쓴다 ('내 키' | '학교 공용') */
  source?: string
}

/** 키가 하나도 없을 때 던지는 오류. 화면이 이 코드를 보고 «내 계정» 으로 안내한다. */
export const NO_AI_KEYS = 'NO_AI_KEYS'

interface Pricing {
  /**
   * 이 시각부터 «유료» 로 본다. null 이면 유료가 되지 않는다(무료 등급).
   * 0 이면 언제나 유료(무료 등급 자체가 없음).
   */
  paidFrom: number | null
  /** 요금 안내. 확인 창에 그대로 나간다. */
  note: string
}

/** 2027-05-01 00:00 (한국시간) = 2027-04-30 15:00 UTC */
const UPSTAGE_PAID_FROM = Date.UTC(2027, 3, 30, 15, 0, 0)

const PRICING: Record<AIProvider, Pricing> = {
  gemini: {
    paidFrom: null,
    note: 'Google AI Studio 무료 등급',
  },
  upstage: {
    paidFrom: UPSTAGE_PAID_FROM,
    note: '2027-04-30 까지 무료. 이후 solar-pro3 입력 $0.15 / 출력 $0.60 (100만 토큰당)',
  },
  openai: {
    // OpenAI 는 무료 등급이 없다 — 등록하는 순간부터 쓴 만큼 과금된다.
    paidFrom: 0,
    note: 'OpenAI 는 무료 등급이 없습니다 — gpt-4o-mini 입력 $0.15 / 출력 $0.60 (100만 토큰당, 시세)',
  },
}

/** 사람이 읽는 제공자 이름. 확인 창과 토스트에 그대로 나간다. */
export const PROVIDER_LABEL: Record<AIProvider, string> = {
  gemini: 'Google Gemini',
  upstage: '업스테이지 Solar',
  openai: 'OpenAI ChatGPT',
}

/**
 * 지금 이 제공자를 쓰면 요금이 나가는가.
 * at 을 넘길 수 있게 둔 것은 «무료 기간이 끝난 뒤» 를 시험하기 위해서다.
 */
export function isPaidProvider(provider: AIProvider, at: Date = new Date()): boolean {
  const { paidFrom } = PRICING[provider]
  return paidFrom !== null && at.getTime() >= paidFrom
}

/** 요금 안내 문구. 확인 창에서 «왜 돈이 나가는지» 를 설명한다. */
export function pricingNote(provider: AIProvider): string {
  return PRICING[provider].note
}

/**
 * 서버에서 유료 호출을 아예 자동 허용하고 싶을 때만 쓴다(AI_ALLOW_PAID=1).
 * 기본은 꺼짐 — 이 스위치가 «모르는 사이의 과금» 을 막는 마지막 문이다.
 */
export function paidAllowedByEnv(): boolean {
  const v = (process.env.AI_ALLOW_PAID ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/** 유료 제공자만 남았는데 허락이 없을 때 던지는 오류. API 가 이것을 402 로 바꾼다. */
export class PaidConfirmRequired extends Error {
  readonly provider: AIProvider
  /** 앞선 제공자들이 왜 실패/건너뜀 됐는지 — 사용자에게 그대로 보여 준다. */
  readonly freeFailures: string[]

  constructor(provider: AIProvider, freeFailures: string[]) {
    super(`유료 제공자(${PROVIDER_LABEL[provider]}) 확인이 필요합니다`)
    this.name = 'PaidConfirmRequired'
    this.provider = provider
    this.freeFailures = freeFailures
  }
}

export interface GenerateOptions {
  /** 역할·형식 지시 (선택) */
  system?: string
  /** 실제 요청 내용 */
  user: string
  /**
   * 유료 제공자를 써도 좋다고 «이번 한 번» 허락한다.
   * 화면에서 사용자가 확인 창에 «예» 를 눌렀을 때만 true 로 온다.
   * ⚠ 기억해 두지 않는다 — 매번 묻는다.
   */
  allowPaid?: boolean
  /** 요금 판단의 기준 시각. 비우면 지금. «무료 기간이 끝난 뒤» 시험용. */
  at?: Date
}

export interface GenerateResult {
  text: string
  /** 실제로 응답한 제공자. */
  provider: AIProvider
  /** 유료 제공자를 썼는가. 화면이 «요금이 나갔다» 고 알려 줄 때 쓴다. */
  paid: boolean
}

const GEMINI_MODEL = 'gemini-2.0-flash-lite'
const UPSTAGE_MODEL = 'solar-pro3'
const UPSTAGE_ENDPOINT = 'https://api.upstage.ai/v1/chat/completions'
const OPENAI_MODEL = 'gpt-4o-mini'
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'

/**
 * 제공자 한 곳당 제한 시간.
 *
 * 바깥으로 나가는 통신이 막힌 곳에서는 방화벽이 거절 응답을 주지 않고 패킷을
 * 그냥 버린다. 그러면 fetch 가 OS 의 TCP 대기 시간만큼 멈춰 있고, 폴백까지
 * 여러 번 기다리면 화면이 몇 분씩 돌아간다. 여기서 끊는다.
 */
const TIMEOUT_MS = 20_000

async function generateWithGemini({ system, user }: GenerateOptions, key: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(key)
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL }, { timeout: TIMEOUT_MS })
  const parts = system ? [{ text: system }, { text: user }] : [{ text: user }]
  const result = await model.generateContent(parts)
  const text = result.response.text().trim()
  if (!text) throw new Error('빈 응답')
  return text
}

/** Upstage 와 OpenAI 는 요청 형식이 같다 (OpenAI 호환 chat/completions). */
async function generateWithOpenAICompatible(
  { system, user }: GenerateOptions,
  key: string,
  endpoint: string,
  model: string
): Promise<string> {
  const messages = system
    ? [{ role: 'system', content: system }, { role: 'user', content: user }]
    : [{ role: 'user', content: user }]

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP ${res.status} ${body.replace(/\s+/g, ' ').slice(0, 200)}`)
  }

  const data = await res.json()
  const text: string | undefined = data?.choices?.[0]?.message?.content
  if (!text?.trim()) throw new Error('빈 응답')
  return text.trim()
}

async function runOne(provider: AIProvider, key: string, opts: GenerateOptions): Promise<string> {
  switch (provider) {
    case 'gemini':
      return generateWithGemini(opts, key)
    case 'upstage':
      return generateWithOpenAICompatible(opts, key, UPSTAGE_ENDPOINT, UPSTAGE_MODEL)
    case 'openai':
      return generateWithOpenAICompatible(opts, key, OPENAI_ENDPOINT, OPENAI_MODEL)
  }
}

/**
 * 넘겨받은 키를 앞에서부터 시도한다.
 * @param keys 시도 순서대로 정렬된 키 목록. 비어 있으면 NO_AI_KEYS 를 던진다.
 */
export async function generateText(opts: GenerateOptions, keys: ProviderKey[]): Promise<GenerateResult> {
  if (keys.length === 0) throw new Error(NO_AI_KEYS)

  // 이번 호출에서 유료 제공자를 써도 되는가.
  const paidOk = opts.allowPaid === true || paidAllowedByEnv()
  const now = opts.at ?? new Date()

  const failures: string[] = []
  /** 허락이 없어 건너뛴 «첫» 유료 제공자. 마지막에 확인을 요구할 때 쓴다. */
  let blockedPaid: AIProvider | null = null

  for (const { provider, key, source } of keys) {
    if (!key) continue
    const label = source ? `${PROVIDER_LABEL[provider]}(${source})` : PROVIDER_LABEL[provider]

    // 🔴 유료 제공자는 허락 없이 부르지 않는다. «조용히 넘어가는» 일을 여기서 끊는다.
    if (isPaidProvider(provider, now) && !paidOk) {
      console.warn(`[ai] ${provider} 는 유료라 건너뜀 (확인을 받지 않았습니다)`)
      if (!blockedPaid) blockedPaid = provider
      failures.push(`${label}: 유료라 건너뜀`)
      continue
    }

    try {
      const text = await runOne(provider, key, opts)
      if (isPaidProvider(provider, now)) {
        console.warn(`[ai] 유료 제공자(${provider}) 로 생성했습니다 — 요금이 청구됩니다`)
      }
      return { text, provider, paid: isPaidProvider(provider, now) }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      const name = err instanceof Error ? err.name : ''
      const timedOut = name === 'TimeoutError' || name === 'AbortError' || /timeout|aborted/i.test(raw)
      const message = timedOut
        ? `${TIMEOUT_MS / 1000}초 안에 응답 없음 (바깥 인터넷이 막혀 있을 수 있습니다)`
        : raw
      console.error(`[ai] ${label} 실패: ${message}`)
      failures.push(`${label}: ${message}`)
    }
  }

  // 앞선 것이 다 죽었고 남은 것이 «허락 안 한 유료» 뿐이라면 — 몰래 쓰지 않고 되묻는다.
  if (blockedPaid) throw new PaidConfirmRequired(blockedPaid, failures)

  throw new Error(`AI 생성 실패 — ${failures.join(' / ')}`)
}

/**
 * 키 1개를 실제 호출로 검증한다. «저장» 버튼이 부른다.
 * 성공하면 아무것도 안 하고, 실패하면 사람이 읽을 수 있는 사유를 던진다.
 * (유료 게이트는 여기서 적용하지 않는다 — 교사가 방금 그 키를 직접 넣었으니
 *  한 번 부르는 것에 동의한 것으로 본다. 아주 짧은 프롬프트만 보낸다.)
 */
export async function verifyKey(provider: AIProvider, key: string): Promise<void> {
  try {
    await runOne(provider, key, { user: 'ping. 한 단어로만 답하세요: OK' })
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    const name = err instanceof Error ? err.name : ''
    if (name === 'TimeoutError' || name === 'AbortError' || /timeout|aborted/i.test(raw)) {
      throw new Error('응답이 없습니다 (바깥 인터넷이 막혀 있거나 키가 잘못됐을 수 있습니다)')
    }
    throw new Error(raw)
  }
}
