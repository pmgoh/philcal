'use client'
import { useState, useEffect } from 'react'
import { Link2, AlertCircle, X, Check } from 'lucide-react'
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { findSimilarSchoolNames, normalizeSchoolName, buildAliasIndex, type AliasMap } from '@/lib/schoolMatching'
import schoolAliases from '@/data/school-aliases.json'
import type { PromoEntry } from '@/lib/db'

interface Props {
  // 입력 중인 학원
  schoolName: string
  schoolId?: string  // 이미 저장된 학원이면 id가 있음 (수정 모드)
}

interface OrphanGroup {
  schoolName: string  // promoEntry의 schoolName
  score: number       // 유사도
  promos: PromoEntry[]
}

/**
 * 학원명을 입력하면 미연결 프로모션(schoolId 없음 + 이름 비슷한 것) 후보를 보여주고,
 * 사용자가 "이 학원이 맞다"고 확인하면 해당 promo들의 schoolId를 현재 학원으로 업데이트.
 *
 * 사용 위치: SchoolForm 학원명 입력란 아래
 */
export default function PromoMatcher({ schoolName, schoolId }: Props) {
  const [orphans, setOrphans] = useState<PromoEntry[]>([])
  const [groups, setGroups] = useState<OrphanGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [linking, setLinking] = useState<string | null>(null)
  const [linkedGroups, setLinkedGroups] = useState<Set<string>>(new Set())

  // 미연결 프로모션 1회 로드
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getDocs(collection(db, 'promotions')).then(snap => {
      if (cancelled) return
      const all = snap.docs.map(d => d.data() as PromoEntry)
      const orphansList = all.filter(p => !p.schoolId && p.schoolName)
      setOrphans(orphansList)
      setLoading(false)
    }).catch(() => setLoading(false))
    return () => { cancelled = true }
  }, [])

  // 학원명이 바뀔 때마다 후보 재계산
  useEffect(() => {
    if (!schoolName || orphans.length === 0) {
      setGroups([])
      return
    }

    // 별칭 사전이 schoolName이 가리키는 canonical과 일치하는지도 확인
    const aliasIdx = buildAliasIndex(schoolAliases as unknown as AliasMap)
    const inputKey = normalizeSchoolName(schoolName)

    // promo schoolName별로 그룹화
    const byPromoName: Record<string, PromoEntry[]> = {}
    for (const p of orphans) {
      if (!byPromoName[p.schoolName]) byPromoName[p.schoolName] = []
      byPromoName[p.schoolName].push(p)
    }

    // 각 그룹에 유사도 점수 부여
    const uniqueNames = Object.keys(byPromoName)
    const similar = findSimilarSchoolNames(schoolName, uniqueNames, 10)

    // 별칭 사전상 정확히 같은 canonical로 묶이는 것도 100점 처리
    for (const pName of uniqueNames) {
      const pKey = normalizeSchoolName(pName)
      const cIn = aliasIdx.get(inputKey)
      const cP = aliasIdx.get(pKey)
      if (cIn && cP && cIn === cP) {
        const existing = similar.find(x => x.name === pName)
        if (existing) existing.score = Math.max(existing.score, 95)
        else similar.push({ name: pName, score: 95 })
      }
    }

    const result: OrphanGroup[] = similar
      .map(s => ({ schoolName: s.name, score: s.score, promos: byPromoName[s.name] }))
      .filter(g => g.score >= 50)  // 50점 미만은 노이즈
      .sort((a, b) => b.score - a.score)

    setGroups(result)
  }, [schoolName, orphans])

  // schoolId가 없으면(=신규 저장 전) 연결 불가
  const canLink = !!schoolId

  const handleLink = async (group: OrphanGroup) => {
    if (!schoolId) {
      alert('학원을 먼저 저장한 뒤 연결할 수 있습니다.')
      return
    }
    if (!confirm(`"${group.schoolName}" 프로모션 ${group.promos.length}개를 이 학원과 연결할까요?`)) return
    setLinking(group.schoolName)
    try {
      const batch = writeBatch(db)
      for (const p of group.promos) {
        batch.set(doc(db, 'promotions', p.id), { ...p, schoolId, updatedAt: new Date().toISOString() })
      }
      await batch.commit()
      setLinkedGroups(prev => new Set(prev).add(group.schoolName))
      // 연결된 promo 제거
      setOrphans(prev => prev.filter(p => !group.promos.some(gp => gp.id === p.id)))
    } catch (e) {
      console.error(e)
      alert('연결 중 오류가 발생했습니다.')
    } finally {
      setLinking(null)
    }
  }

  if (loading || groups.length === 0) return null

  return (
    <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
      <div className="flex items-start gap-2 mb-2">
        <Link2 size={14} className="text-blue-600 mt-0.5" />
        <div className="text-xs">
          <div className="font-semibold text-blue-900">미연결 프로모션 후보 발견</div>
          <div className="text-blue-700">
            아래 프로모션들이 이 학원과 매칭될 수 있습니다.
            {!canLink && <span className="text-amber-700"> 학원을 먼저 저장한 뒤 연결하세요.</span>}
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        {groups.map(g => {
          const linked = linkedGroups.has(g.schoolName)
          return (
            <div key={g.schoolName} className="flex items-center gap-2 bg-white rounded px-2.5 py-1.5 text-xs">
              <span className="font-mono text-gray-700">{g.schoolName}</span>
              <span className="text-gray-400">({g.promos.length}개{g.promos.filter(p => p.active).length < g.promos.length && `, 활성 ${g.promos.filter(p => p.active).length}`})</span>
              <span className={`ml-auto text-xs ${g.score >= 80 ? 'text-green-600' : g.score >= 60 ? 'text-yellow-600' : 'text-gray-400'}`}>유사도 {g.score}</span>
              {linked ? (
                <span className="text-green-600 flex items-center gap-1 font-medium"><Check size={12} /> 연결됨</span>
              ) : (
                <button
                  disabled={!canLink || linking === g.schoolName}
                  onClick={() => handleLink(g)}
                  className="px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-xs font-medium"
                >
                  {linking === g.schoolName ? '연결 중...' : '연결'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
