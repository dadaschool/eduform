import { GoogleGenerativeAI } from '@google/generative-ai'

/**
 * AI 텍스트 생성 — Gemini 를 먼저 쓰고 실패하면 업스테이지(Solar)로 넘어간다.
 *
 * Gemini 키가 속한 Google 프로젝트가 차단되는 경우(PERMISSION_DENIED)나
 * 무료 등급 할당량이 0 인 경우가 있어, 한쪽이 죽어도 기능이 멈추지 않게 한다.
 *
 * 순서를 바꾸려면 환경변수 AI_PRIMARY=upstage 로 두면 된다.
 * Gemini 가 항상 실패하는 상황이라면 이렇게 해서 헛된 호출 한 번을 줄일 수 있다.
 *
 * 요금은 «시점» 에 따라 다르다. 업스테이지는 2027-04-30 까지 무료이고 그 뒤로
 * 유료다(선불 크레딧, 모자라면 등록된 카드로 청구). 유료인 동안에는 폴백이
 * «조용히» 넘어가지 못하게 막는다 — 아래 [요금 판단] 참고.
 */

export type AIProvider = 'gemini' | 'upstage'

/**
 * 제공자가 «돈이 나가는 곳» 인지 — «지금» 기준으로 판단한다.
 *
 * ⚠ 실제로 겪은 일이다 — 학교 구글 계정으로 발급한 Gemini 키가 관리자 정책에 막혀
 *   `429 limit: 0` 을 내자, 폴백이 아무 말 없이 업스테이지로 넘어가 요금이 청구됐다.
 *   무료 쪽이 죽으면 «기능이 멈추는» 것이 아니라 «과금이 시작되는» 구조였다.
 *   그래서 유료 제공자는 부르는 쪽이 명시적으로 허락(allowPaid)해야만 호출한다.
 *
 * 그런데 «유료» 는 고정된 사실이 아니다. 업스테이지는 2027-04-30 까지 무료다.
 * 그 기간에 확인 창을 띄우면 헛수고이고, 매번 묻는 창은 결국 사람이 눈감고
 * 누르게 만든다 — 정작 돈이 나갈 때의 경고까지 무력해진다.
 * 그래서 날짜를 담아 둔다. 무료 기간이 끝나면 코드를 고치지 않아도 다시 막힌다.
 *
 * 제공자를 새로 추가할 때 여기에 반드시 적을 것. 빠뜨리면 무료로 취급되어
 * 다시 조용히 과금된다.
 */
interface Pricing {
  /**
   * 이 시각부터 «유료» 로 본다. null 이면 유료가 되지 않는다(무료 등급).
   * 한국 시간 자정을 기준으로 잡는다 — 하루 일찍 막히는 쪽이 안전하다.
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
}

/** 사람이 읽는 제공자 이름. 확인 창과 토스트에 그대로 나간다. */
export const PROVIDER_LABEL: Record<AIProvider, string> = {
  gemini: 'Google Gemini',
  upstage: '업스테이지 Solar',
}

/**
 * 지금 이 제공자를 쓰면 요금이 나가는가.
 *
 * at 을 넘길 수 있게 둔 것은 «무료 기간이 끝난 뒤» 를 시험하기 위해서다.
 * 그 시점을 기다려서 확인할 수는 없다.
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
 * 기본은 꺼짐 — 기본값을 켜지 말 것. 이 스위치가 «모르는 사이의 과금» 을 막는 마지막 문이다.
 */
export function paidAllowedByEnv(): boolean {
  const v = (process.env.AI_ALLOW_PAID ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/** 유료 제공자만 남았는데 허락이 없을 때 던지는 오류. API 가 이것을 402 로 바꾼다. */
export class PaidConfirmRequired extends Error {
  readonly provider: AIProvider
  /** 무료 쪽이 왜 실패했는지 — 사용자에게 그대로 보여 준다. */
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
  /**
   * 요금 판단의 기준 시각. 비우면 지금.
   * «무료 기간이 끝난 뒤» 를 시험하려고 둔 것이다 — 그 날짜를 기다릴 수는 없다.
   */
  at?: Date
}

export interface GenerateResult {
  text: string
  /** 실제로 응답한 제공자. 폴백이 작동했는지 확인할 때 쓴다. */
  provider: AIProvider
  /** 유료 제공자를 썼는가. 화면이 «요금이 나갔다» 고 알려 줄 때 쓴다. */
  paid: boolean
}

const GEMINI_MODEL = 'gemini-2.0-flash-lite'
const UPSTAGE_MODEL = 'solar-pro3'
const UPSTAGE_ENDPOINT = 'https://api.upstage.ai/v1/chat/completions'

/**
 * 제공자 한 곳당 제한 시간.
 *
 * 교내망처럼 바깥으로 나가는 통신이 막힌 곳에서는 방화벽이 거절 응답을 주지 않고
 * 패킷을 그냥 버린다. 그러면 fetch 가 OS 의 TCP 대기 시간(윈도우는 2분 이상)만큼
 * 멈춰 있고, 폴백까지 두 번 기다리면 화면이 4분 넘게 돌아간다.
 * 여기서 끊어야 "AI 만 안 되고 나머지는 정상" 이 된다.
 */
const TIMEOUT_MS = 20_000

async function generateWithGemini({ system, user }: GenerateOptions): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY 미설정')

  const genAI = new GoogleGenerativeAI(key)
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL }, { timeout: TIMEOUT_MS })

