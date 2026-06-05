'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import AdminLayout from '@/components/AdminLayout'
import { getSchools, getPromotions, type PromoEntry } from '@/lib/db'
import { findSchoolForPromo, buildAliasIndex, findSimilarSchoolNames, type AliasMap } from '@/lib/schoolMatching'
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
  const [tab, setTab] = useState<'orphan_promos' | 'unknown_schools' | 'short_term'>('orphan_promos')

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

  // ── 미연결 프로모션 (orphan promos) - v3 schoolCode 포함 매칭 ─────────────
  const orphanGroups: OrphanGroup[] = (() => {
    const orphans = promos.filter(p => {
      const matched = findSchoolForPromo(
        { schoolId: p.schoolId, schoolCode: p.schoolCode, schoolName: p.schoolName, region: p.region },
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

  // ── 단기(4주 미만) 비율 점검 ──────────────────────────────────────────────
  // 단기 허용 + 코스 보유인데, 단기 비율도 없고 unconfirmed 표시도 없으면
  // 견적이 조용히 정비례로 계산됨 → 운영자가 확인해서 비율 입력 또는 unconfirmed 처리 필요.
  const shortTermIssues = schools.filter(s => {
    const allow = (s as { allowShortTerm?: boolean }).allowShortTerm
    const ncourse = (s.courses ?? []).length
    const hasRates = Boolean(
      (s as { courseShortTermRates?: unknown }).courseShortTermRates ||
      (s as { dormShortTermRates?: unknown }).dormShortTermRates ||
      (s as { shortTermRates?: unknown }).shortTermRates
    )
    const status = (s as { shortTermDataStatus?: string }).shortTermDataStatus
    // 단기허용 + 코스있음 + 비율없음 + (확인됨이라 표시했거나 아무 표시 없음)
    return allow && ncourse > 0 && !hasRates && status !== 'unconfirmed'
  })

  // ── 코스 target(모드 분류) 누락 점검 ──────────────────────────────────────
  // target이 없으면 모드(일반/가족/주니어) 필터가 작동 못 해 탭에서 학원이 잘못 노출됨.
  const targetIssues = schools.filter(s =>
    (s.courses ?? []).some(c => !(c as { target?: string }).target)
  ).map(s => ({
    school: s,
    missing: (s.courses ?? []).filter(c => !(c as { target?: string }).target).length,
    total: (s.courses ?? []).length,
  }))

  // ── 패키지 programType 누락 점검 ──────────────────────────────────────────
  const programTypeIssues = schools.filter(s =>
    (s.packages ?? []).some(p => !(p as { programType?: string }).programType)
  ).map(s => ({
    school: s,
    missing: (s.packages ?? []).filter(p => !(p as { programType?: string }).programType).length,
    total: (s.packages ?? []).length,
  }))

  // ── 비자연장 visaMode/triggerWeeks 점검 ───────────────────────────────────
  // 비자연장 항목이 2개 이상인데 visaMode가 없거나 triggerWeeks가 누락·중복이면 계산 부정확.
  const isVisaExt = (f: { name?: string }) => {
    const nm = String(f.name ?? ''); const low = nm.toLowerCase()
    if (!(nm.includes('비자') || low.includes('visa'))) return false
    return !['card', 'acr', 'i-card', 'ssp', 'e-card'].some(k => low.includes(k))
  }
  const visaIssues = schools.map(s => {
    const lf = (s.localFees ?? []) as unknown as Array<Record<string, unknown>>
    const visa = lf.filter(f => isVisaExt(f as { name?: string }))
    if (visa.length < 2) return null
    const noMode = visa.some(v => !v.visaMode)
    const tws = visa.map(v => v.triggerWeeks)
    const badTw = tws.some(t => t == null) || new Set(tws).size !== tws.length
    if (!noMode && !badTw) return null
    return { school: s, noMode, badTw, count: visa.length }
  }).filter(Boolean) as Array<{ school: typeof schools[0]; noMode: boolean; badTw: boolean; count: number }>

  // ── 유학원 할인 평시 구멍 점검 (1년 3구간 분해) ───────────────────────────
  // 유학원 할인이 비수기 프로모션에만 묶여 있어, 평시 기간 시작 시 할인이 빠지는 학원을 찾는다.
  // 성수기(서차지 기간) + 비수기(유학원할인 날짜 프로모션) + 상시(연중 프로모션)를 모아
  // 1년을 하루씩 분류 → 평시(어디에도 안 속함)가 있는데 상시 유학원할인이 없으면 구멍.
  type SeasonRun = { start: string; end: string; cls: string; days: number }
  type GapSchool = { school: typeof schools[0]; runs: SeasonRun[]; gapDays: number; hasAlwaysAgency: boolean; agencyDesc: string }
  const seasonGapSchools: GapSchool[] = (() => {
    const D = (s: string) => { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd) }
    const fmt = (d: Date) => `${d.getMonth() + 1}월 ${d.getDate()}일`
    const inR = (d: Date, rs: Array<[Date, Date]>) => rs.some(([s, e]) => d >= s && d <= e)
    const out: GapSchool[] = []
    for (const s of schools) {
      // 이 학원의 프로모션
      const myPromos = promos.filter(p => {
        const m = findSchoolForPromo({ schoolId: p.schoolId, schoolCode: p.schoolCode, schoolName: p.schoolName, region: p.region }, schools, aliasIdx)
        return m && m.id === s.id && p.active
      })
      // 유학원 할인 있는 날짜 프로모션 = 비수기
      const agencyDated = myPromos.filter(p =>
        ((p.agencyDiscountStatus as string) === 'confirmed' || (p.agencyDiscountStatus as string) === 'enabled') && (p.agencyDiscountValue ?? 0) > 0 && p.startDate && p.endDate
        && !(p.season === 'all' || p.alwaysApply))
      if (agencyDated.length === 0) continue   // 유학원 할인 자체가 날짜限定으로 없으면 대상 아님
      // 상시 유학원 할인 (있으면 평시 커버됨)
      const hasAlwaysAgency = myPromos.some(p =>
        (p.season === 'all' || p.alwaysApply) && ((p.agencyDiscountStatus as string) === 'confirmed' || (p.agencyDiscountStatus as string) === 'enabled') && (p.agencyDiscountValue ?? 0) > 0)
      const low: Array<[Date, Date]> = agencyDated.map(p => [D(p.startDate!), D(p.endDate!)])
      const peak: Array<[Date, Date]> = ((s.surcharges ?? []) as Array<{ startDate?: string; endDate?: string }>)
        .filter(su => su.startDate && su.endDate).map(su => [D(su.startDate!), D(su.endDate!)])
      // 1년 분류
      const runs: SeasonRun[] = []
      let cur = new Date(2026, 0, 1); const end = new Date(2026, 11, 31)
      let runStart = new Date(cur); let runCls = ''
      const classify = (d: Date) => { const pk = inR(d, peak), lw = inR(d, low); return pk && lw ? '성수기이면서 비수기' : pk ? '성수기' : lw ? '비수기' : '평시' }
      runCls = classify(cur)
      while (cur <= end) {
        const next = new Date(cur); next.setDate(next.getDate() + 1)
        const nextCls = next <= end ? classify(next) : '__END__'
        if (nextCls !== runCls) {
          runs.push({ start: fmt(runStart), end: fmt(cur), cls: runCls, days: Math.round((cur.getTime() - runStart.getTime()) / 86400000) + 1 })
          runStart = new Date(next); runCls = nextCls === '__END__' ? runCls : nextCls
        }
        cur = next
      }
      const gapDays = runs.filter(r => r.cls === '평시').reduce((a, r) => a + r.days, 0)
      if (gapDays > 0 && !hasAlwaysAgency) {
        const ad = agencyDated[0]
        const t = ad.agencyDiscountType
        const v = ad.agencyDiscountValue ?? 0
        const desc = t === 'percent' ? `${v}% 할인` : t === 'amount_per_4weeks' ? `4주당 ${v.toLocaleString()}원` : t === 'amount_per_week' ? `1주당 ${v.toLocaleString()}원` : `${v.toLocaleString()}원`
        out.push({ school: s, runs, gapDays, hasAlwaysAgency, agencyDesc: desc })
      }
    }
    return out.sort((a, b) => b.gapDays - a.gapDays)
  })()

  if (loading) return (
    <AdminLayout>
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    </AdminLayout>
  )

  const totalIssues = orphanGroups.length + unknownPromoSchools.length + visaIssues.length + seasonGapSchools.length

  return (
    <AdminLayout>
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
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
          <TabButton
            active={tab === 'short_term'}
            onClick={() => setTab('short_term')}
            icon={<Building2 size={14} />}
            label="단기 비율 미확인"
            count={shortTermIssues.length}
          />
        </div>

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
                          같은 학원이라면 위 학원의 편집 페이지에서 &ldquo;{g.schoolName}&rdquo;의 프로모션을 연결할 수 있습니다.
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

        {tab === 'unknown_schools' && (
          <div className="space-y-3">
            {unknownPromoSchools.length === 0 ? (
              <EmptyState message="모든 학원의 프로모션 상태가 확인되었습니다." />
            ) : (
              <>
                <p className="text-xs text-gray-500">
                  학원은 등록되어 있지만 프로모션 정보가 입력되지 않았습니다.
                  견적 봇은 이 학원의 견적에 &ldquo;프로모션 미확인&rdquo; 경고를 표시합니다.
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

        {tab === 'short_term' && (
          <div className="space-y-3">
            {shortTermIssues.length === 0 ? (
              <EmptyState message="단기 비율이 모두 확인되었거나 미확인 표시되어 있습니다." />
            ) : (
              <>
                <p className="text-xs text-gray-500">
                  단기(4주 미만) 등록을 허용하고 코스가 있는데, 단기 비율(1·2·3주)이 입력되지 않았고
                  &ldquo;미확인&rdquo; 표시도 없는 학원입니다. 이대로면 견적이 조용히 정비례(주수÷4)로 계산됩니다.
                  자료의 단기 비율을 입력하거나, 자료가 없으면 학원 편집에서 단기 데이터 상태를 &ldquo;미확인&rdquo;으로 두세요.
                </p>
                {shortTermIssues.map(s => (
                  <div key={s.id} className="card p-4 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 truncate">{s.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {s.region} · 코스 {(s.courses ?? []).length}개
                        {(s as { shortTermDataStatus?: string }).shortTermDataStatus === 'confirmed'
                          ? ' · ⚠️ 확인됨 표시인데 비율 데이터 없음'
                          : ' · 단기 비율·상태 미입력'}
                      </div>
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

        {/* ── 유학원 할인 평시 구멍 점검 (1년 3구간 분해) ── */}
        <div className="mt-6 space-y-4">
          <h2 className="text-sm font-bold text-gray-800 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500" /> 유학원 할인 평시 구멍 점검
          </h2>
          <p className="text-xs text-gray-500">
            유학원 할인이 비수기 프로모션에만 들어 있어, 비수기·성수기가 아닌 <b>평시 기간에 시작하면 유학원 할인이 빠지는</b> 학원입니다.
            상시(연중) 프로모션에 유학원 할인을 켜면 평시·성수기까지 적용됩니다.
          </p>
          {seasonGapSchools.length === 0 ? (
            <div className="card p-4 text-sm text-gray-400">평시 구멍이 있는 학원이 없습니다.</div>
          ) : (
            seasonGapSchools.map(g => (
              <div key={g.school.id} className="card p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium text-gray-900">{g.school.name}</div>
                  <div className="text-xs text-amber-600 font-medium">평시 구멍 {g.gapDays}일</div>
                </div>
                <div className="text-xs text-gray-500 mb-3">비수기 유학원 할인: {g.agencyDesc} · 상시 프로모션: 없음 (평시 할인 넣으려면 연중 프로모션 추가 필요)</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" style={{ minWidth: '440px' }}>
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-100">
                        <th className="text-left py-1 font-medium">기간</th>
                        <th className="text-left py-1 font-medium">구분</th>
                        <th className="text-right py-1 font-medium">일수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.runs.map((r, i) => (
                        <tr key={i} className={r.cls === '평시' ? 'bg-amber-50' : ''}>
                          <td className="py-1">{r.start} ~ {r.end}</td>
                          <td className="py-1">{r.cls}{r.cls === '평시' && <span className="text-amber-600 font-medium"> ← 할인 빠짐</span>}</td>
                          <td className="py-1 text-right">{r.days}일</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── 새 구조 점검: 비자연장 · 코스 target · 패키지 programType ── */}
        <div className="mt-6 space-y-4">
          <h2 className="text-sm font-bold text-gray-800 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500" /> 계산 구조 점검
          </h2>

          {/* 비자연장 이상 (계산 부정확) */}
          <div className="card p-4">
            <div className="font-semibold text-gray-900 mb-1">비자연장 설정 {visaIssues.length > 0 ? `· ${visaIssues.length}개 학원 확인 필요` : '· 정상'}</div>
            {visaIssues.length === 0 ? (
              <p className="text-xs text-gray-400">비자연장 항목이 누적/개별(visaMode)과 차수(triggerWeeks) 모두 설정됨.</p>
            ) : (
              <>
                <p className="text-xs text-gray-500 mb-2">
                  비자연장이 2개 이상인데 누적/개별 구분(visaMode)이 없거나 차수 주차(triggerWeeks)가 누락·중복이면
                  비자비가 부정확하게 계산됩니다(전부 합산 등).
                </p>
                {visaIssues.map(v => (
                  <div key={v.school.id} className="flex items-center justify-between py-1.5 border-t border-gray-50 text-sm">
                    <span className="text-gray-700">{v.school.name} <span className="text-xs text-gray-400">(비자 {v.count}개)</span></span>
                    <span className="text-xs text-amber-600">
                      {v.noMode && '누적/개별 미설정'}{v.noMode && v.badTw && ' · '}{v.badTw && '차수 누락/중복'}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* 코스 target 누락 (모드 분류) */}
          <div className="card p-4">
            <div className="font-semibold text-gray-900 mb-1">코스 모드 분류(target) {targetIssues.length > 0 ? `· ${targetIssues.length}개 학원` : '· 정상'}</div>
            {targetIssues.length === 0 ? (
              <p className="text-xs text-gray-400">모든 코스에 target(성인일반/가족연수/주니어/시니어)이 설정됨.</p>
            ) : (
              <>
                <p className="text-xs text-gray-500 mb-2">
                  코스 target이 없으면 일반/가족/주니어 탭 분류가 부정확합니다. 데이터 수정에서 각 코스의 target을 지정하세요.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {targetIssues.slice(0, 30).map(t => (
                    <span key={t.school.id} className="text-xs bg-gray-100 rounded px-2 py-0.5 text-gray-600">
                      {t.school.name} ({t.missing}/{t.total})
                    </span>
                  ))}
                  {targetIssues.length > 30 && <span className="text-xs text-gray-400">외 {targetIssues.length - 30}개</span>}
                </div>
              </>
            )}
          </div>

          {/* 패키지 programType 누락 */}
          {programTypeIssues.length > 0 && (
            <div className="card p-4">
              <div className="font-semibold text-gray-900 mb-1">패키지 programType · {programTypeIssues.length}개 학원</div>
              <p className="text-xs text-gray-500 mb-2">
                패키지 programType(family/junior/camp 등)이 없으면 모드 분류가 부정확합니다.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {programTypeIssues.slice(0, 30).map(t => (
                  <span key={t.school.id} className="text-xs bg-gray-100 rounded px-2 py-0.5 text-gray-600">
                    {t.school.name} ({t.missing}/{t.total})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
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
