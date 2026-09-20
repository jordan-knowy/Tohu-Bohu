#!/usr/bin/env python3
"""Replay migrations and SQL tests in a disposable, offline Supabase Postgres.

Usage: python3 scripts/v6-rebuild-isolated.py [--git-ref HEAD]
Without --git-ref, checks the working tree, not reproducibility from Git.
Never connects to the linked project; historical HTTP cron jobs cannot run.
"""
import argparse
import datetime
import hashlib
import json
import subprocess
import time
import uuid
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--git-ref')
parser.add_argument('--output', default='docs/audits/v6-phase1-rebuild-validation.json')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent.parent
image = 'public.ecr.aws/supabase/postgres:17.6.1.155'
container = 'tohu-v6-rebuild-' + uuid.uuid4().hex[:12]


def run(command, **kwargs):
    return subprocess.run(command, cwd=root, text=True, capture_output=True, **kwargs)


source_ref = run(['git', 'rev-parse', args.git_ref], check=True).stdout.strip() if args.git_ref else None


def source_files(directory):
    if args.git_ref:
        paths = run(['git', 'ls-tree', '-r', '--name-only', source_ref, directory], check=True).stdout.splitlines()
        return [(p, run(['git', 'show', f'{source_ref}:{p}'], check=True).stdout)
                for p in sorted(paths) if p.endswith('.sql')]
    return [(str(p.relative_to(root)), p.read_text()) for p in sorted((root / directory).glob('*.sql'))]


report = {'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'source': args.git_ref or 'WORKING_TREE', 'resolved_git_commit': source_ref, 'image': image,
          'network': 'none', 'cron_active_jobs': False, 'migrations': [], 'tests': [], 'passed': False}
try:
    run(['docker', 'run', '-d', '--name', container, '--network', 'none', '--memory', '768m',
         '-e', 'POSTGRES_PASSWORD=isolated-test-only', image,
         'postgres', '-D', '/etc/postgresql', '-c', 'cron.launch_active_jobs=off'], check=True)
    for _ in range(60):
        if run(['docker', 'exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError('Isolated database did not start')
    # Bootstrap the real managed Storage schema from the pinned official image.
    # This validates SQL/RLS, not the Storage HTTP service or blob transport.
    storage_image = 'public.ecr.aws/supabase/storage-api:v1.72.1'
    report['storage_image'] = storage_image
    report['storage_migrations'] = []
    extract = "const fs=require('fs');const p='/app/migrations/tenant/';process.stdout.write(JSON.stringify(fs.readdirSync(p).filter(n=>n.endsWith('.sql')).sort((a,b)=>parseInt(a)-parseInt(b)).map(n=>[n,fs.readFileSync(p+n,'utf8')])));"
    storage_files = json.loads(run(['docker','run','--rm','--network','none','--entrypoint','node',storage_image,'-e',extract], check=True).stdout)
    for name, sql in storage_files:
        result = run(['docker','exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'], input="SET ROLE supabase_storage_admin; SET search_path = storage, public; SET storage.install_roles = 'false';\n"+sql)
        report['storage_migrations'].append({'name':name,'exit_code':result.returncode,'sha256':hashlib.sha256(sql.encode()).hexdigest()})
        if result.returncode:
            raise RuntimeError(f'Storage {name}: {result.stderr}')
    print(f'Storage schema: {len(storage_files)} migrations PASS', flush=True)
    for directory, kind in [('supabase/migrations', 'migrations'), ('supabase/tests', 'tests')]:
        files = source_files(directory)
        if kind == 'tests':
            # Other SQL files bootstrap their own database/roles.
            files = [(p, sql) for p, sql in files if Path(p).name.startswith('v6_')]
        if not files:
            raise RuntimeError(f'No {kind} found in selected source')
        for path, sql in files:
            result = run(['docker', 'exec', '-i', container, 'psql', '-X', '-q',
                          '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
                          *(['--single-transaction'] if kind == 'migrations' else [])], input=sql)
            entry = {'path': path, 'sha256': hashlib.sha256(sql.encode()).hexdigest(),
                     'exit_code': result.returncode}
            report[kind].append(entry)
            if result.returncode:
                entry['error'] = result.stderr
                raise RuntimeError(f'{path}: {result.stderr}')
        print(f'{kind}: {len(files)}/{len(files)} PASS', flush=True)
    report['passed'] = True
finally:
    # Remove only the uniquely named container created by this invocation.
    run(['docker', 'rm', '-f', container])
    output = root / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + '\n')
