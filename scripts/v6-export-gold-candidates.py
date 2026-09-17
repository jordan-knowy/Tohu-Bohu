#!/usr/bin/env python3
"""Export real, non-Gold annotation candidates without printing their content.

Requires SUPABASE_ACCESS_TOKEN. Output stays under the gitignored evaluation
private directory. Identifiers are HMAC-pseudonymized; free text must still be
reviewed by a human before privacy_reviewed can become true.
"""
import argparse
import hashlib
import hmac
import json
import os
import secrets
import urllib.request
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project-ref', required=True)
parser.add_argument('--output', default='evaluation/relational-intelligence/private/candidates.v1.json')
parser.add_argument('--key-file', default='evaluation/relational-intelligence/private/.pseudonym-key')
args = parser.parse_args()
token = os.environ.get('SUPABASE_ACCESS_TOKEN')
if not token:
    raise SystemExit('SUPABASE_ACCESS_TOKEN is required')

query = """
select e.id::text as source_id, e.organization_id::text, e.contact_id::text,
       coalesce(e.source_occurred_at,e.observed_at)::text as occurred_at,
       coalesce(nullif(e.source_type,''),'unknown') as channel,
       e.source_excerpt as evidence_text
from public.person_memory_entries e
where nullif(btrim(e.source_excerpt),'') is not null
  and coalesce(e.source_occurred_at,e.observed_at) is not null
order by coalesce(e.source_occurred_at,e.observed_at), e.id
"""
request = urllib.request.Request(
    f'https://api.supabase.com/v1/projects/{args.project_ref}/database/query',
    data=json.dumps({'query': query, 'read_only': True}).encode(),
    headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
)
with urllib.request.urlopen(request, timeout=30) as response:
    rows = json.load(response)

key_file = Path(args.key_file)
key_file.parent.mkdir(parents=True, exist_ok=True)
if key_file.exists():
    salt = key_file.read_bytes()
    if len(salt) != 32:
        raise SystemExit('pseudonym key must contain exactly 32 bytes')
else:
    salt = secrets.token_bytes(32)
    key_file.write_bytes(salt)
    os.chmod(key_file, 0o600)
def pseudonym(kind, value):
    digest = hmac.new(salt, f'{kind}:{value}'.encode(), hashlib.sha256).hexdigest()[:20]
    return f'{kind}_{digest}'

cases = []
for row in rows:
    group = pseudonym('relation', f"{row['organization_id']}:{row['contact_id']}")
    split = 'holdout' if int(hashlib.sha256(group.encode()).hexdigest()[:8], 16) % 5 == 0 else 'development'
    cases.append({
        'id': pseudonym('case', row['source_id']), 'group_id': group, 'split': split,
        'origin': 'human_real', 'privacy_reviewed': False,
        'events': [{'type': 'source_excerpt', 'text': row['evidence_text']}],
        'participants': [{'id': pseudonym('contact', row['contact_id']), 'role': 'unknown'}],
        'timestamps': [row['occurred_at']], 'channel': row['channel'],
        'context_before': '', 'context_after': '',
        'annotator_A': None, 'annotator_B': None, 'arbitration': None,
    })

output = Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(cases, ensure_ascii=False, indent=2) + '\n')
os.chmod(output, 0o600)
print(json.dumps({'output': str(output), 'candidates': len(cases),
                  'development': sum(c['split']=='development' for c in cases),
                  'holdout': sum(c['split']=='holdout' for c in cases),
                  'privacy_reviewed': 0}))
