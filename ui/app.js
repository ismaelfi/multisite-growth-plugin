const $ = selector => document.querySelector(selector);
let state;
let view = 'portfolio';
const active = issue => ['open','in_progress','regressed'].includes(issue.status);
const number = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(undefined,{maximumFractionDigits:1}) : '—';
const date = value => value ? new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}) : 'Not scanned';
function el(tag, className, text) {const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
function button(label,fn,className='text-button') {const b=el('button',className,label);b.type='button';b.addEventListener('click',()=>busy(b,fn));return b;}
function notice(message,error=false){const n=$('#notice');n.hidden=!message;n.textContent=message;n.classList.toggle('error',error);}
async function api(path,body){if(globalThis.websiteGrowthApi)return globalThis.websiteGrowthApi(path,body);const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json','x-website-growth':'dashboard'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Request failed');return data;}
async function busy(b,fn){const original=b.textContent;b.disabled=true;b.textContent='Working…';try{await fn();}catch(error){notice(error.message,true);}finally{b.disabled=false;b.textContent=original;}}
async function load(){state=await api('/api/portfolio');render();}
function render(){
 const rows=state.report?.sites??[];const measured=rows.filter(row=>row.gsc?.status==='ok');const issues=state.issues.filter(active);const config=state.overview.sites;
 $('#site-count').textContent=config.length;$('#issue-count').textContent=issues.length;$('#metric-sites').textContent=config.length;$('#website-total').textContent=`/ ${config.length}`;
 $('#metric-clicks').textContent=measured.length?number(measured.reduce((sum,row)=>sum+(row.gsc.clicks??0),0)):'—';
 $('#clicks-caption').textContent=measured.length?`${state.overview.days}-day window · ${measured.length} measured sites`:'Connect Search Console to measure';
 $('#metric-issues').textContent=issues.length;$('#metric-coverage').textContent=`${measured.length} / ${config.length}`;
 $('#scan-date').textContent=`Portfolio scan: ${date(state.report?.generatedAt)}`;
 if(state.report?.aggregatesStale)notice('Some websites were refreshed separately. Each card shows its own observation date; refresh the portfolio to align the full report.');
 renderSites();renderIssues();
}
function score(label,value,geo=false){const wrap=el('div');const top=el('div','score-label',label);top.append(el('b','',number(value)));const bar=el('div',`bar${geo?' geo':''}`);const fill=el('i');fill.style.width=`${typeof value==='number'?Math.max(0,Math.min(100,value)):0}%`;bar.append(fill);wrap.append(top,bar);return wrap;}
function renderSites(){
 const grid=$('#site-grid');grid.replaceChildren();const query=$('#search').value.toLowerCase();const filter=$('#site-filter').value;
 const sites=state.overview.sites.filter(site=>`${site.name} ${site.domain}`.toLowerCase().includes(query)).filter(site=>filter==='attention'?state.issues.some(issue=>issue.siteId===site.id&&active(issue)):filter==='reachable'?state.report?.sites.some(row=>row.id===site.id&&row.live?.reachable):true);
 sites.forEach((site,index)=>{
  const row=state.report?.sites.find(row=>row.id===site.id);const card=el('article','site-card');card.style.animationDelay=`${Math.min(index*35,180)}ms`;
  const head=el('div','site-heading');head.append(el('div','site-avatar',site.name.charAt(0).toUpperCase()));const title=el('div','site-title');title.append(el('h3','',site.name));
  if(site.domain){const link=el('a','',site.domain);link.href=`https://${site.domain}`;link.target='_blank';link.rel='noopener noreferrer';title.append(link);}head.append(title);if(site.tags?.length)head.append(el('span','tag',site.tags[0]));card.append(head);
  const scores=el('div','score-row');scores.append(score('SEO readiness',row?.seo?.score),score('GEO readiness',row?.geo?.score,true));card.append(scores);
  const traffic=el('div','traffic');const clicks=el('span');clicks.append(el('b','',row?.gsc?.status==='ok'?number(row.gsc.clicks):'—'),document.createTextNode(`clicks / ${state.overview.days}d`));traffic.append(clicks);
  const pct=row?.gsc?.clickDeltaPct;traffic.append(el('span',`delta${pct<0?' negative':''}`,typeof pct==='number'?`${pct>0?'+':''}${number(pct)}% vs prior`:row?.gsc?.status==='ok'?'No comparable baseline':'GSC not measured'));card.append(traffic);
  const next=el('div','next-action');next.append(el('span','next-label','NEXT STEP'),el('p','',row?.nextAction?.label??'Refresh this website to collect its first observations.'));card.append(next);
  const foot=el('div','card-foot');foot.append(el('span','',date(row?.live?.fetchedAt)),button('View details ↗',()=>showSite(site.id)));card.append(foot);grid.append(card);
 });
 if(!sites.length)grid.append(el('div','empty',state.overview.sites.length?'No websites match this filter.':'Your portfolio starts here. Add your first website above.'));
}
function issueNode(issue){
 const row=el('article','issue-row');const text=el('div','issue-text');text.append(el('h3',issue.severity==='critical'?'critical':'',issue.label),el('p','',`${issue.siteName} · ${issue.kind.toUpperCase()}`));row.append(text,el('span','issue-status',issue.status.replaceAll('_',' ')));
 const actions=el('div','issue-actions');
 if(active(issue)){actions.append(button('Verify',async()=>{const result=await api(`/api/issues/${issue.id}`,{action:'verify'});notice(result.fixed?'Verified: this specific finding now passes.':result.message);await load();}),button('Snooze',async()=>{await api(`/api/issues/${issue.id}`,{action:'snooze',hours:24});await load();}),button('Ignore',async()=>{await api(`/api/issues/${issue.id}`,{action:'ignore'});await load();}));}
 else actions.append(button('Reopen',async()=>{await api(`/api/issues/${issue.id}`,{action:'reopen'});await load();}));
 row.append(actions);return row;
}
function renderIssues(){const list=$('#issues-list');list.replaceChildren();const filter=$('#issue-filter').value;const issues=state.issues.filter(issue=>filter==='all'||(filter==='active'?active(issue):issue.status===filter));issues.forEach(issue=>list.append(issueNode(issue)));if(!issues.length)list.append(el('div','empty','No issues in this view.'));}
async function showSite(id){
 const site=state.overview.sites.find(site=>site.id===id);const row=state.report?.sites.find(site=>site.id===id);const content=$('#detail-content');content.replaceChildren();content.append(el('h2','',site.name),el('p','muted',site.domain),el('p','detail-path',site.path||'No local project folder linked'));
 const actions=el('div','detail-actions');actions.append(button('↻ Refresh this website',async()=>{await api('/api/refresh',{siteId:id});await load();await showSite(id);},'button primary'));content.append(actions);
 for(const [kind,label] of [['seo','SEO readiness'],['geo','GEO readiness']]){const section=el('section','detail-section');section.append(el('h3','',`${label} · ${number(row?.[kind]?.score)}`));for(const check of row?.[kind]?.checks??[]){const line=el('div','check');line.append(el('span',check.status,check.status),el('span','',check.label),el('span','muted',check.detail));section.append(line);}if(!row?.[kind])section.append(el('p','muted','No observations yet.'));content.append(section);}
 const backlog=el('section','detail-section');backlog.append(el('h3','','Active issues'));const issues=state.issues.filter(issue=>issue.siteId===id&&active(issue));issues.forEach(issue=>backlog.append(issueNode(issue)));if(!issues.length)backlog.append(el('p','muted','No active findings recorded.'));content.append(backlog);
 const evidence=el('section','detail-section');evidence.append(el('h3','','Research evidence'));content.append(evidence);
 const dialog=$('#detail-dialog');if(!dialog.open)dialog.showModal();
 try{const records=await api(`/api/evidence/${id}`);if(!records.length)evidence.append(el('p','muted','No research evidence saved yet. Ask Codex to research this site with Treg and save its sources.'));for(const record of records){const line=el('div','evidence-row',record.summary);line.append(el('small','',`${record.measurementType} · ${record.source} · ${date(record.collectedAt)}`));evidence.append(line);}}catch(error){evidence.append(el('p','muted',error.message));}
}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{view=b.dataset.view;document.querySelectorAll('[data-view]').forEach(n=>n.classList.toggle('active',n===b));$('#portfolio-view').hidden=view!=='portfolio';$('#issues-view').hidden=view!=='issues';$('#view-name').textContent=view==='portfolio'?'PORTFOLIO':'ISSUE LEDGER';}));
$('#search').addEventListener('input',renderSites);$('#site-filter').addEventListener('change',renderSites);$('#issue-filter').addEventListener('change',renderIssues);
$('#refresh-all').addEventListener('click',()=>busy($('#refresh-all'),async()=>{notice('Refreshing public pages and Search Console. This may take a moment…');await api('/api/refresh',{});notice('Portfolio observations updated.');await load();}));
$('#add-site').addEventListener('click',()=>$('#add-dialog').showModal());document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
$('#site-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;busy(form.querySelector('[type=submit]'),async()=>{await api('/api/sites',Object.fromEntries(new FormData(form)));$('#add-dialog').close();form.reset();notice('Website added. Refresh it to collect observations.');await load();});});
load().catch(error=>notice(`Could not load the local portfolio: ${error.message}`,true));
