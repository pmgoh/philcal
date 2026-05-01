'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'

function isInAppBrowser(): boolean {
  if (typeof window === 'undefined') return false
  const ua = navigator.userAgent.toLowerCase()
  return ua.includes('kakaotalk') || ua.includes('line/') || ua.includes('fbav') ||
    ua.includes('instagram') || ua.includes('naver') || ua.includes('wv') ||
    (ua.includes('android') && ua.includes('wv'))
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [inApp, setInApp]       = useState(false)

  // 리다이렉트 결과 처리 (카톡 인앱브라우저에서 돌아왔을 때)
  useEffect(() => {
    setInApp(isInAppBrowser())
    setLoading(true)
    getRedirectResult(auth)
      .then(result => {
        if (result?.user) router.replace('/schools')
      })
      .catch(e => {
        if (e.code !== 'auth/no-current-user') {
          setError('로그인에 실패했습니다. 다시 시도해주세요.')
        }
      })
      .finally(() => setLoading(false))
  }, [router])

  const handleGoogle = async () => {
    setLoading(true)
    setError('')
    const provider = new GoogleAuthProvider()
    try {
      if (inApp || isInAppBrowser()) {
        // 인앱브라우저: 리다이렉트 방식
        await signInWithRedirect(auth, provider)
      } else {
        // 일반 브라우저: 팝업 방식
        await signInWithPopup(auth, provider)
        router.replace('/schools')
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? (e as { code?: string }).code ?? '' : ''
      if (msg === 'auth/popup-closed-by-user' || msg === 'auth/cancelled-popup-request') {
        setError('로그인 창이 닫혔습니다. 다시 시도해주세요.')
      } else if (msg === 'auth/popup-blocked') {
        // 팝업 차단시 리다이렉트로 재시도
        await signInWithRedirect(auth, provider)
      } else {
        setError('Google 로그인에 실패했습니다.')
        console.error(e)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await signInWithEmailAndPassword(auth, email, password)
      router.replace('/schools')
    } catch {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100 p-4">
      <div className="w-full max-w-sm">
        {/* 로고 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-600 rounded-2xl mb-4 shadow-lg">
            <span className="text-white text-2xl font-bold">E</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">엠버시 견적 시스템</h1>
          <p className="text-gray-500 text-sm mt-1">필리핀 어학연수 학비 견적</p>
        </div>

        <div className="card p-8 space-y-4">
          {inApp && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2">
              카카오톡 브라우저에서 접속 중입니다. Google 로그인 시 외부 브라우저로 이동합니다.
            </div>
          )}

          {/* Google 로그인 */}
          <button
            onClick={handleGoogle}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 shadow-sm"
          >
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
              <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
              <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"/>
            </svg>
            {loading ? '처리 중...' : 'Google로 로그인'}
          </button>

          <div className="flex items-center gap-3">
            <hr className="flex-1 border-gray-200" />
            <span className="text-xs text-gray-400">또는</span>
            <hr className="flex-1 border-gray-200" />
          </div>

          <form onSubmit={handleEmail} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="input-field" placeholder="example@embassyedu.com"
                required autoComplete="email" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                className="input-field" placeholder="비밀번호를 입력하세요"
                required autoComplete="current-password" />
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-3 py-2">
                {error}
              </div>
            )}
            <button type="submit" disabled={loading} className="btn-primary w-full py-3">
              {loading ? '로그인 중...' : '이메일로 로그인'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          © {new Date().getFullYear()} 엠버시유학 (주식회사)
        </p>
      </div>
    </div>
  )
}
