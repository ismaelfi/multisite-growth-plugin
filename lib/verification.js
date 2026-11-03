// A priority changing is not proof that the previous finding was fixed.
export function findingResolved(site, key) {
  if (!site) return false;
  if (site.live?.status && (site.live.status < 200 || site.live.status >= 300)) return false;
  const [kind, id] = key.split(":");
  if (kind === "seo" || kind === "geo") {
    return site.live?.reachable === true && site[kind]?.checks?.some(check => check.id === id && check.status === "pass") === true;
  }
  if (key === "site:unreachable") return site.live?.reachable === true;
  if (key === "setup:domain") return Boolean(site.domain);
  if (key === "setup:folder") return site.local?.exists === true;
  if (key === "git:dirty") return site.local?.git?.dirty === 0;
  if (key === "gsc:traffic-drop") return site.gsc?.status === "ok" && Number.isFinite(site.gsc.clickDeltaPct) && site.gsc.clickDeltaPct > -20;
  if (key === "gsc:no-property" || key === "gsc:read-error" || key === "gsc:not-connected") return site.gsc?.status === "ok";
  return false;
}
