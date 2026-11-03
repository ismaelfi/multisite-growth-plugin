#!/usr/bin/env python3
"""Export only reviewed application code; local portfolio files are never copied."""
import argparse
import json
from pathlib import Path
import shutil

parser = argparse.ArgumentParser()
parser.add_argument('destination', type=Path)
args = parser.parse_args()
source = Path(__file__).resolve().parent.parent
target = args.destination.resolve()
if target.exists():
    raise SystemExit('Release destination exists; choose an empty destination.')
target.mkdir(parents=True)
files = ['plugin.json', 'mcp.json', 'package.json', 'package-lock.json', 'README.md', 'PROVENANCE.md', 'LICENSE', '.gitignore']
for name in files:
    shutil.copy2(source/name, target/name)
for name in ['lib', 'scripts', 'skills', 'ui', 'test']:
    shutil.copytree(source/name, target/name, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
market = target/'.agents/plugins/marketplace.json'
market.parent.mkdir(parents=True)
market.write_text(json.dumps({'name':'multisite-growth','interface':{'displayName':'Multisite Growth'},'plugins':[{'name':'website-growth','source':{'source':'local','path':'.'},'policy':{'installation':'AVAILABLE','authentication':'ON_INSTALL'},'category':'Productivity'}]},indent=2)+'\n')
ci = target/'.github/workflows/ci.yml'
ci.parent.mkdir(parents=True)
ci.write_text('''name: Tests
on: [push, pull_request]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [22, 24]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - run: npm ci
      - run: npm test
''')
print(json.dumps({"release":str(target),"files":sum(p.is_file() for p in target.rglob("*"))}))
