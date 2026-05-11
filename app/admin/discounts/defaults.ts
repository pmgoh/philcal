// 프로모션 표에서 추출한 학원별 기본 유학원 할인 (평시 기본값)
// 프로모션 없을 때 적용되는 fallback

import type { AgencyDiscount } from '@/types'

export const AGENCY_DISCOUNT_DEFAULTS: Record<string, AgencyDiscount | null> = {
  // ── CALA 10% (학비+기숙사의 10%) ──────────────────────────────────────────
  'CIA':               { type: 'percent', value: 10, applyTo: 'all', note: 'CALA 할인' },
  'CPILS':             { type: 'percent', value: 10, applyTo: 'all', note: 'CALA 학비+기숙사 10%' },
  'CELLA PREMIUM':     { type: 'percent', value: 10, applyTo: 'all', note: 'CALA 10%' },
  'CELLA UNI':         { type: 'percent', value: 10, applyTo: 'all', note: 'CALA 10%' },
  'CG BANILAD':        { type: 'percent', value: 10, applyTo: 'all', note: '(학비+기숙사-장기할인-CG할인)의 10%' },
  'CG SPARTA':         { type: 'percent', value: 10, applyTo: 'all', note: '(학비+기숙사-장기할인-CG할인)의 10%' },
  'EV':                { type: 'percent', value: 10, applyTo: 'all', note: 'CALA 할인' },
  'I.BREEZE':          { type: 'percent', value: 10, applyTo: 'all', note: 'CALA (학비+기숙사)의 10%' },
  'IMS Banilad':       { type: 'percent', value: 10, applyTo: 'all', note: '(학비+기숙사-학원할인)의 10%' },
  'SMEAG Capital':     { type: 'percent', value: 10, applyTo: 'course_only', note: '수업료+기숙사 10% (외부기숙사는 학비만)' },
  'English Fella':     { type: 'percent', value: 10, applyTo: 'all', note: '수업료+기숙사비의 10%' },
  'Glant':             { type: 'percent', value: 10, applyTo: 'all', note: '기숙사+학비 10% (성수기)' },
  'WE Academy':        { type: 'percent', value: 10, applyTo: 'all', note: '(학비+기숙사-학원프로모션)의 10%' },
  'BoracayCOCO':       { type: 'percent', value: 10, applyTo: 'all', note: '(학비+기숙사-프로모션)의 10%' },
  'CIEC':              { type: 'percent', value: 10, applyTo: 'all', note: '학비+기숙사 10% (보호자 제외)' },
  'CIJ':               { type: 'percent', value: 10, applyTo: 'all', note: '(학비+기숙사-학원할인)의 10%' },
  'CPI':               { type: 'percent', value: 10, applyTo: 'all', note: '(학비+기숙사-학원할인)의 10%' },
  'PHILINTER':         { type: 'percent', value: 10, applyTo: 'all', note: 'CALA 학비+기숙사 10%' },
  'EG':                { type: 'percent', value: 10, applyTo: 'all', note: '비수기 최대15% / 성수기 최대10%' },

  // ── 4주당 10만원 고정 ────────────────────────────────────────────────────────
  'BANANA KIDS':       { type: 'amount_per_week', value: 25000, applyTo: 'all', note: '1인 4주당 10만원' },
  'ELSA':              { type: 'amount_per_week', value: 25000, applyTo: 'all', note: '4주당 1인당 10만원' },
  'JOYFUL':            { type: 'amount_per_week', value: 25000, applyTo: 'all', note: '성수기 4주당 인당 10만원' },
  'SMEAG Encanto':     { type: 'amount_per_week', value: 25000, applyTo: 'all', note: '성수기 4주당 10만원 (3주=75,000원)' },
  'SMEAG Tarlac':      { type: 'amount_per_week', value: 25000, applyTo: 'all', note: '성수기 1인 4주당 10만원' },
  'GLC':               { type: 'amount_per_week', value: 25000, applyTo: 'all', note: '4주당 10만원' },
  'JJES':              { type: 'amount_per_week', value: 25000, applyTo: 'all', note: '1인당 10만원' },
  'BELA':              { type: 'amount_per_week', value: 25000, applyTo: 'all', note: '성수기가족 4주당 10만원' },
  'CIA CAMP':          { type: 'amount_per_week', value: 25000, applyTo: 'all', note: '성수기가족 3~4주인당10만/5~6주15만/7~8주20만' },

  // ── 등록비만 할인 ────────────────────────────────────────────────────────────
  'Bcebu':             { type: 'reg_fee_only', value: 0, regFeeDiscount: 100000, applyTo: 'all', note: '등록금 10만원 할인' },
  'BLUE OCEAN':        { type: 'reg_fee_only', value: 0, regFeeDiscount: 100000, applyTo: 'all', note: '등록비 할인' },
  'PINES MAIN':        { type: 'reg_fee_only', value: 0, regFeeDiscount: 100000, applyTo: 'all', note: '등록비 할인 가능' },
  'PINES CHAPIS':      { type: 'reg_fee_only', value: 0, regFeeDiscount: 100000, applyTo: 'all', note: '등록비 할인 가능' },
  'BAGUIO JIC':        { type: 'reg_fee_only', value: 0, regFeeDiscount: 100000, applyTo: 'all', note: '등록비 할인만 가능' },
  'BAGUIO JIC GVP':    { type: 'reg_fee_only', value: 0, regFeeDiscount: 100000, applyTo: 'all', note: '등록비 할인만 가능' },
  'WALES':             { type: 'reg_fee_only', value: 0, regFeeDiscount: 100000, applyTo: 'all', note: '등록비 할인 가능' },
  'CNS':               { type: 'reg_fee_only', value: 0, regFeeDiscount: 100000, applyTo: 'all', note: '등록비 10만원' },
  'MONOL':             { type: 'reg_fee_only', value: 0, regFeeDiscount: 100000, applyTo: 'all', note: '등록비 10만원' },
  'BECI CITY':         { type: 'reg_fee_only', value: 0, regFeeDiscount: 100000, applyTo: 'all', note: '등록비 할인 가능' },
  'BECI THE CAFE':     { type: 'reg_fee_only', value: 0, regFeeDiscount: 100000, applyTo: 'all', note: '등록비 할인 가능' },
  'BECI Sparta':       { type: 'reg_fee_only', value: 0, regFeeDiscount: 100000, applyTo: 'all', note: '등록비 할인 가능' },
  'e-EDU':             { type: 'reg_fee_only', value: 0, regFeeDiscount: 100000, applyTo: 'all', note: '등록비 할인 가능' },
  'e-EDU Eco':         { type: 'reg_fee_only', value: 0, regFeeDiscount: 100000, applyTo: 'all', note: '등록비 할인 가능' },
  'HELP Clark':        { type: 'reg_fee_only', value: 0, regFeeDiscount: 100000, applyTo: 'all', note: '등록비 10만원' },
  'HELP BAGUIO':       { type: 'reg_fee_only', value: 0, regFeeDiscount: 100000, applyTo: 'all', note: '등록비 할인 가능' },
  'PILAedu':           { type: 'reg_fee_only', value: 0, regFeeDiscount: 130000, applyTo: 'all', note: '등록비 13만원 할인' },
  'BESTA':             { type: 'reg_fee_only', value: 0, regFeeDiscount: 100000, applyTo: 'all', note: '등록비 할인 (4주 이상만)' },

  // ── 유학원 할인 없음 ─────────────────────────────────────────────────────────
  'PJ Academy':        null,
  'PJ피자어학원':       null,
  'EV LaMer':          null,
  'Jungle':            null,
  'HANA':              null,
  'MK Iloilo':         null,
  'BaekAkGwan':        null,
  'CIJ JUNIOR':        null,
  'IZAM CITY':         null,
  'IZAM MACTAN':       null,
  'SK119':             null,
  'GS':                null,
  'JOYFUL (비수기)':   null,
  'EDU TALK':          null,
}

/** 학원명으로 기본 할인 규칙 찾기 (부분 일치) */
export function getDefaultDiscount(schoolName: string): AgencyDiscount | null | undefined {
  // 정확한 매칭 우선
  if (schoolName in AGENCY_DISCOUNT_DEFAULTS) return AGENCY_DISCOUNT_DEFAULTS[schoolName]
  // 부분 매칭
  const lower = schoolName.toLowerCase()
  for (const [key, val] of Object.entries(AGENCY_DISCOUNT_DEFAULTS)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower.split(' ')[0].toLowerCase())) {
      return val
    }
  }
  return undefined  // 매칭 없음
}
