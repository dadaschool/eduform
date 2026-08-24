'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Upload, Download, UserPlus, Search, AlertTriangle } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { Profile } from '@/lib/types'

/** 엑셀 한 행. 컬럼 이름은 한글로 받는다 (학생 등록과 같은 방식) */
interface Row {
  이름?: string
  이메일?: string
  아이디?: string      // 이메일과 같은 뜻으로 받아준다
  비밀번호?: string
  초기비밀번호?: string
}

interface Result {
  email: string
  name: string
  status: 'added' | 'updated' | 'repaired' | 'failed'
  message?: string
}

export default function AdminTeachersPage() {
  const supabase = createClient()
  const [teachers, setTeachers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const [results, setResults] = useState<Result[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  // 한 명씩 추가
  const [openOne, setOpenOne] = useState(false)
  const [oneName, setOneName] = useState('')
  const [oneEmail, setOneEmail] = useState('')
  const [onePw, setOnePw] = useState('')
  const [savingOne, setSavingOne] = useState(false)

  const fetchTeachers = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .in('role', ['teacher', 'admin'])
      .order('role')
      .order('name')
    setTeachers(data ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchTeachers() }, [fetchTeachers])

  async function createOne(name: string, email: string, password: string) {
    const res = await fetch('/api/admin/create-teacher', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    })
    const data = await res.json()
    return { ok: res.ok, data }
  }

  function downloadTemplate() {
    const ws = XLSX.utils.json_to_sheet([
      { 이름: '김민지', 이메일: 'teacher1@school.kr', 비밀번호: 'change-me-1' },
      { 이름: '박준호', 이메일: 'teacher2@school.kr', 비밀번호: 'change-me-2' },
    ])
    ws['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 16 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '교사명단')
    XLSX.writeFile(wb, '교사등록_양식.xlsx')
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setResults([])
    try {
      const wb = XLSX.read(await file.arrayBuffer())
      const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[wb.SheetNames[0]])
      if (rows.length === 0) { toast.error('데이터가 없습니다'); return }

      const out: Result[] = []
      for (const row of rows) {
        const name = (row['이름'] ?? '').toString().trim()
        const email = (row['이메일'] ?? row['아이디'] ?? '').toString().trim()
        const password = (row['비밀번호'] ?? row['초기비밀번호'] ?? '').toString().trim()

        if (!name || !email) {
          out.push({ email: email || '(빈칸)', name: name || '(빈칸)', status: 'failed', message: '이름과 이메일이 필요합니다' })
          continue
        }
        if (password.length < 6) {
          out.push({ email, name, status: 'failed', message: '비밀번호가 6자 미만입니다' })
          continue
        }
        try {
          const { ok, data } = await createOne(name, email, password)
          if (!ok) out.push({ email, name, status: 'failed', message: data.error })
          else if (data.updated) out.push({ email, name, status: 'updated' })
          else if (data.repaired) out.push({ email, name, status: 'repaired' })
          else out.push({ email, name, status: 'added' })
        } catch {
          out.push({ email, name, status: 'failed', message: '요청 실패' })
        }
      }
      setResults(out)

      const added = out.filter(r => r.status === 'added').length
      const updated = out.filter(r => r.status === 'updated' || r.status === 'repaired').length
      const failed = out.filter(r => r.status === 'failed').length
      const msg = [added && `${added}명 등록`, updated && `${updated}명 갱신`, failed && `${failed}명 실패`]
        .filter(Boolean).join(', ')
      if (failed > 0) toast.error(msg)
      else toast.success(msg)
      fetchTeachers()
    } finally {
      if (fileRef.current) fileRef.current.value = ''
      setUploading(false)
    }
  }

  async function submitOne(e: React.FormEvent) {
    e.preventDefault()
    setSavingOne(true)
    try {
      const { ok, data } = await createOne(oneName.trim(), oneEmail.trim(), onePw)
      if (!ok) throw new Error(data.error)
      toast.success(data.updated ? '비밀번호가 변경되었습니다.' : '교사가 등록되었습니다.')
      setOpenOne(false); setOneName(''); setOneEmail(''); setOnePw('')
      fetchTeachers()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '등록 실패')
    } finally {
      setSavingOne(false)
    }
  }

  const filtered = teachers.filter(t =>
    t.name.includes(search) || (t.email ?? '').includes(search)
  )

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">교사 관리</h1>
        <p className="text-gray-500 text-sm mt-1">엑셀 명단으로 교사 계정을 한 번에 등록합니다</p>
      </div>

      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800 space-y-1">
              <p className="font-medium">엑셀 파일에 비밀번호가 들어 있습니다</p>
              <p>
                이 파일 하나로 모든 교사 계정에 로그인할 수 있고, 교사는 학생 개인정보를 봅니다.
                <b className="ml-1">업로드가 끝나면 파일을 지우세요.</b> 메일·공유드라이브·USB 에 남기지 마세요.
              </p>
              <p>교사에게는 첫 로그인 후 비밀번호를 바꾸도록 안내하세요.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">엑셀로 일괄 등록</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-gray-600">
            컬럼 이름을 이렇게 맞춰 주세요. <code className="px-1 bg-gray-100 rounded">이름</code>{' '}
            <code className="px-1 bg-gray-100 rounded">이메일</code>{' '}
            <code className="px-1 bg-gray-100 rounded">비밀번호</code>
            <span className="text-gray-400"> (이메일 대신 <code>아이디</code>, 비밀번호 대신 <code>초기비밀번호</code> 도 인식합니다)</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" onClick={downloadTemplate}>
              <Download className="w-4 h-4" />양식 내려받기
            </Button>
            <Button className="gap-2" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4" />{uploading ? '등록 중...' : '엑셀 올리기'}
            </Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} />

            <Dialog open={openOne} onOpenChange={setOpenOne}>
              <DialogTrigger><Button variant="outline" type="button" className="gap-2"><UserPlus className="w-4 h-4" />한 명 추가</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>교사 한 명 등록</DialogTitle></DialogHeader>
                <form onSubmit={submitOne} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>이름 *</Label>
                    <Input value={oneName} onChange={e => setOneName(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>이메일 (로그인 아이디) *</Label>
                    <Input type="email" value={oneEmail} onChange={e => setOneEmail(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>초기 비밀번호 * (6자 이상)</Label>
                    <Input value={onePw} onChange={e => setOnePw(e.target.value)} minLength={6} required />
                  </div>
                  <Button type="submit" className="w-full" disabled={savingOne}>
                    {savingOne ? '등록 중...' : '등록'}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {results.length > 0 && (
            <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
              {results.map((r, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    r.status === 'failed' ? 'bg-red-100 text-red-700'
                    : r.status === 'added' ? 'bg-green-100 text-green-700'
                    : 'bg-blue-100 text-blue-700'
                  }`}>
                    {r.status === 'added' ? '등록' : r.status === 'updated' ? '비밀번호 변경'
                      : r.status === 'repaired' ? '프로필 복구' : '실패'}
                  </span>
                  <span className="font-medium text-gray-800">{r.name}</span>
                  <span className="text-gray-500">{r.email}</span>
                  {r.message && <span className="text-red-500 ml-auto">{r.message}</span>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">등록된 교사 {teachers.length}명</CardTitle>
            <div className="relative w-56">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <Input placeholder="이름·이메일 검색" className="pl-7 h-8 text-sm"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-gray-400 py-6 text-center">불러오는 중...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">등록된 교사가 없습니다</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>이름</TableHead>
                  <TableHead>이메일 (로그인 아이디)</TableHead>
                  <TableHead>역할</TableHead>
                  <TableHead>등록일</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(t => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-gray-600">{t.email}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        t.role === 'admin' ? 'bg-slate-800 text-white' : 'bg-gray-100 text-gray-700'
                      }`}>
                        {t.role === 'admin' ? '관리자' : '교사'}
                      </span>
                    </TableCell>
                    <TableCell className="text-gray-400 text-sm">{formatDate(t.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
