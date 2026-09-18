/**
 * AI API 를 부르는 화면 쪽 공통 절차.
 *
 * 하는 일은 하나다 — **유료 AI 로 넘어가기 전에 반드시 사람에게 묻는다.**
 *
 * 🔴 왜 있나 : 예전에는 무료 Gemini 가 실패하면 서버가 아무 말 없이 유료 업스테이지로
 *    넘어갔다. 학교 구글 계정 키가 관리자 정책에 막혀 `429 limit: 0` 을 내는 바람에
 *    **모든 AI 요청이 유료로 흘러 요금이 청구됐다.** 무료 쪽이 죽으면 «기능이 멈추는»
 *    것이 아니라 «과금이 시작되는» 구조였고, 화면에는 아무 표시도 없었다.
 *
 * 흐름 :
 *   ① allowPaid 없이 한 번 보낸다 → 서버는 무료 제공자만 시도한다
 *   ② 무료가 다 실패하면 서버가 402 + needPaidConfirm 을 돌려준다
 *   ③ 여기서 사람에게 묻는다 → «예» 일 때만 allowPaid:true 로 **한 번** 다시 보낸다
 *
 * ⚠ 확인 결과를 저장하지 않는다. 매번 묻는다.
 *   한 번 «예» 를 기억해 두면 그때부터 다시 «모르는 사이의 과금» 이 된다.
 */

interface PaidConfirmBody {
  needPaidConfirm?: boolean
  providerLabel?: string
  /** 왜 돈이 나가는지 — 서버가 보내 주는 요금 안내 */
  pricing?: string
  freeFailures?: string[]
  error?: string
}

/** 사용자가 유료 사용을 거절했을 때. 화면은 이것을 «오류» 가 아니라 조용한 취소로 다룬다. */
export class PaidDeclined extends Error {
  constructor() {
    super('유료 AI 사용을 취소했습니다. 요금은 나가지 않았습니다.')
    this.name = 'PaidDeclined'
  }
}

/** 등록된 AI API 키가 하나도 없을 때. 화면은 «내 계정» 으로 안내한다. */
export class NoAiKeys extends Error {
  constructor() {
    super('등록된 AI API 키가 없습니다. 내 계정에서 먼저 등록하세요.')
    this.name = 'NoAiKeys'
  }
}

export async function callAI<T>(url: string, body: Record<string, unknown>): Promise<T> {
  async function send(allowPaid: boolean) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, allowPaid }),
    })
    const data = await res.json().catch(() => ({}))
    return { res, data }
  }

  let { res, data } = await send(false)

  if (res.status === 402 && (data as PaidConfirmBody)?.needPaidConfirm) {
    const info = data as PaidConfirmBody
    const why = (info.freeFailures ?? []).map(f => `  · ${f}`).join('\n') || '  · (이유가 전달되지 않았습니다)'
    const ok = window.confirm(
      `무료 AI 가 실패했습니다.\n\n${why}\n\n` +
      `남은 것은 유료 «${info.providerLabel ?? '유료 제공자'}» 뿐입니다.\n` +
      (info.pricing ? info.pricing + '\n' : '') +
      `쓴 만큼 요금이 청구됩니다.\n\n` +
      `진행할까요?\n\n` +
      `(이 확인은 저장되지 않습니다 — 다음에도 다시 묻습니다)`
    )
    if (!ok) throw new PaidDeclined()
    ;({ res, data } = await send(true))
  }

  if (!res.ok) {
    if ((data as PaidConfirmBody)?.error === 'NO_AI_KEYS') throw new NoAiKeys()
    throw new Error((data as PaidConfirmBody)?.error || 'AI 생성 실패')
  }
  return data as T
}
