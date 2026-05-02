'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  getRedirectResult,
  GoogleAuthProvider,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { ExternalLink, Copy, Check } from 'lucide-react'

// WebView 감지 (카톡, 라인, 네이버, 인스타 등 인앱브라우저)
function isWebView(): boolean {
  if (typeof window === 'undefined') return false
  const ua = navigator.userAgent
  return /KAKAOTALK|kakaotalk|Line\/|NAVER|Instagram|FB_IAB|FBAN|FBAV|MicroMessenger|GSA\/|Musical_ly|twitter|Snapchat/.test(ua)
    || /\bwv\b/.test(ua)
    || (ua.includes('Android') && /Version\/\d+\.\d+/.test(ua) && !ua.includes('Chrome'))
}

function WebViewWarning({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  const isKakao = typeof window !== 'undefined' && /KAKAOTALK|kakaotalk/.test(navigator.userAgent)
  const isAndroid = typeof window !== 'undefined' && /android/i.test(navigator.userAgent)

  const openExternal = () => {
    if (isAndroid) {
      // Android: intent scheme으로 Chrome 강제 실행
      window.location.href = `intent://${url.replace('https://', '')}#Intent;scheme=https;package=com.android.chrome;end`
    } else {
      // iOS: safari로 열기 시도
      window.open(url, '_blank')
    }
  }

  const copyUrl = async () => {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-600 rounded-2xl mb-4 shadow-lg">
            <span className="text-white text-2xl font-bold">E</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900">엠버시 견적 시스템</h1>
        </div>

        <div className="card p-6 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-sm font-bold text-amber-800 mb-1">
              {isKakao ? '카카오톡' : '인앱'} 브라우저 감지됨
            </p>
            <p className="text-xs text-amber-700 leading-relaxed">
              Google 로그인은 보안 정책상 인앱 브라우저에서 사용할 수 없습니다.<br/>
              <strong>Chrome 또는 Safari</strong>에서 접속해주세요.
            </p>
          </div>

          <button
            onClick={openExternal}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            <ExternalLink size={16} />
            외부 브라우저로 열기
          </button>

          <div className="text-center">
            <p className="text-xs text-gray-400 mb-2">위 버튼이 안 되면 주소를 복사하세요</p>
            <button
              onClick={copyUrl}
              className="flex items-center justify-center gap-2 w-full px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50"
            >
              {copied ? <><Check size={13} className="text-green-500" /> 복사됨!</> : <><Copy size={13} /> {url} 복사</>}
            </button>
          </div>

          {isKakao && (
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-500 font-medium mb-2">카카오톡에서 여는 방법</p>
              <ol className="text-xs text-gray-500 space-y-1 list-decimal list-inside">
                <li>위 &ldquo;외부 브라우저로 열기&rdquo; 버튼 탭</li>
                <li>안 되면 주소 복사 후 Chrome/Safari 실행</li>
                <li>주소창에 붙여넣기 후 접속</li>
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(true)
  const [inWebView, setInWebView] = useState(false)
  const [currentUrl, setCurrentUrl] = useState('philcal.vercel.app/login')

  useEffect(() => {
    setInWebView(isWebView())
    setCurrentUrl(window.location.href)

    // 리다이렉트 결과 처리
    getRedirectResult(auth)
      .then(result => {
        if (result?.user) router.replace('/schools')
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [router])

  const handleGoogle = async () => {
    setLoading(true)
    setError('')
    const provider = new GoogleAuthProvider()
    try {
      await signInWithPopup(auth, provider)
      router.replace('/schools')
    } catch (e: unknown) {
      const code = (e as { code?: string }).code ?? ''
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setError('로그인 창이 닫혔습니다.')
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

  // 초기 로딩
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100">
      <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )

  // WebView 감지 → 외부 브라우저 안내
  if (inWebView) return <WebViewWarning url={currentUrl} />

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-600 rounded-2xl mb-4 shadow-lg">
            <span className="text-white text-2xl font-bold">E</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">엠버시 견적 시스템</h1>
          <p className="text-gray-500 text-sm mt-1">필리핀 어학연수 학비 견적</p>
        </div>

        <div className="card p-8 space-y-4">
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
            Google로 로그인
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
