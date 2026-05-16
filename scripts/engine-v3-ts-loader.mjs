import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const candidate = resolvePath(repoRoot, specifier.slice(2));
    const resolved = resolveExistingTypeScriptPath(candidate);
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }

  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const parentUrl = context.parentURL ?? pathToFileURL(`${repoRoot}/`).href;
    const candidateUrl = new URL(specifier, parentUrl);
    if (candidateUrl.protocol === 'file:') {
      const resolved = resolveExistingTypeScriptPath(candidateUrl.pathname);
      if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}

function resolveExistingTypeScriptPath(candidate) {
  if (existsSync(candidate)) return candidate;

  for (const suffix of ['.ts', '.tsx', '.mjs', '.js', '.json']) {
    const withSuffix = `${candidate}${suffix}`;
    if (existsSync(withSuffix)) return withSuffix;
  }

  return null;
}
