import { readFileSync } from 'node:fs';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { overview, cachedReport, listIssues } from './portfolio.js';

export const APP_URI = 'ui://website-growth/portfolio-v0.3.1.html';
export function registerNativeUi(server) {
  const meta = {
    ui:{csp:{connectDomains:[],resourceDomains:[]}},
    'openai/ui':{preferredDisplayMode:'fullscreen',availableDisplayModes:['fullscreen','inline']}
  };
  registerAppResource(server,'Website Growth',APP_URI,{title:'Website Growth',_meta:meta},async()=>({
    contents:[{uri:APP_URI,mimeType:RESOURCE_MIME_TYPE,text:readFileSync(new URL('../ui/native.html',import.meta.url),'utf8'),_meta:meta}]
  }));
  registerAppTool(server,'portfolio_app',{
    title:'Website Growth',
    description:'Open the Website Growth app from the native sidebar or a conversation panel. Shows the local portfolio and issue ledger through MCP; no loopback server or paid research is started.',
    inputSchema:{},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
    _meta:{ui:{resourceUri:APP_URI},'openai/ui':{entrypoints:[{type:'global'},{type:'thread'}]}}
  },async()=>({
    structuredContent:{overview:overview(),...cachedReport(),issues:listIssues({limit:500})},
    content:[{type:'text',text:'Website Growth portfolio opened.'}]
  }));
}
