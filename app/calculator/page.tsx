'use client'
// 어드민 웹 안의 계산기 (사이드바 포함). 본체는 CalculatorBody 공유.
import AdminLayout from '@/components/AdminLayout'
import CalculatorBody from '@/components/CalculatorBody'

export default function CalculatorPage() {
  return (
    <AdminLayout>
      <CalculatorBody />
    </AdminLayout>
  )
}
