import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeApi } from '../ui/native-api.js';

test('native UI uses the entrypoint snapshot without redundant requests',async()=>{
  const snapshot={overview:{sites:[]},report:null,issues:[]};
  const api=createNativeApi(()=>{throw new Error('Unexpected request');},()=>snapshot);
  assert.equal(await api('/api/portfolio'),snapshot);
});
test('native UI maps dashboard updates to the correct MCP tool',async()=>{
  const calls=[];
  const api=createNativeApi(async args=>{calls.push(args);return{content:[{type:'text',text:'{"ok":true}'}]};});
  await api('/api/issues/iss_abc',{action:'snooze',hours:24});
  await api('/api/refresh',{siteId:'example-com'});
  assert.deepEqual(calls,[{name:'issue_update',arguments:{issueId:'iss_abc',action:'snooze',hours:24}},{name:'portfolio_refresh',arguments:{siteId:'example-com'}}]);
  await assert.rejects(api('/api/arbitrary'),/Unsupported/);
});
test('native UI surfaces tool errors instead of treating them as data',async()=>{
  const api=createNativeApi(async()=>({isError:true,content:[{type:'text',text:'Data unavailable'}]}));
  await assert.rejects(api('/api/evidence/example-com'),/Data unavailable/);
});
