import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/**
 * 교사 계정을 만든다. 관리자만 호출할 수 있다.
 *
 * 엑셀 일괄 등록 화면이 한 행마다 이 라우트를 부른다.
 * (학생 등록 create-student 와 같은 방식)
 *
 * auth 사용자와 profiles 행을 함께 만든다. profiles 를 빼먹으면 로그인은
 * 되는데 레이아웃끼리 서로 밀어내 무한 리다이렉트에 빠진다. 그래서 profiles
 * 삽입이 실패하면 만든 auth 사용자를 되돌린다.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

    const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (me?.role !== 'admin') return NextResponse.json({ error: '관리자만 등록할 수 있습니다' }, { status: 403 })

    const { name, email, password } = await req.json()
    if (!name || !email) return NextResponse.json({ error: '이름과 이메일은 필수입니다' }, { status: 400 })
    if (!password || String(password).length < 6) {
      return NextResponse.json({ error: '비밀번호는 6자 이상이어야 합니다' }, { status: 400 })
    }

    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // 같은 이메일이 이미 있으면 비밀번호만 바꾼다 (명단을 다시 올릴 때를 위해)
    const { data: existingUsers } = await adminClient.auth.admin.listUsers()
    const existing = existingUsers?.users?.find(u => u.email === email)

    if (existing) {
      await adminClient.auth.admin.updateUserById(existing.id, { password })

      // 프로필이 없거나 역할이 다르면 교사로 맞춘다
      const { data: prof } = await adminClient.from('profiles').select('role').eq('id', existing.id).single()
      if (!prof) {
        const { error } = await adminClient.from('profiles').insert({
          id: existing.id, email, name, role: 'teacher',
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        return NextResponse.json({ success: true, userId: existing.id, repaired: true })
      }
      if (prof.role !== 'teacher') {
        return NextResponse.json(
          { error: `이미 ${prof.role === 'admin' ? '관리자' : '학생'} 계정입니다` },
          { status: 409 }
        )
      }
      return NextResponse.json({ success: true, userId: existing.id, updated: true })
    }

    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })

    const { error: profileError } = await adminClient.from('profiles').insert({
      id: authData.user.id, email, name, role: 'teacher',
    })
    if (profileError) {
      // 프로필 없는 계정을 남기면 로그인 시 무한 리다이렉트가 된다
      await adminClient.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ error: profileError.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, userId: authData.user.id })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 })
  }
}
