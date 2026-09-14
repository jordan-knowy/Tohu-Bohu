/**
 * Chargement de marque — équivalent React de tohuSpinner() (components/logo.ts).
 * Même structure/couleurs que le logo, réduites au motif central : le nœud
 * violet et ses branches qui se connectent en boucle, plutôt qu'un cercle
 * générique. Garder les deux implémentations synchronisées si l'une change.
 */
export function TohuSpinner({ size = 18, label = 'Chargement…' }: { size?: number; label?: string }) {
  return (
    <svg className="tohu-spin" viewBox="0 0 100 100" width={size} height={size} role="status" aria-label={label}>
      <line className="tohu-spin-branch b1" x1="50" y1="50" x2="80" y2="24" />
      <line className="tohu-spin-branch b2" x1="50" y1="50" x2="88" y2="60" />
      <line className="tohu-spin-branch b3" x1="50" y1="50" x2="66" y2="86" />
      <line className="tohu-spin-branch b4" x1="50" y1="50" x2="26" y2="34" />
      <circle className="tohu-spin-node n1" cx="80" cy="24" r="7" />
      <circle className="tohu-spin-node n2" cx="88" cy="60" r="6" />
      <circle className="tohu-spin-node n3" cx="66" cy="86" r="6" />
      <circle className="tohu-spin-node n4" cx="26" cy="34" r="5.5" />
      <circle className="tohu-spin-hub" cx="50" cy="50" r="11" />
    </svg>
  )
}
