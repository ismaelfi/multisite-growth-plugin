import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('MCP handshake, portfolio, local updates, schema rejection and evidence round-trip', async () => {
  const dir = mkdtempSync(join(tmpdir(),'growth-mcp-'));
  const transport = new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../scripts/mcp.mjs',import.meta.url))],env:{...process.env,WEBSITE_GROWTH_DATA_DIR:dir},stderr:'pipe'});
  const client = new Client({name:'growth-test',version:'1'});
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.length,12);
    const call = async (name,args={}) => {
      const response = await client.callTool({name,arguments:args});
      assert.ok(!response.isError,response.content[0].text);
      return JSON.parse(response.content[0].text);
    };
    assert.equal((await call('portfolio_overview')).sites.length,0);
    const added = await call('site_upsert',{name:'Example',domain:'example.com'});
    await call('site_upsert',{id:added.site.id,tags:['test']});
    assert.equal((await call('portfolio_overview')).sites[0].domain,'example.com');
    const missing = await client.callTool({name:'portfolio_refresh',arguments:{siteId:'missing'}});
    assert.equal(missing.isError,true);
    const record = await call('evidence_record',{siteId:added.site.id,source:'test-fixture',measurementType:'sampled',summary:'Synthetic fixture for round-trip testing',collectedAt:'2026-11-03T10:00:00Z',costUsd:0});
    assert.equal((await call('evidence_list',{siteId:added.site.id}))[0].id,record.id);
    const invalid = await client.callTool({name:'evidence_record',arguments:{siteId:added.site.id,source:'test',measurementType:'sampled',summary:'x',collectedAt:'not-a-date',costUsd:-1}});
    assert.equal(invalid.isError,true);
  } finally {await client.close();rmSync(dir,{recursive:true,force:true});}
});
