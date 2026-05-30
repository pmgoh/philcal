import type { School } from '@/types'

// 데이터의 실제 필드명을 calcEngine 표준으로 읽어주는 어댑터.
// 데이터(JSON 76개)는 안 건드리고, 읽는 쪽(코드)에서 흡수한다.

type Raw = Record<string, unknown>

// 1) 서차지: amountPerWeek/amount/name/periods → pricePerWeek/label/startDate/endDate
function normSurcharges(list: unknown): unknown[] {
  if (!Array.isArray(list)) return []
  const out: Raw[] = []
  for (const raw of list as Raw[]) {
    const label = (raw.label ?? raw.name ?? '성수기 추가비') as string
    const currency = (raw.currency ?? 'KRW')
    const discountAllowed = raw.discountAllowed === undefined ? true : Boolean(raw.discountAllowed)
    const pricePerWeek = (raw.pricePerWeek ?? raw.amountPerWeek ?? raw.amount ?? 0) as number
    const periods = raw.periods as Array<{ startDate?: string; endDate?: string }> | undefined
    if (Array.isArray(periods) && periods.length > 0) {
      for (const p of periods) {
        if (p.startDate && p.endDate) {
          out.push({ ...raw, label, startDate: p.startDate, endDate: p.endDate, pricePerWeek, currency, discountAllowed })
        }
      }
      continue
    }
    out.push({ ...raw, label, startDate: raw.startDate, endDate: raw.endDate, pricePerWeek, currency, discountAllowed })
  }
  return out
}

// 2) 단기요율: 여러 형식을 → {mode:'percent',week1,week2,week3}(% 정수)로 통일
//   - {1week,2weeks,3weeks}        (% 정수)
//   - {week1:0.4,...}              (소수 비율)
//   - {코스ID:{1w,2w,3w}} 금액맵   (코스마다 4주가 대비 동일 %로 환산됨 → 단일 비율로)
function normShortRates(r: unknown, priceMap?: Record<string, number>): unknown {
  if (!r || typeof r !== 'object') return r
  const o = r as Raw
  if (o.mode === 'percent' && o.week1 !== undefined) return o

  const pickPct = (v: unknown): number | undefined => {
    if (typeof v !== 'number') return undefined
    return v < 1 ? Math.round(v * 100) : v
  }

  // 평탄 형식: {1week/week1, ...}
  const w1 = pickPct(o['1week'] ?? o.week1)
  const w2 = pickPct(o['2weeks'] ?? o.week2)
  const w3 = pickPct(o['3weeks'] ?? o.week3)
  if (w1 !== undefined || w2 !== undefined || w3 !== undefined) {
    return { mode: 'percent', week1: w1 ?? 25, week2: w2 ?? 50, week3: w3 ?? 75, week4Included: false }
  }

  // 금액맵 형식: {코스ID:{1w,2w,3w}} → 첫 항목 금액 ÷ 4주가로 % 환산
  if (priceMap) {
    const firstKey = Object.keys(o).find(k => {
      const v = o[k]
      return v && typeof v === 'object' && ('1w' in (v as Raw) || '2w' in (v as Raw) || '3w' in (v as Raw))
    })
    if (firstKey) {
      const m = o[firstKey] as Raw
      const p4w = priceMap[firstKey]
      if (p4w && p4w > 0) {
        const toPct = (amt: unknown) => (typeof amt === 'number' ? Math.round(amt / p4w * 100) : undefined)
        return {
          mode: 'percent',
          week1: toPct(m['1w']) ?? 25,
          week2: toPct(m['2w']) ?? 50,
          week3: toPct(m['3w']) ?? 75,
          week4Included: false,
        }
      }
    }
  }

  return o
}

// 3) 패키지: {columns,rows} 객체형 → [{weeks,prices:[{label,amount}]}] 배열형 + name→label
function isWeekCol(c: string): number | null {
  const m = String(c).match(/(\d+)\s*(?:w|W|주)/)
  return m ? parseInt(m[1], 10) : null
}
function normPackages(list: unknown): unknown[] {
  if (!Array.isArray(list)) return []
  return (list as Raw[]).map(p => {
    const label = (p.label ?? p.name ?? '패키지') as string
    const pm = p.priceMatrix
    if (Array.isArray(pm)) return { ...p, label, columns: (p.columns ?? []) }
    if (pm && typeof pm === 'object') {
      const obj = pm as { columns?: string[]; rows?: Array<{ label?: string; prices?: number[] }> }
      const cols = obj.columns ?? []
      const rows = obj.rows ?? []
      const colsAreWeeks = cols.length > 0 && cols.every(c => isWeekCol(c) !== null)
      if (colsAreWeeks) {
        const stdColumns = rows.map(r => r.label ?? '기본')
        const priceMatrix = cols.map((c, ci) => ({
          weeks: isWeekCol(c)!,
          prices: rows.map(r => ({ label: r.label ?? '기본', amount: (r.prices ?? [])[ci] ?? 0 })),
        }))
        return { ...p, label, columns: stdColumns, priceMatrix }
      } else {
        const stdColumns = cols
        const nameWeeks = isWeekCol(label) ?? isWeekCol((p.note as string) ?? "")
        const priceMatrix = rows.map((r) => ({
          weeks: isWeekCol(r.label ?? "") ?? nameWeeks ?? 4,
          prices: cols.map((c, ci) => ({ label: c, amount: (r.prices ?? [])[ci] ?? 0 })),
        }))
        return { ...p, label, columns: stdColumns, priceMatrix }
      }
    }
    return { ...p, label, columns: (p.columns ?? []), priceMatrix: [] }
  })
}

export function normalizeSchool(school: School): School {
  const raw = school as unknown as Raw
  // 코스ID/기숙사ID → 4주가 맵 (금액형 단기요율 % 환산용)
  const coursePrice: Record<string, number> = {}
  for (const c of ((raw.courses as Array<Raw>) ?? [])) {
    if (c && c.id) coursePrice[c.id as string] = (c.price4Weeks as number) ?? 0
  }
  const dormPrice: Record<string, number> = {}
  for (const d of ((raw.dormitories as Array<Raw>) ?? [])) {
    if (d && d.id) dormPrice[d.id as string] = (d.price4Weeks as number) ?? 0
  }
  return {
    ...school,
    surcharges: normSurcharges(raw.surcharges) as School['surcharges'],
    courseShortTermRates: normShortRates(raw.courseShortTermRates, coursePrice) as School['courseShortTermRates'],
    dormShortTermRates: normShortRates(raw.dormShortTermRates, dormPrice) as School['dormShortTermRates'],
    packages: normPackages(raw.packages) as School['packages'],
  }
}
