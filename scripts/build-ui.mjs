import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../',import.meta.url);
const result = await build({entryPoints:[fileURLToPath(new URL('ui/native-entry.js',root))],bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',minify:true,legalComments:'inline'});
const css = readFileSync(new URL('ui/style.css',root),'utf8');
const js = result.outputFiles[0].text.replaceAll('</script','<\\/script');
const html = readFileSync(new URL('ui/index.html',root),'utf8')
  .replace('<link rel="stylesheet" href="/style.css">',`<style>${css}</style>`)
  .replace('<script src="/app.js" defer></script>','')
  .replace('<a class="brand" href="/"','<a class="brand" href="#"')
  .replace('</body>',`<script>${js}</script></body>`);
writeFileSync(new URL('ui/native.html',root),html);
console.log(`Built native MCP app (${Math.round(Buffer.byteLength(html)/1024)} KB)`);
