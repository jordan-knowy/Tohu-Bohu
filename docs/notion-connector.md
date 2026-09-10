# Connecteur Notion AI Meeting Notes

Créer une **Public connection** dans le portail développeur Notion avec la portée d’installation voulue et les capacités **Read content** et **User information with email addresses**.

Configurer l’URI de redirection :

`https://bgmtzwfafcgjklgygvtx.supabase.co/functions/v1/connect-notion`

Ajouter ensuite `NOTION_CLIENT_ID` et `NOTION_CLIENT_SECRET` dans les secrets des Edge Functions Supabase. `APP_URL` reste optionnelle et vaut `https://tohu.co` par défaut.

La synchronisation utilise l’API `2026-03-11`, importe uniquement les AI Meeting Notes auxquelles l’utilisateur connecté participe, puis conserve les identifiants et URL Notion dans la provenance. Les prises de parole attribuables aux participants rapprochés sont analysées par OpenRouter via le pipeline commun aux transcriptions Read AI afin de mettre à jour profils, signaux et scores.
