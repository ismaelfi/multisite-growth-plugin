#!/usr/bin/env python3
"""One-time, consistent DSH snapshot. Never imports OAuth secrets or overwrites data."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, default=Path.home()/'.dsh/portfolio')
parser.add_argument('--destination', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
settings = root/'local-config.json'
fallback = Path(os.environ.get('XDG_DATA_HOME', Path.home()/'.local/share'))/'website-growth'
configured = Path(json.loads(settings.read_text())['dataDir']) if settings.exists() else fallback
destination = (args.destination or Path(os.environ.get('WEBSITE_GROWTH_DATA_DIR', configured))).resolve()
source = args.source.resolve()
if destination.exists():
    raise SystemExit('Destination exists; refusing to replace an active portfolio.')
config = json.loads((source/'config.json').read_text())
if not isinstance(config.get('sites'), list):
    raise SystemExit('Source config must contain a sites array.')
destination.parent.mkdir(parents=True, exist_ok=True)
stage = Path(tempfile.mkdtemp(prefix='.website-growth-import-', dir=destination.parent))
try:
    # Retain only documented non-secret fields. Credentials stay in DSH/Treg.
    clean = {key: config[key] for key in ['version', 'sites', 'days', 'updatedAt'] if key in config}
    clean['google'] = {'clientId': ''}
    (stage/'config.json').write_text(json.dumps(clean, indent=2)+'\n')
    if (source/'cache.json').exists():
        cache = json.loads((source/'cache.json').read_text())
        (stage/'cache.json').write_text(json.dumps(cache, indent=2)+'\n')
    counts = {}
    if (source/'portfolio.db').exists():
        with sqlite3.connect((source/'portfolio.db').as_uri()+'?mode=ro', uri=True) as old:
            with sqlite3.connect(stage/'portfolio.db') as new:
                old.backup(new)
                for table in ['issues', 'attempts', 'issue_events', 'batches']:
                    if new.execute('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=?', (table,)).fetchone():
                        counts[table] = new.execute('SELECT count(*) FROM '+table).fetchone()[0]
                if new.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise RuntimeError('Imported SQLite integrity check failed')
    record = {'source':str(source), 'importedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'sites':len(clean['sites']), 'ledger':counts, 'secretsImported':False,
              'snapshotOnly':True, 'sourceHashes':{}}
    for name in ['config.json', 'cache.json']:
        if (source/name).exists():
            record['sourceHashes'][name] = hashlib.sha256((source/name).read_bytes()).hexdigest()
    (stage/'migration.json').write_text(json.dumps(record,indent=2)+'\n')
    for path in stage.iterdir():
        path.chmod(0o600)
    os.rename(stage, destination)
    print(json.dumps({'destination':str(destination), **record}, indent=2))
finally:
    if stage.exists():
        shutil.rmtree(stage)
