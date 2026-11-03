import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('import includes committed WAL history, excludes credentials and refuses replacement', () => {
  const dir = mkdtempSync(join(tmpdir(),'growth-import-'));
  const source = join(dir,'dsh'), dest = join(dir,'imported');
  mkdirSync(source);
  const original = JSON.stringify({version:1,sites:[{id:'a',name:'A',domain:'a.com',path:''}],days:28,google:{clientId:'excluded-client'}});
  writeFileSync(join(source,'config.json'),original);
  writeFileSync(join(source,'secrets.json'),'PRIVATE_OAUTH_VALUE');
  const old = new DatabaseSync(join(source,'portfolio.db'));
  try {
    old.exec("PRAGMA journal_mode=WAL; CREATE TABLE issues (id TEXT); INSERT INTO issues VALUES ('wal-issue');");
    const script = fileURLToPath(new URL('../scripts/import-dsh.py',import.meta.url));
    const run = () => spawnSync('python3',[script,'--source',source,'--destination',dest],{encoding:'utf8'});
    const result = run();
    assert.equal(result.status,0,result.stderr);
    const imported = new DatabaseSync(join(dest,'portfolio.db'),{readOnly:true});
    assert.equal(imported.prepare('SELECT id FROM issues').get().id,'wal-issue');
    imported.close();
    assert.equal(existsSync(join(dest,'secrets.json')),false);
    assert.equal(JSON.parse(readFileSync(join(dest,'config.json'))).google.clientId,'');
    assert.equal(statSync(join(dest,'config.json')).mode & 0o777,0o600);
    assert.equal(JSON.parse(readFileSync(join(dest,'migration.json'))).ledger.issues,1);
    assert.equal(readFileSync(join(source,'config.json'),'utf8'),original);
    assert.equal(run().status,1);
    assert.equal(old.prepare('SELECT count(*) n FROM issues').get().n,1);
  } finally {old.close();rmSync(dir,{recursive:true,force:true});}
});
