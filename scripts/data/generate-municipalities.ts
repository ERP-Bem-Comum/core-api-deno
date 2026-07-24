// Gera src/modules/partners/domain/geography/municipalities.data.ts a partir de
// .tmp/ibge-municipios.json (baixado por fetch-ibge-municipios.ts).
//
//   node --experimental-strip-types scripts/data/generate-municipalities.ts
//
// Build-time only: o transform IBGE→domínio acontece aqui; o runtime carrega o
// array já normalizado. O data file gerado É commitado (faz parte do source/seed).

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { moduleDir } from '#src/shared/module-dir.ts';

// O JSON nivelado do IBGE usa chaves com hífen (`municipio-id`, `UF-sigla`).
// Tipamos como Record frouxo (chaves hifenadas não passam no naming-convention) e
// lemos via bracket + String() na transformação.
type IbgeRow = Readonly<Record<string, string | number>>;

const IN = resolve(moduleDir(import.meta.url), '../../.tmp/ibge-municipios.json');
const OUT = resolve(
  moduleDir(import.meta.url),
  '../../src/modules/partners/domain/geography/municipalities.data.ts',
);

const main = async (): Promise<void> => {
  const rows = JSON.parse(await readFile(IN, 'utf8')) as readonly IbgeRow[];

  const tuples = rows
    .map(
      (r) =>
        [String(r['municipio-id']), String(r['municipio-nome']), String(r['UF-sigla'])] as const,
    )
    .sort((a, b) => a[0].localeCompare(b[0]));

  const lines = tuples.map(
    ([cod, name, uf]) =>
      `  [${JSON.stringify(cod)}, ${JSON.stringify(name)}, ${JSON.stringify(uf)}],`,
  );

  const body = `// GERADO — não editar à mão.
// Fonte: IBGE localidades/municipios (view=nivelado). Total: ${String(tuples.length)}.
// Regenerar: node --experimental-strip-types scripts/data/generate-municipalities.ts

// Tupla compacta [cod IBGE (7 dígitos), nome, sigla UF]. Normalização para o VO
// Municipality acontece em municipality.ts (runtime).
export const MUNICIPALITIES: readonly (readonly [cod: string, name: string, uf: string])[] = [
${lines.join('\n')}
];
`;

  await writeFile(OUT, body, 'utf8');
  process.stdout.write(`OK → ${OUT}\n${String(tuples.length)} municípios\n`);
};

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
