// Convention Personnes de Tohu : prénom en casse titre, nom de famille en
// MAJUSCULES (ex. « Maxime WEINSTEIN »). Seul le premier mot du nom complet
// est traité comme prénom ; tout le reste comme nom de famille — cohérent
// avec la normalisation appliquée côté base (contacts.full_name).

function titleCaseWord(word: string): string {
  return word
    .split('-')
    .map((part) => part ? part.charAt(0).toLocaleUpperCase('fr-FR') + part.slice(1).toLocaleLowerCase('fr-FR') : part)
    .join('-')
}

export function formatPersonName(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return null
  const [firstName, ...rest] = trimmed.split(/\s+/)
  if (!firstName) return null
  const formattedFirst = titleCaseWord(firstName)
  if (!rest.length) return formattedFirst
  return `${formattedFirst} ${rest.join(' ').toLocaleUpperCase('fr-FR')}`
}
