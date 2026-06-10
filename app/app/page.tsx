'use client'
// 계산기/챗봇 전용 앱 모드 (사이드바 없음, 상단 최소 메뉴). 본체는 CalculatorBody 공유.
import AppLayout from '@/components/AppLayout'
import CalculatorBody from '@/components/CalculatorBody'

export default function AppModePage() {
  return (
    <AppLayout>
      <CalculatorBody />
    </AppLayout>
  )
}
