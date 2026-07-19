import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { renderHome } from '../../home/render'
import { getProfile } from '../../services/data'
import { useToast } from '../../person-detail/ui'

type PageContext = { session: Session; workspaceId: string }

/**
 * Home — cockpit relationnel quotidien.
 *
 * Le moteur de rendu (src/home/render.ts) est conservé tel quel : il est autonome
 * (données via getHomeDashboard, événements liés dans son container) et ce
 * wrapper ne fait que l'héberger dans le shell React : navigation via le
 * router, toasts via ToastProvider, et pont de délégation pour les liens
 * data-open-account / data-open-person générés par le markup du cockpit.
 */
export default function HomePage({ context }: { context: PageContext }) {
  const navigate = useNavigate()
  const toast = useToast()
  const containerRef = useRef<HTMLDivElement>(null)
  const navigateRef = useRef(navigate)
  const toastRef = useRef(toast)
  navigateRef.current = navigate
  toastRef.current = toast

  useEffect(() => {
    document.body.classList.add('home-cockpit-active')
    return () => document.body.classList.remove('home-cockpit-active')
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let cancelled = false
    const goView = (view: 'cerveau' | 'acc' | 'per' | 'connecteurs' | 'me') => {
      const paths = { cerveau: '/app/ask', acc: '/app/accounts', per: '/app/people', connecteurs: '/app/connectors', me: '/app/account' } as const
      navigateRef.current(paths[view])
    }
    void getProfile(context.session.user.id).then((profile) => {
      if (cancelled || !containerRef.current) return
      return renderHome({
        container,
        session: context.session,
        profile,
        organizationId: context.workspaceId,
        toast: (message, type) => toastRef.current(message, type === 'error' ? 'error' : 'ok'),
        goView,
        askSimulation: (prompt) => navigateRef.current('/app/ask', { state: { prefill: prompt } }),
      })
    }).catch((reason) => {
      if (!cancelled) toastRef.current(reason instanceof Error ? reason.message : 'Impossible de charger la vue Home.', 'error')
    })
    const onClick = (event: Event) => {
      const target = event.target as Element
      const account = target.closest<HTMLElement>('[data-open-account]')
      const person = target.closest<HTMLElement>('[data-open-person]')
      if (account?.dataset.openAccount) navigateRef.current(`/app/accounts/${account.dataset.openAccount}`)
      else if (person?.dataset.openPerson) navigateRef.current(`/app/people/${person.dataset.openPerson}`)
    }
    container.addEventListener('click', onClick)
    return () => {
      cancelled = true
      container.removeEventListener('click', onClick)
      container.innerHTML = ''
    }
  }, [context.session, context.workspaceId])

  return <div id="home-content" ref={containerRef} />
}
