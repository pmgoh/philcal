'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { useState } from 'react'

export default function withAuth<P extends object>(Component: React.ComponentType<P>) {
  return function AuthenticatedComponent(props: P) {
    const router = useRouter()
    const [checking, setChecking] = useState(true)
    const [authed, setAuthed] = useState(false)

    useEffect(() => {
      const unsub = onAuthStateChanged(auth, (user) => {
        if (user) {
          setAuthed(true)
        } else {
          router.replace('/login')
        }
        setChecking(false)
      })
      return unsub
    }, [router])

    if (checking) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      )
    }

    if (!authed) return null

    return <Component {...props} />
  }
}
