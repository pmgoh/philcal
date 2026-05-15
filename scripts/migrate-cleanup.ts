/**
 * 데이터 정리 스크립트 (한 번만 실행)
 *
 * 사용법:
 *   npm run migrate:cleanup            # dry-run (분석만)
 *   npm run migrate:cleanup -- --apply # 실제 적용
 *
 * 동작:
 *   1. Firestore promotions 컬렉션 분석
 *      - v3 ID (schoolCode 시작이 BANANA_KIDS, CIJ_JUNIOR 등) vs 구버전 ID 구분
 *      - v3가 아닌 프로모션 = 구버전 → 삭제 대상
 *   2. Firestore schools 컬렉션에 schoolCode 필드 추가
 *      - schools_master.json의 (name + campus + region)으로 매칭
 *      - 매칭된 학원에 schoolCode와 campus 필드 부여
 *   3. --apply 시 실제 변경
 */

import * as fs from 'fs'
import * as path from 'path'

interface MasterSchool {
  code: string
  name: string
  campus: string
  region: string
  _note?: string
}

interface FirestorePromo {
  id: string
  schoolCode?: string
  schoolName?: string
  promoName?: string
  active?: boolean
}

interface FirestoreSchool {
  id: string
  name: string
  region: string
  schoolCode?: string
  campus?: string
}

// 환경변수 로드
function loadEnv() {
  const dotenvPath = path.join(process.cwd(), '.env.local')
  if (fs.existsSync(dotenvPath)) {
    const content = fs.readFileSync(dotenvPath, 'utf-8')
    content.split('\n').forEach((line) => {
      const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/)
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
      }
    })
  }
}

// 학원명 정규화 (matching용)
function normalizeName(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[()[\]【】「」]/g, ' ')
    .replace(/[\s_\-./]+/g, ' ')
    .trim()
}

// schools_master.json의 학원 → Firestore schools 매칭
function matchSchool(master: MasterSchool, schools: FirestoreSchool[]): FirestoreSchool | null {
  const masterName = normalizeName(master.name)
  const masterCampus = master.campus !== '본원' ? normalizeName(master.campus) : ''

  // 1순위: 정확한 name + region 일치 (캠퍼스 무시)
  // 캠퍼스가 본원이면 단순히 name만으로
  if (!masterCampus) {
    const byName = schools.find(s => normalizeName(s.name) === masterName && s.region === master.region)
    if (byName) return byName
  }

  // 2순위: name에 campus 포함된 경우 ("CG Banilad 캠퍼스" 등)
  if (masterCampus) {
    const byNameAndCampus = schools.find(s => {
      const sName = normalizeName(s.name)
      return sName.includes(masterName) && sName.includes(masterCampus) && s.region === master.region
    })
    if (byNameAndCampus) return byNameAndCampus
  }

  // 3순위: name이 master.name + master.campus 합쳐진 경우 ("CG Banilad")
  if (masterCampus) {
    const combined = `${masterName} ${masterCampus}`.trim()
    const byCombined = schools.find(s => {
      const sName = normalizeName(s.name)
      return (sName === combined || sName.includes(combined)) && s.region === master.region
    })
    if (byCombined) return byCombined
  }

  // 4순위: name만 일치 (region 무시)
  const byNameOnly = schools.find(s => normalizeName(s.name) === masterName)
  if (byNameOnly) return byNameOnly

  // 5순위: name 부분 포함
  const byPartial = schools.find(s => {
    const sName = normalizeName(s.name)
    return (sName.includes(masterName) || masterName.includes(sName)) && s.region === master.region
  })
  return byPartial ?? null
}

