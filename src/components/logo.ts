export const tohuLogo = (label = 'Accueil Tohu') => `
  <a class="logo" href="/" aria-label="${label}">
    <span class="logo-mark"><svg viewBox="7 -1 104 104" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g transform="translate(6,-5)"><circle cx="14" cy="34" r="2" fill="#6E50C8" opacity=".16"/><circle cx="10" cy="70" r="2.6" fill="#6E50C8" opacity=".2"/><circle cx="22" cy="92" r="2" fill="#6E50C8" opacity=".28"/><circle cx="28" cy="20" r="1.8" fill="#6E50C8" opacity=".18"/><circle cx="26" cy="52" r="2.4" fill="#6E50C8" opacity=".34"/><circle cx="38" cy="80" r="2.6" fill="#6E50C8" opacity=".46"/><path d="M38 80 L60 62 M26 52 L52 46" stroke="#6E50C8" stroke-width="1" opacity=".22" fill="none"/><line x1="60" y1="62" x2="80" y2="42" stroke="#6E50C8" stroke-width="2.2"/><line x1="60" y1="62" x2="94" y2="66" stroke="#6E50C8" stroke-width="2.2"/><line x1="60" y1="62" x2="76" y2="90" stroke="#6E50C8" stroke-width="2.2"/><line x1="60" y1="62" x2="52" y2="46" stroke="#6E50C8" stroke-width="2.2"/><circle cx="80" cy="42" r="4.6" fill="#2EA86A"/><circle cx="94" cy="66" r="4" fill="#6E50C8"/><circle cx="76" cy="90" r="4" fill="#6E50C8"/><circle cx="52" cy="46" r="3.6" fill="#2896A8"/><circle cx="60" cy="62" r="7.6" fill="#6E50C8"/></g></svg></span>
    <span class="logo-word">tohu<i>.</i></span>
  </a>`

/** Chargement de marque — le nœud central du logo, branches qui se
 *  connectent en boucle. Remplace le spinner générique partout où il est
 *  utilisé en HTML brut (vues vanilla-DOM) ; voir TohuSpinner.tsx pour
 *  l'équivalent React. Même structure/couleurs que tohuLogo(), réduites au
 *  motif central. */
export const tohuSpinner = (size = 18, label = 'Chargement…') => `
  <svg class="tohu-spin" viewBox="0 0 100 100" width="${size}" height="${size}" role="status" aria-label="${label}">
    <line class="tohu-spin-branch b1" x1="50" y1="50" x2="80" y2="24" />
    <line class="tohu-spin-branch b2" x1="50" y1="50" x2="88" y2="60" />
    <line class="tohu-spin-branch b3" x1="50" y1="50" x2="66" y2="86" />
    <line class="tohu-spin-branch b4" x1="50" y1="50" x2="26" y2="34" />
    <circle class="tohu-spin-node n1" cx="80" cy="24" r="7" />
    <circle class="tohu-spin-node n2" cx="88" cy="60" r="6" />
    <circle class="tohu-spin-node n3" cx="66" cy="86" r="6" />
    <circle class="tohu-spin-node n4" cx="26" cy="34" r="5.5" />
    <circle class="tohu-spin-hub" cx="50" cy="50" r="11" />
  </svg>`
