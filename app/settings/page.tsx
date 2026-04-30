'use client'
import { useState, useEffect } from 'react'
import AdminLayout from '@/components/AdminLayout'
import { getExchangeRate, saveExchangeRate } from '@/lib/db'
import type { ExchangeRate } from '@/types'
import { Save, Check, RefreshCw } from 'lucide-react'

export default function SettingsPage() {
  const [rate, setRate] = useState<ExchangeRate>({ phpToKrw: 25, usdToKrw: 1380, updatedAt: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getExchangeRate().then(r => { setRate(r); setLoading(false) })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    await saveExchangeRate({ phpToKrw: rate.phpToKrw, usdToKrw: rate.usdToKrw })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    setRate(prev => ({ ...prev, updatedAt: new Date().toISOString() }))
  }

  if (loading) return (
    <AdminLayout>
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    </AdminLayout>
  )

  return (
    <AdminLayout>
      <div className="p-8 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">설정</h1>

        {/* 환율 */}
        <div className="card p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-gray-900">기준 환율</h2>
              <p className="text-sm text-gray-500 mt-0.5">현지납부비(PHP) 및 달러 기준 학원 원화 환산에 사용됩니다.</p>
            </div>
            {rate.updatedAt && (
              <span className="text-xs text-gray-400">
                마지막 수정: {new Date(rate.updatedAt).toLocaleDateString('ko-KR')}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
              <label className="block text-sm font-medium text-orange-800 mb-2">
                🇵🇭 PHP → KRW
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-orange-600">₱1 =</span>
                <input
                  type="number"
                  step="0.1"
                  min="1"
                  value={rate.phpToKrw}
                  onChange={e => setRate(prev => ({ ...prev, phpToKrw: Number(e.target.value) }))}
                  className="input-field w-24 text-center font-bold"
                />
                <span className="text-sm text-orange-600">원</span>
              </div>
              <p className="text-xs text-orange-500 mt-1.5">
                예시: ₱10,000 = {(10000 * rate.phpToKrw).toLocaleString()}원
              </p>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <label className="block text-sm font-medium text-green-800 mb-2">
                🇺🇸 USD → KRW
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-green-600">$1 =</span>
                <input
                  type="number"
                  step="1"
                  min="1"
                  value={rate.usdToKrw}
                  onChange={e => setRate(prev => ({ ...prev, usdToKrw: Number(e.target.value) }))}
                  className="input-field w-24 text-center font-bold"
                />
                <span className="text-sm text-green-600">원</span>
              </div>
              <p className="text-xs text-green-500 mt-1.5">
                예시: $100 = {(100 * rate.usdToKrw).toLocaleString()}원
              </p>
            </div>
          </div>

          <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
            {saved ? <><Check size={14} /> 저장됨</> : saving ? '저장 중...' : <><Save size={14} /> 환율 저장</>}
          </button>
        </div>

        {/* Firebase 초기화 안내 */}
        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-2">Firebase 연동 안내</h2>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800 space-y-2">
            <p className="font-medium">배포 전 환경변수 설정이 필요합니다.</p>
            <div className="font-mono text-xs bg-white rounded p-3 space-y-0.5 border border-blue-200">
              <div>NEXT_PUBLIC_FIREBASE_API_KEY=</div>
              <div>NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=</div>
              <div>NEXT_PUBLIC_FIREBASE_PROJECT_ID=</div>
              <div>NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=</div>
              <div>NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=</div>
              <div>NEXT_PUBLIC_FIREBASE_APP_ID=</div>
            </div>
            <p>Vercel 배포 시 Project Settings → Environment Variables에서 설정하세요.</p>
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}
