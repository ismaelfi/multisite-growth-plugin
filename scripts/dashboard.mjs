#!/usr/bin/env node
import { startDashboard } from '../lib/dashboard.js';
const port = Number(process.env.WEBSITE_GROWTH_PORT ?? 54182);
const {server,url} = await startDashboard(port);
console.log(`Website Growth dashboard: ${url}`);
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => server.close(() => process.exit(0)));