  const parts = system ? [{ text: system }, { text: user }] : [{ text: user }]
  const result = await model.generateContent(parts)
  const text = result.response.text().trim()
  if (!text) throw new Error('빈 응답')
  return text
}

async function generateWithUpstage({ system, user }: GenerateOptions): Promise<string> {
  const key = process.env.UPSTAGE_API_KEY
  if (!key) throw new Error('UPSTAGE_API_KEY 미설정')

  // OpenAI 호환 형식이다.
  const messages = system
    ? [{ role: 'system', content: system }, { role: 'user', content: user }]
    : [{ role: 'user', content: user }]

  const res = await fetch(UPSTAGE_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: UPSTAGE_MODEL, messages }),
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

export async function generateText(opts: GenerateOptions): Promise<GenerateResult> {
  const order: AIProvider[] =
    process.env.AI_PRIMARY === 'upstage' ? ['upstage', 'gemini'] : ['gemini', 'upstage']

  // 이번 호출에서 유료 제공자를 써도 되는가.
  // 화면에서 사용자가 확인했거나(allowPaid), 서버가 아예 허용해 둔 경우(AI_ALLOW_PAID)뿐이다.
  const paidOk = opts.allowPaid === true || paidAllowedByEnv()
  const now = opts.at ?? new Date()

  const failures: string[] = []
  /** 허락이 없어 건너뛴 유료 제공자. 마지막에 «확인이 필요하다» 고 알려 주기 위해 들고 있는다. */
  let blockedPaid: AIProvider | null = null

  for (const provider of order) {
    // 키가 없는 제공자는 조용히 건너뛴다. 둘 중 하나만 설정해도 동작해야 한다.
    const hasKey =
      provider === 'gemini' ? Boolean(process.env.GEMINI_API_KEY) : Boolean(process.env.UPSTAGE_API_KEY)
    if (!hasKey) continue

    // 🔴 유료 제공자는 허락 없이 부르지 않는다. «조용히 넘어가는» 일을 여기서 끊는다.
    if (isPaidProvider(provider, now) && !paidOk) {
      console.warn(`[ai] ${provider} 는 유료라 건너뜀 (확인을 받지 않았습니다)`)
      blockedPaid = provider
      continue
    }

    try {
      const text = provider === 'gemini' ? await generateWithGemini(opts) : await generateWithUpstage(opts)
      if (isPaidProvider(provider, now)) console.warn(`[ai] 유료 제공자(${provider}) 로 생성했습니다 — 요금이 청구됩니다`)
      return { text, provider, paid: isPaidProvider(provider, now) }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      const name = err instanceof Error ? err.name : ''
      // 시간 초과는 원문이 "The operation was aborted due to timeout" 처럼 나와
      // 원인을 짐작하기 어렵다. 교내망에서 가장 흔한 실패라 따로 적어 준다.
      const timedOut = name === 'TimeoutError' || name === 'AbortError' || /timeout|aborted/i.test(raw)
      const message = timedOut
        ? `${TIMEOUT_MS / 1000}초 안에 응답 없음 (바깥 인터넷이 막혀 있을 수 있습니다)`
        : raw
      // 서버 로그에 남겨 어느 쪽이 왜 실패했는지 추적할 수 있게 한다.
      console.error(`[ai] ${provider} 실패: ${message}`)
      failures.push(`${provider}: ${message}`)
    }
  }

  // 무료 쪽이 다 죽었고 남은 것이 유료뿐이라면 — 몰래 쓰지 않고 되물어본다.
  // 화면이 이 오류를 받아 «유료로 진행할까요?» 를 묻고, 예를 누르면 allowPaid 로 다시 부른다.
  if (blockedPaid) throw new PaidConfirmRequired(blockedPaid, failures)

  if (failures.length === 0) {
    throw new Error('AI 키가 설정되지 않았습니다. GEMINI_API_KEY 또는 UPSTAGE_API_KEY 를 등록하세요.')
  }
  throw new Error(`AI 생성 실패 — ${failures.join(' / ')}`)
}
