// The native app shares the dashboard UI, but all data goes through MCP.
// It never fetches a loopback URL or opens an HTTP server.
export function createNativeApi(callTool, initialSnapshot = () => null) {
  async function call(name, args = {}) {
    const result = await callTool({name,arguments:args});
    if (result.isError) throw new Error(result.content?.find(item => item.type === 'text')?.text ?? 'Tool failed');
    if (result.structuredContent) return result.structuredContent;
    const text = result.content?.find(item => item.type === 'text')?.text;
    if (text === undefined) throw new Error('Tool returned no data');
    return JSON.parse(text);
  }
  return async (path, body) => {
    if (path === '/api/portfolio' && body === undefined) {
      const initial = initialSnapshot();
      if (initial) return initial;
      const [overview,report,issues] = await Promise.all([call('portfolio_overview'),call('portfolio_report'),call('issues_list',{limit:500})]);
      return {overview,...report,issues};
    }
    if (path === '/api/refresh' && body !== undefined) return call('portfolio_refresh',body);
    if (path === '/api/sites' && body !== undefined) return call('site_upsert',body);
    const issue = /^\/api\/issues\/(iss_[a-z0-9]+)$/.exec(path);
    if (issue) return body === undefined ? call('issue_detail',{issueId:issue[1]}) : call('issue_update',{issueId:issue[1],...body});
    const evidence = /^\/api\/evidence\/([a-z0-9-]+)$/.exec(path);
    if (evidence && body === undefined) return call('evidence_list',{siteId:evidence[1]});
    throw new Error('Unsupported dashboard route');
  };
}
