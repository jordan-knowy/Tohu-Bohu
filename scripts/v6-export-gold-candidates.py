#!/usr/bin/env python3
"""Build private, context-limited annotation candidates from read-only sources.

Requires SUPABASE_ACCESS_TOKEN. Output is gitignored and never printed. Known
identities, emails, URLs and phone numbers are pseudonymized. A human must still
complete privacy review before a packet becomes annotatable Gold data.
"""
import argparse, hashlib, hmac, json, os, re, secrets, urllib.error, urllib.request
from pathlib import Path

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project-ref',required=True)
parser.add_argument('--output',default='evaluation/relational-intelligence/private/candidates.v2.json')
parser.add_argument('--key-file',default='evaluation/relational-intelligence/private/.pseudonym-key')
args=parser.parse_args(); token=os.environ.get('SUPABASE_ACCESS_TOKEN')
if not token: raise SystemExit('SUPABASE_ACCESS_TOKEN is required')

query=r"""
with memory as (
 select e.id::text source_id,e.organization_id::text,e.contact_id::text,e.author_user_id::text,
  coalesce(e.source_occurred_at,e.observed_at)::text occurred_at,coalesce(nullif(e.source_type,''),'unknown') channel,
  e.source_direction,e.entry_type,e.source_excerpt evidence_text,c.company_id::text,c.role_title,c.title_confirmed,
  (select jsonb_build_object('at',coalesce(p.source_occurred_at,p.observed_at),'text',p.source_excerpt,'direction',p.source_direction)
   from public.person_memory_entries p where p.contact_id=e.contact_id and p.id<>e.id and nullif(btrim(p.source_excerpt),'') is not null
   and coalesce(p.source_occurred_at,p.observed_at)<coalesce(e.source_occurred_at,e.observed_at)
   order by coalesce(p.source_occurred_at,p.observed_at) desc limit 1) previous_excerpt,
  (select jsonb_build_object('at',coalesce(n.source_occurred_at,n.observed_at),'text',n.source_excerpt,'direction',n.source_direction)
   from public.person_memory_entries n where n.contact_id=e.contact_id and n.id<>e.id and nullif(btrim(n.source_excerpt),'') is not null
   and coalesce(n.source_occurred_at,n.observed_at)>coalesce(e.source_occurred_at,e.observed_at)
   order by coalesce(n.source_occurred_at,n.observed_at) limit 1) next_excerpt
 from public.person_memory_entries e join public.contacts c on c.id=e.contact_id
 where nullif(btrim(e.source_excerpt),'') is not null and coalesce(e.source_occurred_at,e.observed_at) is not null
), message_ranked as (
 select m.organization_id::text,m.contact_id::text,c.company_id::text,m.id::text,coalesce(m.sent_at,m.created_at)::text at,
  m.direction,m.provider,m.thread_id::text,row_number() over(partition by m.contact_id order by coalesce(m.sent_at,m.created_at) desc,m.id) rn,
  count(*) over(partition by m.contact_id) total
 from public.communication_messages m join public.contacts c on c.id=m.contact_id
 where m.contact_id is not null and coalesce(m.sent_at,m.created_at) is not null
), sequence_groups as (
 select organization_id,contact_id,company_id,max(total) total,
  jsonb_agg(jsonb_build_object('id',id,'at',at,'direction',direction,'provider',provider,'thread_id',thread_id) order by at) filter(where rn<=10) events
 from message_ranked where total>=5 group by organization_id,contact_id,company_id order by contact_id limit 8
), identities as (
 select 'external' kind,id::text,organization_id::text,full_name name,email from public.contacts
 union all select 'account',id::text,organization_id::text,name,null from public.companies
 union all select 'internal',p.id::text,m.organization_id::text,p.full_name,null from public.profiles p join public.memberships m on m.user_id=p.id
 union all select 'participant',id::text,organization_id::text,coalesce(display_name,name),email from public.meeting_participants
), transcript_rows as (
 select t.id::text,t.organization_id::text,t.meeting_id::text,t.transcript_text,m.starts_at::text,m.platform,m.status,
  coalesce((select jsonb_agg(jsonb_build_object('id',p.id::text,'contact_id',p.contact_id::text,'role',coalesce(p.participant_job_title,p.role_in_meeting),'current_user',p.is_current_user)) from public.meeting_participants p where p.meeting_id=t.meeting_id),'[]'::jsonb) participants
 from public.meeting_transcripts t left join public.meetings m on m.id=t.meeting_id
 where nullif(btrim(t.transcript_text),'') is not null and t.consent_status<>'revoked'
)
select jsonb_build_object(
 'memory',coalesce((select jsonb_agg(to_jsonb(memory) order by occurred_at,source_id) from memory),'[]'::jsonb),
 'sequences',coalesce((select jsonb_agg(to_jsonb(sequence_groups)) from sequence_groups),'[]'::jsonb),
 'identities',coalesce((select jsonb_agg(to_jsonb(identities)) from identities where nullif(btrim(name),'') is not null or nullif(btrim(email),'') is not null),'[]'::jsonb),
 'transcripts',coalesce((select jsonb_agg(to_jsonb(transcript_rows)) from transcript_rows),'[]'::jsonb)
) payload
"""
request=urllib.request.Request(f'https://api.supabase.com/v1/projects/{args.project_ref}/database/query',data=json.dumps({'query':query,'read_only':True}).encode(),headers={'Authorization':f'Bearer {token}','Content-Type':'application/json'})
try:
 with urllib.request.urlopen(request,timeout=60) as response: payload=json.load(response)[0]['payload']
