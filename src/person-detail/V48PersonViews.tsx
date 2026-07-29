import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { PersonCognitiveTheme, PersonDetailData } from './types'
import { CareerSection, ContactsCard, HistoryCard, MemoryCard, SignalsCard } from './sections2'
import { RecommendationsSection } from './sections'
import { confidenceLevel, formatDate, relativeDate } from './ui'

type ViewProps = {
  data: PersonDetailData
  userId: string
  refresh: () => Promise<void>
}

function V48Icon({ name }: { name: 'calendar' | 'profile' | 'pulse' | 'commitment' | 'career' | 'signal' | 'sparkle' }) {
  const paths: Record<typeof name, ReactNode> = {
    calendar: <><rect x="4" y="5.5" width="16" height="14" rx="2" /><path d="M4 10h16M8 3.5v4M16 3.5v4" /></>,
    profile: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" /><circle cx="12" cy="12" r="2.5" /></>,
    pulse: <path d="M3 12h4l2-5 4 10 2-5h6" />,
    commitment: <><path d="M4.5 5.5h5a2.5 2.5 0 0 1 2.5 2.5v11a2 2 0 0 0-2-2H4.5Z" /><path d="M19.5 5.5h-5A2.5 2.5 0 0 0 12 8v11a2 2 0 0 1 2-2h5.5Z" /></>,
    career: <><circle cx="6.5" cy="6" r="2.5" /><circle cx="17.5" cy="18" r="2.5" /><path d="M6.5 8.5v5a4.5 4.5 0 0 0 4.5 4.5h4" /></>,
    signal: <><path d="M5 12a7 7 0 0 1 14 0M8 15a4 4 0 0 1 8 0" /><circle cx="12" cy="18" r="1" /></>,
    sparkle: <><path d="m12 3 1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3Z" /><path d="m18 14 .8 2.2 2.2.8-2.2.8L18 20l-.8-2.2L15 17l2.2-.8Z" /></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function SectionTitle({ icon, title, meta }: { icon: Parameters<typeof V48Icon>[0]['name']; title: string; meta?: ReactNode }) {
  return <header className="v48-section-title">
    <span><V48Icon name={icon} /></span>
    <h2>{title}</h2>
    {meta && <div>{meta}</div>}
  </header>
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="v48-empty"><span>◇</span><p>{children}</p></div>
}

function themeName(theme: PersonCognitiveTheme, fallback: string): string {
  return theme.label?.trim() || fallback
}

function themeValue(theme: PersonCognitiveTheme): number {
  return Math.max(8, Math.min(100, theme.score ?? (theme.status === 'observed' ? 68 : theme.status === 'emerging' ? 42 : 18)))
}

function BehaviorRadar({ themes }: { themes: Array<{ name: string; theme: PersonCognitiveTheme }> }) {
  const cx = 210
  const cy = 160
  const radius = 102
  const point = (index: number, value: number): [number, number] => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / themes.length
    const r = radius * value / 100
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]
  }
  const polygon = themes.map((item, index) => point(index, themeValue(item.theme)).join(',')).join(' ')
  const ring = (value: number) => themes.map((_, index) => point(index, value).join(',')).join(' ')
  return <div className="v48-radar-wrap">
    <svg className="v48-radar" viewBox="0 0 420 320" role="img" aria-label={themes.map((item) => `${item.name} ${themeValue(item.theme)} sur 100`).join(', ')}>
      {[25, 50, 75, 100].map((value) => <polygon key={value} points={ring(value)} className="v48-radar-ring" />)}
      {themes.map((_, index) => {
        const [x, y] = point(index, 100)
        return <line key={index} x1={cx} y1={cy} x2={x} y2={y} className="v48-radar-axis" />
      })}
      <polygon points={polygon} className="v48-radar-area" />
      {themes.map((item, index) => {
        const [x, y] = point(index, themeValue(item.theme))
        const [lx, ly] = point(index, 125)
        return <g key={`${item.name}-${index}`}>
          <circle cx={x} cy={y} r="4.5" className={`v48-radar-dot v48-radar-dot-${item.theme.status}`} />
          <text x={lx} y={ly} textAnchor={lx < cx - 12 ? 'end' : lx > cx + 12 ? 'start' : 'middle'} className="v48-radar-label">{item.name}</text>
          <text x={lx} y={ly + 15} textAnchor={lx < cx - 12 ? 'end' : lx > cx + 12 ? 'start' : 'middle'} className="v48-radar-value">{themeValue(item.theme)}%</text>
        </g>
      })}
    </svg>
  </div>
}

