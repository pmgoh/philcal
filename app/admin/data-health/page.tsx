'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import AdminLayout from '@/components/AdminLayout'
import { getSchools, getPromotions, type PromoEntry } from '@/lib/db'
import { findSchoolForPromo, buildAliasIndex, normalizeSchoolName, findSimilarSchoolNames, type AliasMap } from '@/lib/schoolMatching'
import schoolAliases from '@/data/school-aliases.json'
import type { School } from '@/types'
import { AlertTriangle, Link2, Building2, Tag, RefreshCw, ChevronRight } from 'lucide-react'

interface OrphanGroup {
  schoolName: string
  count: number
  active: number
  promos: PromoEntry[]
  suggestions: Array<{ name: string; score: number; schoolId: string }>
}

export default function DataHealthPage() {
  const [schools, setSchools] = useState<School[]>([])
  const [promos, setPromos] = useState<PromoEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'orphan_promos' | 'unknown_schools'>('orphan_promos')

  const load = async () => {
    setLoading(true)
    try {
      const [s, p] = await Promise.all([getSchools(), getPromotions()])
      setSchools(s)
      setPromos(p)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const aliasIdx = buildAliasIndex(schoolAliases as unknown as AliasMap)

  // ── 미연결 프로모션 (orphan promos) ────────────────────────────────────────
  const orphanGroups: OrphanGroup[] = (() => {
    const orphans = promos.filter(p => {
      const matched = findSchoolForPromo(
        { schoolId: p.schoolId, schoolName: p.schoolName },
        schools,
        aliasIdx
      )
      return !matched
    })
    const byName: Record<string, PromoEntry[]> = {}
    for (const p of orphans) {
      const key = p.schoolName || '(이름 없음)'
      if (!byName[key]) byName[key] = []
      byName[key].push(p)
    }
    return Object.entries(byName).map(([schoolName, ps]) => {
      const sims = findSimilarSchoolNames(schoolName, schools.map(s => s.name), 3)
      return {
        schoolName,
        count: ps.length,
        active: ps.filter(p => p.active).length,
        promos: ps,
        suggestions: sims
          .filter(s => s.score >= 50)
          .map(s => ({ ...s, schoolId: schools.find(sc => sc.name === s.name)!.id })),
      }
    }).sort((a, b) => b.active - a.active || b.count - a.count)
  })()

  // ── 프로모션 미확인 학원 (promotions === null) ─────────────────────────────
  const unknownPromoSchools = schools.filter(s => s.promotions === null)

  if (loading) return (
    <AdminLayout>
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    </AdminLayout>
  )

  const totalIssues = orphanGroups.length + unknownPromoSchools.length

  return (
    <AdminLayout>
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        {/* 헤더 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <AlertTriangle size={20} className="text-amber-500" />
              데이터 확인 필요
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {totalIssues === 0
                ? '✅ 확인이 필요한 항목이 없습니다.'
                : `해결 필요 ${totalIssues}건 — 견적 봇의 할인 누락을 방지하려면 아래를 정리하세요.`}
            </p>
          </div>
          <button onClick={load} className="btn-secondary flex items-center gap-1.5 text-sm">
            <RefreshCw size={14} /> 새로고침
          </button>
        </div>

        {/* 탭 */}
        <div className="flex gap-1 mb-4 border-b border-gray-200">
          <TabButton
            active={tab === 'orphan_promos'}
            onClick={() => setTab('orphan_promos')}
            icon={<Link2 size={14} />}
            label="미연결 프로모션"
            count={orphanGroups.length}
            sublabel={`${orphanGroups.reduce((s, g) => s + g.active, 0)}개 활성`}
          />
          <TabButton
            active={tab === 'unknown_schools'}
            onClick={() => setTab('unknown_schools')}
            icon={<Building2 size={14} />}
            label="프로모션 미확인 학원"
            count={unknownPromoSchools.length}
          />
        </div>

        {/* ── 미연결 프로모션 ── */}
        {tab === 'orphan_promos' && (
          <div className="space-y-3">
            {orphanGroups.length === 0 ? (
              <EmptyState message="모든 프로모션이 학원과 연결되어 있습니다." />
            ) : (
              <>
                <p className="text-xs text-gray-500">
                  프로모션은 등록되어 있지만 연결된 학원이 없습니다. 해당 학원을 추가하거나, 후보 학원이 있다면 연결하세요.
                </p>
                {orphanGroups.map(g => (
                  <div key={g.schoolName} className="card p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <div className="font-semibold text-gray-900">{g.schoolName}</div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          프로모션 {g.count}개 ({g.active}개 활성)
                        </div>
                      </div>
                      <Link
                        href="/schools/new"
                        className="btn-primary text-xs flex items-center gap-1 whitespace-nowrap"
                      >
                        학원 추가 <ChevronRight size={12} />
                      </Link>
                    </div>
                    {g.suggestions.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <div className="text-xs font-medium text-gray-600 mb-1.5">유사한 기존 학원:</div>
                        <div className="space-y-1">
                          {g.suggestions.map(s => (
                            <Link
                              key={s.schoolId}
                              href={`/schools/${s.schoolId}`}
                              className="flex items-center gap-2 text-xs bg-gray-50 hover:bg-blue-50 px-2.5 py-1.5 rounded transition-colors"
                            >
                              <Building2 size={12} className="text-gray-400" />
                              <span className="text-gray-700">{s.name}</span>
                              <span className={`ml-auto ${s.score >= 80 ? 'text-green-600' : 'text-yellow-600'}`}>
                                유사도 {s.score}
                              </span>
                            </Link>
                          ))}
                        </div>
                        <div className="text-xs text-gray-400 mt-1.5">
                          같은 학원이라면 위 학원의 편집 페이지에서 "{g.schoolName}"의 프로모션을 연결할 수 있습니다.
                        </div>
                      </div>
                    )}
                    <details className="mt-3 pt-3 border-t border-gray-100">
                      <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
                        프로모션 목록 보기
                      </summary>
                      <ul className="mt-2 space-y-0.5 text-xs">
                        {g.promos.map(p => (
                          <li key={p.id} className="flex items-center gap-2 text-gray-600">
                            <Tag size={10} className={p.active ? 'text-green-600' : 'text-gray-400'} />
                            <span>{p.promoName}</span>
                            {!p.active && <span className="text-gray-400">(비활성)</span>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* ── 프로모션 미확인 학원 ── */}
        {tab === 'unknown_schools' && (
          <div className="space-y-3">
            {unknownPromoSchools.length === 0 ? (
              <EmptyState message="모든 학원의 프로모션 상태가 확인되었습니다." />
            ) : (
              <>
                <p className="text-xs text-gray-500">
                  학원은 등록되어 있지만 프로모션 정보가 입력되지 않았습니다.
                  견적 봇은 이 학원의 견적에 "프로모션 미확인" 경고를 표시합니다.
                </p>
                {unknownPromoSchools.map(s => (
                  <div key={s.id} className="card p-4 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 truncate">{s.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{s.region} · {s.programTags?.join(', ') || '태그 없음'}</div>
                    </div>
                    <Link
                      href={`/schools/${s.id}`}
                      className="btn-primary text-xs flex items-center gap-1 whitespace-nowrap"
                    >
                      편집 <ChevronRight size={12} />
                    </Link>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}

function TabButton({
  active, onClick, icon, label, count, sublabel,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  count: number
  sublabel?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-blue-600 text-blue-700'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      }`}
    >
      {icon}
      <span>{label}</span>
      <span className={`px-1.5 py-0.5 rounded text-xs ${count > 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
        {count}
      </span>
      {sublabel && <span className="text-xs text-gray-400">{sublabel}</span>}
    </button>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-12 text-gray-500 text-sm">
      ✅ {message}
    </div>
  )
}
