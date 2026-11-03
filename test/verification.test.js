import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findingResolved } from '../lib/verification.js';

const dir = mkdtempSync(join(tmpdir(),'growth-verification-'));
process.env.WEBSITE_GROWTH_DATA_DIR = dir;
const db = await import('../lib/db.js');
test.after(() => {db.closeDb(); rmSync(dir,{recursive:true,force:true});});

test('changing top priority does not close an unresolved finding', () => {
  const base = {id:'a',name:'A',domain:'a.com',live:{reachable:true}};
  db.syncIssues({sites:[{...base,nextAction:{key:'seo:title',kind:'seo',severity:'warn',label:'Missing title'}}]});
  const id = db.issueIdFor('a','seo:title');
  db.syncIssues({sites:[{...base,nextAction:{key:'seo:description',kind:'seo',severity:'warn',label:'Missing description'},seo:{checks:[{id:'title',status:'fail'}]}}]});
  assert.equal(db.getIssue(id).status,'open');
  db.syncIssues({sites:[{...base,nextAction:{key:'seo:description',kind:'seo',severity:'warn',label:'Missing description'},seo:{checks:[{id:'title',status:'pass'}]}}]});
  assert.equal(db.getIssue(id).status,'fixed');
});

test('missing or unavailable evidence cannot verify a fix', () => {
  assert.equal(findingResolved({live:{reachable:true}},'seo:title'),false);
  assert.equal(findingResolved({live:{reachable:false},seo:{checks:[{id:'title',status:'pass'}]}},'seo:title'),false);
  assert.equal(findingResolved({live:{reachable:true,status:500},seo:{checks:[{id:'title',status:'pass'}]}},'seo:title'),false);
  assert.equal(findingResolved({gsc:{status:'error',clickDeltaPct:40}},'gsc:traffic-drop'),false);
  assert.equal(findingResolved({gsc:{status:'ok',clickDeltaPct:40}},'gsc:traffic-drop'),true);
});
