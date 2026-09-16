// Primitives communes « preuve » (§18/§39) : distinguer visuellement ce qui est
// FAIT (observable, sourcé), ANALYSE TOHU (interprétation produite depuis des
// faits), INFÉRÉ (non directement déclaré) et À CONFIRMER (donnée insuffisamment
// solide). Aucun raisonnement Tohu ne doit visuellement ressembler à une preuve
// source — le badge est toujours visible à côté du texte, jamais implicite.
export type EvidenceKind = 'fact' | 'analysis' | 'inferred' | 'unconfirmed'

const KIND_LABEL: Record<EvidenceKind, string> = {
  fact: 'FAIT',
  analysis: 'ANALYSE TOHU',
  inferred: 'INFÉRÉ',
  unconfirmed: 'À CONFIRMER',
}

export function EvidenceKindBadge({ kind }: { kind: EvidenceKind }) {
  return <span className={`ev-kind ev-kind-${kind}`}>{KIND_LABEL[kind]}</span>
}

/** Pill compacte source · date — réutilisable partout où une provenance doit
 *  être visible sans alourdir la lecture (Météo, recommandations, timeline,
 *  signaux, synthèse). */
export function SourceBadge({ label, date }: { label: string; date?: string | null }) {
  return <span className="ev-src">{label}{date ? ` · ${date}` : ''}</span>
}

/** Ligne de preuve complète : badge de nature + texte + source. */
export function EvidenceItem({ kind, text, sourceLabel, date }: { kind: EvidenceKind; text: string; sourceLabel?: string | null; date?: string | null }) {
  return <div className="ev-item">
    <EvidenceKindBadge kind={kind} />
    <p className="ev-item-t">{text}</p>
    {sourceLabel && <SourceBadge label={sourceLabel} date={date} />}
  </div>
}
