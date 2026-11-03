#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import * as p from '../lib/portfolio.js';
const [command = 'overview', arg, action] = process.argv.slice(2);
try {
  let result;
  switch (command) {
    case 'overview': result = p.overview(); break;
    case 'report': result = p.cachedReport(arg); break;
    case 'refresh': result = await p.refresh(arg); break;
    case 'issues': result = p.listIssues({siteId:arg}); break;
    case 'issue': result = action ? await p.issueAction(arg,action) : p.issueDetail(arg); break;
    case 'gsc': result = await p.gscDetails(arg); break;
    case 'treg': result = await p.tregStatus({refresh:true}); break;
    case 'evidence': result = p.readEvidence(arg); break;
    case 'save-evidence': result = await p.saveEvidence(JSON.parse(readFileSync(arg,'utf8'))); break;
    default: throw new Error('Commands: overview, report [siteId], refresh [siteId], issues [siteId], issue <id> [verify|ignore|reopen|snooze], gsc <siteId>, treg, evidence <siteId>, save-evidence <json-file>');
  }
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
} catch (error) { console.error(error.message); process.exitCode = 1; }
