import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';

const dir=mkdtempSync(join(tmpdir(),'growth-dashboard-'));
process.env.WEBSITE_GROWTH_DATA_DIR=dir;
const {startDashboard}=await import('../lib/dashboard.js');
const {closeDb}=await import('../lib/db.js');

test('dashboard serves UI and validates local writes without allowing cross-origin access',async()=>{
 const {server,url}=await startDashboard(0);
 try {
  const page=await fetch(url);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);assert.match(await page.text(),/Website Growth/);
  const denied=await fetch(url+'api/sites',{method:'POST',headers:{'content-type':'application/json'},body:'{"domain":"example.com"}'});assert.equal(denied.status,403);
  const cross=await fetch(url+'api/portfolio',{headers:{origin:'https://example.org'}});assert.equal(cross.status,403);
  const dns=await new Promise((resolve,reject)=>{const req=request(url+'api/portfolio',{headers:{host:'example.org'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(dns,403);
  const post=body=>fetch(url+'api/sites',{method:'POST',headers:{'content-type':'application/json','x-website-growth':'dashboard'},body:JSON.stringify(body)});
  assert.equal((await post({domain:'invalid'})).status,500);
  assert.equal((await post({domain:'example.com',name:'Example'})).status,200);
  const state=await(await fetch(url+'api/portfolio')).json();assert.equal(state.overview.sites.length,1);assert.equal(state.overview.sites[0].domain,'example.com');
  assert.equal((await post({domain:'example.com',unexpected:true})).status,400);
  assert.equal((await fetch(url+'api/not-a-route')).status,404);
 } finally {await new Promise(resolve=>server.close(resolve));closeDb();rmSync(dir,{recursive:true,force:true});}
});