export function V48PersonProfileView({ data }: ViewProps) {
  const cognitive = data.behavior.cognitiveProfile
  const themes = useMemo(() => {
    const available: Array<{ name: string; theme: PersonCognitiveTheme }> = [
      { name: 'Assertivité', theme: cognitive.interpersonal.assertiveness },
      { name: 'Chaleur', theme: cognitive.interpersonal.warmth },
      ...cognitive.exchangeStyles.slice(0, 2).map((theme, index) => ({ name: themeName(theme, `Échange ${index + 1}`), theme })),
      ...cognitive.speechActs.slice(0, 2).map((theme, index) => ({ name: themeName(theme, `Expression ${index + 1}`), theme })),
    ]
    return available.slice(0, 6)
  }, [cognitive])
  const observed = themes.filter((item) => item.theme.status !== 'insufficient')
  const posture = cognitive.posture.observation || data.behavior.executiveSummary

  return <div className="v48-person-profile">
    <div className="v48-now-grid">
      <article className="v48-next-meeting">
        <span className="v48-now-icon"><V48Icon name="calendar" /></span>
        <div>
          <span className="v48-kicker">Prochain rendez-vous <b><i />Live</b></span>
          <strong>Aucun rendez-vous synchronisé</strong>
          <small>Connecte ou synchronise un agenda pour préparer le prochain échange.</small>
        </div>
      </article>
      <article className="v48-posture">
        <span>Posture à adopter</span>
        <p>{posture || 'Le profil est encore en construction. Tohu attend davantage d’échanges observables avant de recommander une posture.'}</p>
      </article>
    </div>

    <section className="v48-section">
      <SectionTitle
        icon="profile"
        title="Profil comportemental"
        meta={<span className="v48-section-count"><b>{observed.length}</b> dimensions · déduites de {data.behavior.analyzedInteractions} échange{data.behavior.analyzedInteractions > 1 ? 's' : ''}</span>}
      />
      {!observed.length
        ? <EmptyState>{data.behavior.availableInteractions
          ? `${data.behavior.availableInteractions} échange${data.behavior.availableInteractions > 1 ? 's ont' : ' a'} été retrouvé${data.behavior.availableInteractions > 1 ? 's' : ''}. Le profil apparaîtra après leur analyse et plusieurs preuves concordantes.`
          : 'Aucun échange attribuable n’a encore été retrouvé. Synchronise les emails et les réunions de cette personne.'}</EmptyState>
        : <div className="v48-behavior-grid">
          <div>
            <p className="v48-overline">Profil déduit des échanges réels</p>
            <BehaviorRadar themes={themes} />
          </div>
          <div className="v48-adaptation-list">
            <p className="v48-overline">Comment s’adapter</p>
            {observed.map(({ name, theme }) => <article key={name}>
              <span className={`v48-confidence v48-confidence-${theme.status}`}>{confidenceLevel(theme.confidence) ?? theme.status}</span>
              <h3>{themeName(theme, name)}</h3>
              <p>{theme.observation || 'Tendance détectée, formulation en cours de consolidation.'}</p>
              <small>{theme.evidenceCount} preuve{theme.evidenceCount > 1 ? 's' : ''} · {theme.sourceTypes.join(' + ') || 'source à confirmer'}</small>
            </article>)}
          </div>
        </div>}
    </section>

    <details className="v48-detail-fold">
      <summary><V48Icon name="profile" /><strong>Le profil en détail</strong><span>{observed.length} dimensions · {data.behavior.insights.length} traits</span><b>⌄</b></summary>
      <div className="v48-detail-grid">
        {observed.map(({ name, theme }) => <article key={name}>
          <strong>{themeValue(theme)}%</strong>
          <div><h3>{themeName(theme, name)}</h3><p>{theme.observation || 'Observation en cours de consolidation.'}</p></div>
        </article>)}
        {data.behavior.insights.map((insight) => <article key={insight.id}>
          <strong>{insight.confidence === null ? '—' : `${Math.round(insight.confidence * (insight.confidence <= 1 ? 100 : 1))}%`}</strong>
          <div><h3>{insight.trait}</h3><p>{insight.observation}</p></div>
        </article>)}
      </div>
    </details>
  </div>
}

