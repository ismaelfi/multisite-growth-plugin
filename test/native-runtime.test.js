import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';

test('shipped native HTML initializes over postMessage and renders the portfolio without HTTP',async()=>{
  const html=readFileSync(new URL('../ui/native.html',import.meta.url),'utf8');
  const site={id:'example-com',name:'Example website',domain:'example.com',path:'',tags:[]};
  const overview={sites:[site],days:28};
  const report={report:null};
  const calls=[];
  const errors=[];
  const console=new VirtualConsole();
  console.on('jsdomError',error=>{if(error.type==='unhandled-exception')errors.push(error.message);});
  const dom=new JSDOM(html,{
    url:'https://sandbox.example/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console,
    beforeParse(window){
      window.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
      window.fetch=()=>{throw new Error('Native UI must not use HTTP');};
      window.postMessage=message=>{
        calls.push(message.method);
        let result;
        if(message.method==='ui/initialize')result={protocolVersion:'2026-01-26',hostInfo:{name:'test-host',version:'1'},hostCapabilities:{serverTools:{}},hostContext:{theme:'light',displayMode:'fullscreen'}};
        if(message.method==='tools/call'){
          const values={portfolio_overview:overview,portfolio_report:report,issues_list:[]};
          const value=values[message.params.name];
          assert.notEqual(value,undefined,`Unexpected tool: ${message.params.name}`);
          result={content:[{type:'text',text:JSON.stringify(value)}]};
        }
        if(result)queueMicrotask(()=>window.dispatchEvent(new window.MessageEvent('message',{source:window,data:{jsonrpc:'2.0',id:message.id,result}})));
      };
    }
  });
  try{
    const deadline=Date.now()+2000;
    while(dom.window.document.querySelector('#metric-sites').textContent!=='1'&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
    assert.deepEqual(errors,[]);
    assert.ok(calls.includes('ui/initialize'),'MCP app handshake must run');
    assert.equal(dom.window.document.querySelector('#metric-sites').textContent,'1',dom.window.document.querySelector('#notice').textContent);
    assert.equal(dom.window.document.querySelector('.site-title h3').textContent,'Example website');
  }finally{dom.window.close();}
});
