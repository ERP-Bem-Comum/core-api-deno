// Baixa o catálogo oficial de municípios do IBGE (view nivelado) e salva em
// .tmp/ibge-municipios.json. Roda no terminal do dev (precisa de rede).
//
//   node --experimental-strip-types scripts/data/fetch-ibge-municipios.ts
//
// É tooling de apoio ao ticket PARTNERS-MUNICIPALITY-LOOKUP — a transformação
// JSON → municipalities.data.ts é feita pelo módulo de domínio, não aqui.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { moduleDir } from '#src/shared/module-dir.ts';

const URL = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado';
const OUT = resolve(moduleDir(import.meta.url), '../../.tmp/ibge-municipios.json');

const main = async (): Promise<void> => {
  process.stdout.write(`Baixando ${URL}\n`);
  const res = await fetch(URL);
  if (!res.ok) {
    process.stderr.write(`HTTP ${String(res.status)} ${res.statusText}\n`);
    process.exit(1);
  }
  const text = await res.text();
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, text, 'utf8');

  const count = (text.match(/"municipio-id"/g) ?? []).length;
  process.stdout.write(`OK → ${OUT}\n`);
  process.stdout.write(`bytes=${String(text.length)} municipios≈${String(count)}\n`);
};

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