function RelationshipChart({ data }: { data: PersonDetailData }) {
  const points = data.scoreHistory.filter((item) => item.score !== null)
  if (points.length < 2) return <EmptyState>L’évolution apparaîtra dès que plusieurs calculs relationnels auront été enregistrés.</EmptyState>
  const width = 640
  const height = 190
  const pad = 22
  const x = (index: number) => pad + index * (width - pad * 2) / Math.max(1, points.length - 1)
  const y = (score: number) => pad + (100 - score) / 100 * (height - pad * 2)
  const path = points.map((item, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(item.score!)}`).join(' ')
  return <svg className="v48-score-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={points.map((item) => `${item.monthKey}: ${item.score}`).join(', ')}>
    {[25, 50, 75].map((value) => <line key={value} x1={pad} y1={y(value)} x2={width - pad} y2={y(value)} />)}
    <path d={path} />
    {points.map((item, index) => <circle key={item.monthKey} cx={x(index)} cy={y(item.score!)} r={index === points.length - 1 ? 5 : 3} />)}
  </svg>
}

export function V48PersonRelationView({ data, userId, refresh }: ViewProps) {
  const relation = data.relationship
  const commitments = data.memoryEntries.filter((item) => item.entryType === 'commitment')
  const recommendations = data.recommendations.filter((item) => ['open', 'in_progress', 'postponed'].includes(item.status))
  const delta = relation.phaseDelta
  const dimensionRows = [
    ['Intensité', relation.dimensions.intensity],
    ['Réciprocité', relation.dimensions.reciprocity],
    ['Ancienneté', relation.dimensions.longevity],
  ] as const
  return <div className="v48-person-relation">
    <div className="v48-relation-columns">
      <section className="v48-section">
        <SectionTitle icon="pulse" title="Notre relation" meta={<span className={`v48-evolution ${delta !== null && delta < 0 ? 'down' : 'up'}`}>{delta === null ? 'variation indisponible' : `${delta >= 0 ? '↗ +' : '↘ '}${delta} pts`}</span>} />
        <div className="v48-score-lead">
          <strong>{relation.score ?? '—'}</strong>
          <div><span>NPS relationnel</span><p>Solidité du lien déduite des échanges réels, pas d’un questionnaire.</p></div>
        </div>
        <RelationshipChart data={data} />
        <div className="v48-dimension-list">
          {dimensionRows.map(([label, value]) => <div key={label}>
            <span>{label}</span>
            <i><b style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} /></i>
            <strong>{value ?? '—'}</strong>
          </div>)}
        </div>
        <div className="v48-live-sync"><i />Dernière synchronisation : {relativeDate(relation.computedAt).toLowerCase()}</div>
      </section>

      <section className="v48-section">
        <SectionTitle icon="commitment" title="Engagements pris" meta={<span className="v48-section-count"><b>{commitments.length + recommendations.length}</b> à suivre</span>} />
        <p className="v48-section-intro">Ce qui a été promis ou recommandé de part et d’autre. Seuls les éléments persistés sont affichés.</p>
        <div className="v48-commitment-list">
          {commitments.map((item) => <article key={item.id}>
            <span>Mémoire</span><h3>{item.content}</h3><small>{item.authorName} · {formatDate(item.createdAt)}</small>
          </article>)}
          {recommendations.slice(0, 5).map((item) => <article key={item.id}>
            <span>Action P{item.priority}</span><h3>{item.title}</h3><p>{item.recommendedAction || item.justification}</p><small>{item.provenance.sourceLabel}</small>
          </article>)}
          {!commitments.length && !recommendations.length && <EmptyState>Aucun engagement ou action ouverte n’est actuellement enregistré.</EmptyState>}
        </div>
      </section>
    </div>
    <HistoryCard data={data} memory={<MemoryCard data={data} userId={userId} refresh={refresh} embedded />} />
    {recommendations.length > 0 && <RecommendationsSection data={data} userId={userId} refresh={refresh} />}
  </div>
}

function InsightBand({ data }: { data: PersonDetailData }) {
  const signal = data.signals[0]
  return <div className="v48-insight-grid">
    <article className="v48-insight">
      <span><V48Icon name="sparkle" /></span>
      <div><small>Ce que montrent les échanges</small><strong>{data.summary?.text || data.behavior.executiveSummary || 'Lecture en cours de construction'}</strong>
        <p>Dérivé de {data.relationship.totalInteractions} échange{data.relationship.totalInteractions > 1 ? 's' : ''} · {data.sources.filter((source) => source.status === 'connected').map((source) => source.label).join(' + ') || 'sources à confirmer'}</p>
      </div>
    </article>
    <article className="v48-signal-spotlight">
      <small>Depuis votre dernier échange <b>{formatDate(data.relationship.lastInteractionAt)}</b></small>
      {signal ? <><span>{signal.type}</span><strong>{signal.title}</strong><p>{signal.summary || 'Signal détecté, détail en cours de consolidation.'}</p><em>{signal.provenance.sourceLabel} · {relativeDate(signal.provenance.observedAt).toLowerCase()}</em></>
        : <p>Aucun nouveau signal réel depuis le dernier échange.</p>}
    </article>
  </div>
}

export function V48PersonLiveView({ data, userId, refresh }: ViewProps) {
  const currentCareer = data.careerEntries.find((item) => item.current)
  const hookCandidates = [
    data.summary?.text ? { title: 'Synthèse relationnelle', text: data.summary.text, source: data.summary.provenance?.sourceLabel } : null,
    currentCareer?.description
      ? { title: 'Actualité professionnelle', text: currentCareer.description, source: currentCareer.provenance.sourceLabel }
      : null,
    data.behavior.executiveSummary ? { title: 'Style d’échange', text: data.behavior.executiveSummary, source: 'Échanges observés' } : null,
  ]
  const hooks = hookCandidates.filter((item): item is NonNullable<(typeof hookCandidates)[number]> => item !== null)

  return <div className="v48-person-live">
    <InsightBand data={data} />
    <div className="v48-live-layout">
      <main className="v48-live-main">
        <CareerSection data={data} userId={userId} refresh={refresh} />
        <section className="v48-section v48-hooks">
          <SectionTitle icon="sparkle" title="Points d’accroche" />
          <div>
            {hooks.map((hook) => <article key={hook.title}><span><V48Icon name="sparkle" /></span><div><h3>{hook.title}</h3><p>{hook.text}</p><small>{hook.source || 'Source à confirmer'}</small></div></article>)}
            {!hooks.length && <EmptyState>Aucun point d’accroche suffisamment étayé n’est disponible.</EmptyState>}
          </div>
        </section>
      </main>
      <aside className="v48-live-rail" id="person-contact-panel">
        <ContactsCard data={data} userId={userId} refresh={refresh} />
        <SignalsCard data={data} userId={userId} refresh={refresh} />
      </aside>
    </div>
  </div>
}

export function V48PersonSourceNote({ data }: { data: PersonDetailData }) {
  const connected = data.sources.filter((source) => source.status === 'connected')
  return <footer className="v48-source-note">
    {data.relationship.totalInteractions} échange{data.relationship.totalInteractions > 1 ? 's' : ''} retrouvé{data.relationship.totalInteractions > 1 ? 's' : ''}
    {' · '}{data.behavior.analyzedInteractions} analysé{data.behavior.analyzedInteractions > 1 ? 's' : ''}
    {' · '}calculé {formatDate(data.generatedAt)}
    {connected.length > 0 && <> · {connected.map((source) => source.label).join(' + ')}</>}
    {data.employment && <> · <Link to={`/app/accounts/${data.employment.accountId}`}>{data.employment.accountName}</Link></>}
  </footer>
}
