// Squelette de chargement des fiches (retour testing P3.6).
// Épouse la structure réelle d'une fiche (héros + onglets + grille de cartes)
// pour que la page semble se matérialiser plutôt que d'afficher des blocs neutres.
// Purement visuel : aucune donnée, aucun réseau.

export function FicheSkeleton({ label }: { label: string }) {
  return (
    <div className="fiche-skeleton" role="status" aria-label={label}>
      <div className="fk-hero">
        <div className="fk-avatar" />
        <div className="fk-hlines">
          <i className="fk-l w45" />
          <i className="fk-l w28" />
        </div>
        <div className="fk-score" />
      </div>
      <div className="fk-tabs">
        <i /><i /><i /><i />
      </div>
      <div className="fk-grid">
        <div className="fk-card">
          <i className="fk-l w55" />
          <i className="fk-l w90" />
          <i className="fk-l w80" />
          <i className="fk-l w70" />
        </div>
        <div className="fk-card">
          <i className="fk-l w45" />
          <i className="fk-l w85" />
          <i className="fk-l w60" />
          <i className="fk-l w75" />
        </div>
      </div>
      <span className="sr-only">{label}</span>
    </div>
  )
}