except urllib.error.HTTPError as error:
 detail=error.read().decode(errors='replace')
 raise SystemExit(f'read-only export query failed ({error.code}): {detail[:1000]}')

key_file=Path(args.key_file); key_file.parent.mkdir(parents=True,exist_ok=True)
if key_file.exists():
 salt=key_file.read_bytes()
 if len(salt)!=32: raise SystemExit('pseudonym key must contain exactly 32 bytes')
else:
 salt=secrets.token_bytes(32); key_file.write_bytes(salt); os.chmod(key_file,0o600)
def pseudonym(kind,value): return f"{kind}_{hmac.new(salt,f'{kind}:{value}'.encode(),hashlib.sha256).hexdigest()[:12]}"

replacements=[]
for item in payload['identities']:
 label=pseudonym(item['kind'],item['id'])
 for value in (item.get('email'),item.get('name')):
  if isinstance(value,str) and len(value.strip())>=3: replacements.append((value.strip(),label))
replacements.sort(key=lambda pair:len(pair[0]),reverse=True)
def sanitize(value):
 text=str(value or '')
 for original,replacement in replacements: text=re.sub(re.escape(original),replacement,text,flags=re.IGNORECASE)
 text=re.sub(r'(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b','[EMAIL]',text)
 text=re.sub(r'(?i)\bhttps?://\S+|\bwww\.\S+','[URL]',text)
 text=re.sub(r'(?<!\w)(?:\+?\d[\d .()/-]{7,}\d)(?!\w)','[PHONE]',text)
 return text.strip()
def residual(text):
 found=[]
 if re.search(r'(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b',text): found.append('email')
 if re.search(r'(?i)\bhttps?://|\bwww\.',text): found.append('url')
 if re.search(r'(?<!\w)(?:\+?\d[\d .()/-]{7,}\d)(?!\w)',text): found.append('phone')
 if re.search(r"\b[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'’-]{2,}\s+[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'’-]{2,}\b",text): found.append('possible_name')
 return sorted(set(found))
def event(kind,at,text=None,**facts):
 item={'type':kind,'at':at}
 if text: item['text']=sanitize(text)
 item.update({k:v for k,v in facts.items() if v is not None}); return item

cases=[]
for row in payload['memory']:
 group=pseudonym('relation',f"{row['organization_id']}:{row['contact_id']}"); timeline=[]
 for label,key in [('context_before','previous_excerpt'),('focus','self'),('context_after','next_excerpt')]:
  source=row if key=='self' else row.get(key)
  if source: timeline.append(event(label,source.get('occurred_at') or source.get('at'),source.get('evidence_text') or source.get('text'),direction=source.get('source_direction') or source.get('direction')))
 all_text='\n'.join(x.get('text','') for x in timeline)
 cases.append({'id':pseudonym('case',row['source_id']),'group_id':group,'split':'development','origin':'human_real','privacy_reviewed':False,'privacy_findings':residual(all_text),'case_type':'semantic_single','annotation_possible':True,'annotation_not_possible_reason':None,'source_completeness':'partial','events':timeline,'participants':[{'id':pseudonym('internal',row['author_user_id']),'side':'internal','role':'unknown'},{'id':pseudonym('external',row['contact_id']),'side':'external','role':sanitize(row.get('role_title')) or 'unknown','role_confirmed':bool(row.get('title_confirmed'))}],'timestamps':[x['at'] for x in timeline if x.get('at')],'channel':row['channel'],'context_before':'Adjacent verified excerpts only; original email body unavailable.','context_after':'No engine prediction, score, Legacy result or recommendation included.','context_facts':[f"source_direction={row.get('source_direction') or 'unknown'}",f"entry_type={row.get('entry_type') or 'unknown'}"],'annotator_A':None,'annotator_B':None,'arbitration':None})

