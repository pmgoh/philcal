import type { Currency, ExchangeRate } from '@/types'

export function toKrw(amount: number, currency: Currency, rate: ExchangeRate): number {
  if (currency === 'KRW') return amount
  if (currency === 'PHP') return Math.round(amount * rate.phpToKrw)
  if (currency === 'USD') return Math.round(amount * rate.usdToKrw)
  return amount
}

export function formatKrw(amount: number): string {
  return new Intl.NumberFormat('ko-KR').format(amount) + '원'
}

export function formatCurrency(amount: number, currency: Currency): string {
  if (currency === 'KRW') return new Intl.NumberFormat('ko-KR').format(amount) + '원'
  if (currency === 'PHP') return '₱' + new Intl.NumberFormat('ko-KR').format(amount)
  if (currency === 'USD') return '$' + new Intl.NumberFormat('en-US').format(amount)
  return String(amount)
}

export function isInPeriod(dateStr: string, startDate: string, endDate: string): boolean {
  const d = new Date(dateStr)
  const s = new Date(startDate)
  const e = new Date(endDate)
  return d >= s && d <= e
}
