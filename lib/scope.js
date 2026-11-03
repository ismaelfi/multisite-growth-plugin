/**
 * The only folders an agent session may be opened for. This is a guardrail for
 * the portfolio UI, not a replacement for the DSH sandbox: the session still
 * inherits the workspace's own file policy.
 */
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

function real(value) {
  try {
    return realpathSync(value);
  } catch {
    return resolve(value);
  }
}

function roots() {
  const configured = process.env.WEBSITE_GROWTH_ROOTS || process.env.DSH_PORTFOLIO_ROOTS;
  if (configured && configured.trim()) return configured.split(/[:;]/u).map((entry) => real(entry.trim())).filter(Boolean);
  return [real(homedir() + "/Sites")];
}

/** @param {string} value */
function canonical(value) {
  try {
    return realpathSync(value);
  } catch {
    return resolve(value);
  }
}

/** @param {string} path */
export function pathScope(path) {
  if (!path || typeof path !== "string") return { allowed: false, path: "", root: "", reason: "No project folder is linked." };
  const target = canonical(path);
  const allowedRoots = roots();
  const root = allowedRoots.find((candidate) => target === candidate || target.startsWith(`${candidate}/`));
  return {
    allowed: Boolean(root),
    path: target,
    root: root || allowedRoots[0],
    reason: root ? "" : `Outside the allowed roots: ${allowedRoots.join(", ")}`,
  };
}

export { roots as allowedRoots };
