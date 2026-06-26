'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { GraduationCap } from 'lucide-react'

export default function RegisterPage() {
  const router = useRouter()
  const supabase = createClient()
  const [step, setStep] = useState<'code' | 'info'>('code')
  const [inviteCode, setInviteCode] = useState('')
  const [classInfo, setClassInfo] = useState<{ id: string; name: string } | null>(null)
  const [name, setName] = useState('')
  const [studentNumber, setStudentNumber] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCodeVerify(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('invite_codes')
        .select('id, class_id, is_active, expires_at, max_uses, used_count, classes(name)')
        .eq('code', inviteCode.toUpperCase().trim())
        .single()
      if (error || !data) throw new Error('유효하지 않은 초대코드입니다.')
      if (!data.is_active) throw new Error('만료된 초대코드입니다.')
      if (data.expires_at && new Date(data.expires_at) < new Date()) throw new Error('만료된 초대코드입니다.')
      if (data.used_count >= data.max_uses) throw new Error('초대코드 사용 한도에 도달했습니다.')
      const cls = data.classes as unknown as { name: string }
      setClassInfo({ id: data.class_id, name: cls.name })
      setStep('info')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '코드 확인에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    if (!classInfo) return
    setLoading(true)
    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({ email, password })
      if (authError) throw authError
      if (!authData.user) throw new Error('회원가입 실패')

      const { error: profileError } = await supabase.from('profiles').insert({
        id: authData.user.id,
        email,
        name,
        role: 'student',
        class_id: classInfo.id,
        student_number: studentNumber || null,
      })
      if (profileError) throw profileError

      // 초대코드 사용 횟수 증가
      await supabase.rpc('increment_invite_code', { code: inviteCode.toUpperCase().trim() })

      toast.success('회원가입이 완료되었습니다!')
      router.push('/student/dashboard')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '회원가입에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-100 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-green-500 rounded-2xl mb-4">
            <GraduationCap className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">에듀폼</h1>
          <p className="text-gray-500 mt-1">학생 회원가입</p>
        </div>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-xl">
              {step === 'code' ? '초대코드 입력' : '계정 정보 입력'}
            </CardTitle>
            <CardDescription>
              {step === 'code'
                ? '선생님으로부터 받은 초대코드를 입력하세요'
                : `${classInfo?.name} 반에 가입합니다`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {step === 'code' ? (
              <form onSubmit={handleCodeVerify} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="code">초대코드</Label>
                  <Input
                    id="code"
                    placeholder="초대코드 8자리 입력"
                    value={inviteCode}
                    onChange={e => setInviteCode(e.target.value.toUpperCase())}
                    className="text-center text-lg font-mono tracking-widest uppercase"
                    maxLength={8}
                    required
                  />
                </div>
                <Button type="submit" className="w-full bg-green-600 hover:bg-green-700" disabled={loading}>
                  {loading ? '확인 중...' : '코드 확인'}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="p-3 bg-green-50 rounded-lg text-sm text-green-700 border border-green-200">
                  ✓ <strong>{classInfo?.name}</strong> 반 확인 완료
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">이름</Label>
                  <Input id="name" placeholder="홍길동" value={name} onChange={e => setName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="studentNumber">학번 (선택)</Label>
                  <Input id="studentNumber" placeholder="예: 20101" value={studentNumber} onChange={e => setStudentNumber(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">이메일</Label>
                  <Input id="email" type="email" placeholder="student@email.com" value={email} onChange={e => setEmail(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">비밀번호 (6자 이상)</Label>
                  <Input id="password" type="password" placeholder="비밀번호 입력" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required />
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setStep('code')}>
                    이전
                  </Button>
                  <Button type="submit" className="flex-1 bg-green-600 hover:bg-green-700" disabled={loading}>
                    {loading ? '가입 중...' : '가입하기'}
                  </Button>
                </div>
              </form>
            )}
            <div className="mt-4 text-center">
              <p className="text-sm text-gray-600">
                이미 계정이 있나요?{' '}
                <Link href="/student-login" className="text-green-600 font-medium hover:underline">
                  로그인
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