for row in payload['sequences']:
 group=pseudonym('relation',f"{row['organization_id']}:{row['contact_id']}")
 timeline=[event('interaction_metadata',x['at'],None,direction=x.get('direction') or 'unknown',channel=x.get('provider') or 'unknown',thread=pseudonym('thread',x['thread_id']) if x.get('thread_id') else None) for x in row['events']]
 cases.append({'id':pseudonym('case','sequence:'+row['contact_id']),'group_id':group,'split':'development','origin':'human_real','privacy_reviewed':False,'privacy_findings':[],'case_type':'semantic_sequence','annotation_possible':True,'annotation_not_possible_reason':None,'source_completeness':'partial','events':timeline,'participants':[{'id':pseudonym('external',row['contact_id']),'side':'external','role':'unknown'}],'timestamps':[x['at'] for x in timeline],'channel':'multi_event_metadata','context_before':'Ten most recent captured message metadata; message bodies are unavailable.','context_after':'Missing channels must be treated as unknown, not absent.','context_facts':[f"captured_message_count={row['total']}"],'annotator_A':None,'annotator_B':None,'arbitration':None})

def transcript_windows(text,count=4,width=900):
 clean=sanitize(text)
 if not clean:return []
 if len(clean)<=width:return [clean]
 windows=[]
 for i in range(count):
  center=int((i+.5)*len(clean)/count);start=max(0,center-width//2);end=min(len(clean),start+width)
  left=clean.rfind('\n',max(0,start-150),start+1);right=clean.find('\n',end,min(len(clean),end+150))
  windows.append(clean[left+1 if left>=0 else start:right if right>=0 else end].strip())
 return [w for w in windows if w]
for transcript in payload['transcripts']:
 group=pseudonym('meeting',transcript['meeting_id'] or transcript['id'])
 participants=[{'id':pseudonym('participant',p['id']),'side':'internal' if p.get('current_user') else 'external','role':sanitize(p.get('role')) or 'unknown'} for p in transcript.get('participants',[])]
 for index,window in enumerate(transcript_windows(transcript['transcript_text'])):
  cases.append({'id':pseudonym('case',f"transcript:{transcript['id']}:{index}"),'group_id':group,'split':'development','origin':'human_real','privacy_reviewed':False,'privacy_findings':residual(window),'case_type':'semantic_sequence','annotation_possible':True,'annotation_not_possible_reason':None,'source_completeness':'partial','events':[event('transcript_window',transcript.get('starts_at'),window)],'participants':participants,'timestamps':[transcript['starts_at']] if transcript.get('starts_at') else [],'channel':transcript.get('platform') or 'meeting_transcript','context_before':f'Systematic transcript window {index+1}; neighboring windows omitted to limit context.','context_after':'The window was selected without consulting model predictions.','context_facts':[f"meeting_status={transcript.get('status') or 'unknown'}"],'annotator_A':None,'annotator_B':None,'arbitration':None})

# Freeze a deterministic relation-level holdout before any model evaluation.
groups=sorted({c['group_id'] for c in cases},key=lambda g:hashlib.sha256(g.encode()).hexdigest());holdout_groups=set();holdout_cases=0
for group in groups:
 if len(holdout_groups)>=max(4,round(len(groups)*.25)) and holdout_cases>=8:break
 holdout_groups.add(group);holdout_cases+=sum(c['group_id']==group for c in cases)
for case in cases:case['split']='holdout' if case['group_id'] in holdout_groups else 'development'
cases.sort(key=lambda c:(c['split'],c['case_type'],c['id']))
output=Path(args.output);output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(cases,ensure_ascii=False,indent=2)+'\n');os.chmod(output,0o600)
summary={'output':str(output),'candidates':len(cases),'development':sum(c['split']=='development' for c in cases),'holdout':sum(c['split']=='holdout' for c in cases),'groups':len(groups),'holdout_groups':len(holdout_groups),'privacy_reviewed':0,'by_type':{t:sum(c['case_type']==t for c in cases) for t in sorted({c['case_type'] for c in cases})}}
print(json.dumps(summary))
