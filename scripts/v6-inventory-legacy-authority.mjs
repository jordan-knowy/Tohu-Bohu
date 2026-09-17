#!/usr/bin/env node
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, relative, extname } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, process.argv[2] ?? 'docs/audits/v6-phase4-5-consumer-inventory.json')
const roots = ['src', 'supabase/functions', 'supabase/migrations']
const extensions = new Set(['.ts', '.tsx', '.sql'])
const patterns = {
  legacy_batch: /(?:functions\.invoke\(['"]score-batch['"]|functions\/v1\/score-batch(?:['"?/\s]|$)|\[functions\.score-batch\])/g,
  legacy_strategic_reader: /(?:functions\.invoke\(['"]account-strategic-reading['"]|functions\/v1\/account-strategic-reading(?:['"?/\s]|$)|\[functions\.account-strategic-reading\])/g,
  legacy_contact_history: /\bcontact_score_history\b/g,
  legacy_account_snapshots: /\baccount_relationship_score_snapshots\b/g,
  legacy_person_snapshots: /\bperson_relationship_score_snapshots\b/g,
  legacy_profile_score: /\b(?:trust_score|satisfaction_score|engagement_score)\b/g,
  legacy_context_score: /\brelationship_score\b/g,
  canonical_account_brain: /\baccount_brain\b/g,
  canonical_person_brain: /\bperson_brain\b/g,
  canonical_foundation_snapshot: /\bscoring\.foundation_snapshot\b/g,
  canonical_account_snapshot: /\bscoring\.account_snapshot\b/g,
}

async function files(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      if (!['node_modules', '.git'].includes(entry.name)) out.push(...await files(path))
    } else if (extensions.has(extname(entry.name))) out.push(path)
  }
  return out
}

const occurrences = []
for (const base of roots) {
  for (const file of await files(resolve(root, base))) {
    const rel = relative(root, file)
    const scope = rel.startsWith('supabase/migrations/') ? 'historical_migration'
      : /(__tests__|\.test\.)/.test(rel) ? 'test'
        : 'active_runtime'
    const lines = (await readFile(file, 'utf8')).split('\n')
    for (let i = 0; i < lines.length; i++) {
      for (const [category, regex] of Object.entries(patterns)) {
        regex.lastIndex = 0
        if (regex.test(lines[i])) occurrences.push({ category, file: rel, line: i + 1, scope })
      }
    }
  }
}

const summary = {}
for (const item of occurrences) {
  summary[item.category] ??= { total: 0, active_runtime: 0, test: 0, historical_migration: 0, files: [] }
  const value = summary[item.category]
  value.total++
  value[item.scope]++
  if (!value.files.includes(item.file)) value.files.push(item.file)
}
for (const value of Object.values(summary)) value.files.sort()

const legacyCategories = Object.keys(patterns).filter((name) => name.startsWith('legacy_'))
const activeLegacyOccurrences = occurrences.filter((item) => legacyCategories.includes(item.category) && item.scope === 'active_runtime')
const report = {
  generated_at: new Date().toISOString(),
  scope: roots,
  interpretation: {
    active_runtime: 'Code produit ou Edge Function exécutable.',
    test: 'Test local, non exécuté en production.',
    historical_migration: 'Historique SQL immuable; une occurrence ne signifie pas que l objet est encore actif.',
  },
  gate: { active_legacy_occurrences: activeLegacyOccurrences.length, pass: activeLegacyOccurrences.length === 0 },
  summary,
  occurrences,
}
await writeFile(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ output: relative(root, output), gate: report.gate, occurrences: occurrences.length, categories: Object.keys(summary).length }))