async function main() {
  const apply = process.argv.includes('--apply')

  loadEnv()

  const { initializeApp } = await import('firebase/app')
  const { getFirestore, collection, getDocs, writeBatch, doc, deleteDoc } = await import('firebase/firestore')

  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  }
  const app = initializeApp(firebaseConfig)
  const db = getFirestore(app)

  // ── 1. 데이터 로드 ──────────────────────────────────────────────────────
  console.log('=== 데이터 로드 ===')

  // schools_master.json 로드
  const smPath = path.join(process.cwd(), 'data/schools_master.json')
  const smRaw = JSON.parse(fs.readFileSync(smPath, 'utf-8'))
  const masterSchools: MasterSchool[] = smRaw.schools ?? smRaw
  console.log(`schools_master.json: ${masterSchools.length}개 학원`)

  // promotions_v3.json 로드 (v3 ID 목록 추출용)
  const v3Path = path.join(process.cwd(), 'data/promotions_v3.json')
  const v3Raw = JSON.parse(fs.readFileSync(v3Path, 'utf-8'))
  const v3Ids = new Set<string>((v3Raw.promotions ?? []).map((p: { id: string }) => p.id))
  console.log(`v3 프로모션 ID: ${v3Ids.size}개`)

  // Firestore 현재 상태
  console.log('\nFirestore 데이터 조회 중...')
  const promosSnap = await getDocs(collection(db, 'promotions'))
  const promos: FirestorePromo[] = promosSnap.docs.map((d) => ({ id: d.id, ...d.data() } as FirestorePromo))
  console.log(`현재 promotions: ${promos.length}건`)

  const schoolsSnap = await getDocs(collection(db, 'schools'))
  const schools: FirestoreSchool[] = schoolsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as FirestoreSchool))
  console.log(`현재 schools: ${schools.length}개`)
  console.log()

  // ── 2. 구버전 프로모션 식별 ────────────────────────────────────────────
  console.log('=== 구버전 프로모션 식별 ===')
  const oldPromos = promos.filter((p) => !v3Ids.has(p.id))
  const v3Promos = promos.filter((p) => v3Ids.has(p.id))
  console.log(`v3 프로모션: ${v3Promos.length}건`)
  console.log(`구버전 프로모션 (삭제 대상): ${oldPromos.length}건`)
  if (oldPromos.length > 0 && oldPromos.length <= 30) {
    console.log('\n삭제 대상 목록:')
    oldPromos.forEach((p) => {
      console.log(`  [${p.id}] ${p.schoolName ?? '?'} - ${p.promoName ?? '?'}`)
    })
  } else if (oldPromos.length > 30) {
    console.log(`(처음 10개만 표시)`)
    oldPromos.slice(0, 10).forEach((p) => {
      console.log(`  [${p.id}] ${p.schoolName ?? '?'} - ${p.promoName ?? '?'}`)
    })
  }
  console.log()

  // ── 3. schools 매칭 ────────────────────────────────────────────────────
  console.log('=== schools에 schoolCode 부여 매칭 ===')
  const matched: Array<{ master: MasterSchool; school: FirestoreSchool }> = []
  const unmatched: MasterSchool[] = []

  for (const master of masterSchools) {
    if (master._note === '자료에 프로모션 없음') {
      // 프로모션 없는 학원도 schoolCode는 부여 (다른 작업에 도움)
    }
    const school = matchSchool(master, schools)
    if (school) {
      matched.push({ master, school })
    } else {
      unmatched.push(master)
    }
  }

  console.log(`매칭 성공: ${matched.length} / ${masterSchools.length}`)
  console.log(`매칭 실패 (Firestore에 없는 학원): ${unmatched.length}`)
  if (unmatched.length > 0) {
    console.log('\n매칭 실패 학원 (수동 등록 필요):')
    unmatched.forEach((m) => {
      console.log(`  ${m.code} - ${m.name} (${m.campus}, ${m.region})`)
    })
  }

  // 중복 매칭 검사 (정보용 표시만, 자동 적용은 모두 진행)
  // 현재 구조에서는 같은 학원의 시즌별 row가 여러 개일 수 있으므로 같은 code 공유 허용
  const reverseMap = new Map<string, MasterSchool[]>()
  for (const { master, school } of matched) {
    const list = reverseMap.get(school.id) ?? []
    list.push(master)
    reverseMap.set(school.id, list)
  }
  const conflicts = Array.from(reverseMap.entries()).filter(([, masters]) => masters.length > 1)
  if (conflicts.length > 0) {
    console.log('\n⚠️ 동일 학원에 여러 master 매칭됨 (시즌별 분리 학원으로 추정):')
    conflicts.forEach(([schoolId, masters]) => {
      const school = schools.find((s) => s.id === schoolId)
      console.log(`  Firestore "${school?.name}" ← 첫 번째 master(${masters[0].code}) 적용`)
      masters.forEach((m, idx) => console.log(`    ${idx === 0 ? '✓' : ' '} ${m.code} (${m.campus})`))
    })
  }

  // 이미 schoolCode 있는 학원
  const alreadyHasCode = matched.filter(({ school }) => school.schoolCode)
  console.log(`\n이미 schoolCode 부여된 학원: ${alreadyHasCode.length} (덮어쓰지 않음)`)
  console.log()

  // ── 4. apply 모드 ─────────────────────────────────────────────────────
  if (!apply) {
    console.log('💡 실제 적용: npm run migrate:cleanup -- --apply')
    return
  }

  console.log('=== 실제 적용 시작 ===\n')

  // 4-1. 구버전 프로모션 삭제 (백업 먼저)
  if (oldPromos.length > 0) {
    const backupPath = path.join(process.cwd(), `data/backup-old-promos-${Date.now()}.json`)
    fs.writeFileSync(
      backupPath,
      JSON.stringify({ timestamp: new Date().toISOString(), data: oldPromos }, null, 2),
      'utf-8',
    )
    console.log(`구버전 백업: ${backupPath} (${oldPromos.length}건)`)

    console.log('구버전 프로모션 삭제 중...')
    for (let i = 0; i < oldPromos.length; i += 400) {
      const slice = oldPromos.slice(i, i + 400)
      const batch = writeBatch(db)
      for (const p of slice) {
        batch.delete(doc(db, 'promotions', p.id))
      }
      await batch.commit()
      console.log(`  ${Math.min(i + 400, oldPromos.length)}/${oldPromos.length} 삭제`)
    }
    console.log(`✅ 구버전 프로모션 ${oldPromos.length}건 삭제 완료\n`)
  } else {
    console.log('삭제할 구버전 프로모션 없음\n')
  }

  // 4-2. schools에 schoolCode 부여
  console.log('schools에 schoolCode 부여 중...')
  let updated = 0
  const skipExisting = matched.filter(({ school }) => school.schoolCode)
  // 같은 schoolId에 여러 master 매칭된 경우 첫 번째만 (중복 적용 시 마지막 값으로 덮어쓰기 방지)
  const seenSchoolIds = new Set<string>()
  const toUpdate: typeof matched = []
  for (const m of matched) {
    if (m.school.schoolCode) continue
    if (seenSchoolIds.has(m.school.id)) continue
    seenSchoolIds.add(m.school.id)
    toUpdate.push(m)
  }

  for (let i = 0; i < toUpdate.length; i += 400) {
    const slice = toUpdate.slice(i, i + 400)
    const batch = writeBatch(db)
    for (const { master, school } of slice) {
      const update: { schoolCode: string; campus?: string } = {
        schoolCode: master.code,
      }
      if (master.campus && master.campus !== '본원' && !school.campus) {
        update.campus = master.campus
      }
      batch.update(doc(db, 'schools', school.id), update)
      updated++
    }
    await batch.commit()
    console.log(`  ${updated}/${toUpdate.length}`)
  }
  console.log(`✅ ${updated}개 학원에 schoolCode 부여 완료`)
  if (skipExisting.length > 0) {
    console.log(`   (${skipExisting.length}개는 이미 schoolCode 있어 건너뜀)`)
  }
  console.log()

  console.log('=== 완료 ===')
  console.log('이제 v3 프로모션이 schoolCode로 학원과 자동 연결됩니다.')
  console.log('웹사이트 새로고침 후 /admin/promotions, /admin/data-health 확인하세요.')
}

main().catch((err) => {
  console.error('스크립트 실행 실패:', err)
  process.exit(1)
})
