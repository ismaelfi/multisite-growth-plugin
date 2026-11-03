import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { createNativeApi } from './native-api.js';

async function main() {
  const app = new App({name:'Website Growth',version:'0.3.2'});
  let snapshot;
  let booting = true;
  app.ontoolresult = result => { if (booting) snapshot = result.structuredContent; };
  function theme(context) {
    if (context?.theme) applyDocumentTheme(context.theme);
    if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  }
  app.addEventListener('hostcontextchanged',theme);
  globalThis.websiteGrowthApi = createNativeApi(args => app.callServerTool(args), () => {
    const value = snapshot;
    snapshot = null;
    return value;
  });
  await app.connect();
  theme(app.getHostContext());
  // Initialize the existing UI after its MCP transport is ready.
  await import('./app.js');
  booting = false;
  snapshot = null;
}
main().catch(error => {
  const notice = document.querySelector('#notice');
  notice.hidden = false;
  notice.textContent = `Could not connect the native app: ${error.message}`;
});
