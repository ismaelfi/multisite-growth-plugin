import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

test('the actual shipped HTML contains a syntactically valid, self-contained app script',()=>{
  const html=readFileSync(new URL('../ui/native.html',import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)];
  assert.equal(scripts.length,1);
  assert.doesNotThrow(()=>new Script(scripts[0][1],{filename:'native-app.js'}));
  assert.ok(!/<script[^>]+src=/i.test(html));
  assert.ok(!/<link[^>]+rel="stylesheet"/i.test(html));
});
