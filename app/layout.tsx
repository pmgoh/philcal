import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '엠버시 견적 시스템',
  description: '필리핀 어학연수 학비 견적',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  )
}
