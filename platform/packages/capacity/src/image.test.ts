import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Strukturprüfungen am Deployment-Image.
 *
 * Dieses Paket führt bereits den Abgleich „Code gegen Terraform" (capacity.test.ts).
 * Hier kommt der Abgleich „Workspace gegen Dockerfile" dazu. Beide Prüfungen fangen
 * dieselbe Fehlerklasse ab: eine Konfiguration, die für sich stimmt, aber nicht mehr
 * zu dem passt, was sie beschreiben soll.
 *
 * Der konkrete Anlass: Der Dockerfile kopierte 6 von 13 Workspace-Manifesten. Der
 * Build lief trotzdem durch, weil das spätere `COPY . .` die Verzeichnisse nachreicht
 * und pnpms Symlinks pfadbasiert sind — die Abhängigkeiten der übersprungenen Pakete
 * fehlten aber. Ein Fehler, der erst zur Laufzeit auffällt, und dann als
 * „Cannot find module".
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');

/** Workspace-Pakete laut Verzeichnisstruktur, ohne die aus pnpm ausgenommenen. */
function workspacePackages(): string[] {
  const workspaceYaml = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
  // Ausschlüsse der Form `- "!apps/mobile"`.
  const excluded = new Set(
    [...workspaceYaml.matchAll(/-\s*"!([^"]+)"/g)].map((m) => m[1] as string),
  );

  const found: string[] = [];
  for (const group of ['apps', 'packages']) {
    for (const name of readdirSync(join(root, group))) {
      const dir = `${group}/${name}`;
      if (excluded.has(dir)) continue;
      if (existsSync(join(root, dir, 'package.json'))) found.push(dir);
    }
  }
  return found.sort();
}

describe('Dockerfile deckt den Workspace ab', () => {
  const packages = workspacePackages();

  it('findet überhaupt Workspace-Pakete', () => {
    // Schutz vor einem stillen Erfolg: Ein leerer Ergebnissatz würde jede
    // folgende Prüfung trivial bestehen lassen.
    expect(packages.length).toBeGreaterThan(5);
  });

  it('kopiert jedes Workspace-Manifest vor dem Install', () => {
    const installIndex = dockerfile.indexOf('pnpm install');
    expect(installIndex, 'kein `pnpm install` im Dockerfile gefunden').toBeGreaterThan(0);
    const vorDemInstall = dockerfile.slice(0, installIndex);

    const fehlend = packages.filter((p) => !vorDemInstall.includes(`${p}/package.json`));
    expect(fehlend, `Diese Manifeste fehlen vor dem Install: ${fehlend.join(', ')}`).toEqual([]);
  });

  it('nimmt die aus pnpm ausgenommene Mobile-App nicht mit auf', () => {
    // apps/mobile hat eine eigene Toolchain und eigenen Lockfile; ein COPY hier
    // würde `--frozen-lockfile` gegen einen Workspace laufen lassen, zu dem sie
    // nicht gehört.
    expect(packages).not.toContain('apps/mobile');
  });
});

describe('Frontends sind im Image lauffähig', () => {
  it('baut beide Next.js-Apps', () => {
    // `next start` ohne vorherigen Build scheitert mit fehlendem `.next`.
    expect(dockerfile).toMatch(/pnpm --filter @vcp\/web build/);
    expect(dockerfile).toMatch(/pnpm --filter @vcp\/admin build/);
  });

  it('reicht die zur Build-Zeit eingebettete API-Basis als Build-Argument durch', () => {
    // NEXT_PUBLIC_API_BASE landet im Bundle (apps/web/lib/api.ts) und lässt sich
    // deshalb nicht über eine Laufzeit-Umgebungsvariable nachreichen.
    expect(dockerfile).toMatch(/ARG NEXT_PUBLIC_API_BASE/);
  });

  it('lässt die Frontends auf dem vorgegebenen Port hören', () => {
    // Cloud Run setzt $PORT und erwartet den Dienst genau dort. Ein fest
    // verdrahteter Port lässt den Startup-Probe scheitern.
    for (const app of ['web', 'admin']) {
      const pkg = JSON.parse(
        readFileSync(join(root, 'apps', app, 'package.json'), 'utf8'),
      ) as { scripts: Record<string, string> };
      expect(pkg.scripts.start, `apps/${app} start-Skript`).toContain('${PORT');
    }
  });
});
