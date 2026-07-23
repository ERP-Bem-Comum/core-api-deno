// Harness diferencial de assinatura de runtime (inquiry 0023 — port Node → Deno).
//
// Roda uma LANE de testes sob Node e sob Deno, normaliza a saída JUnit dos dois
// para a MESMA unidade (teste-folha), e diffa a assinatura. O objetivo é medir
// REGRESSÃO num port de runtime: o mesmo `.ts` deve produzir a mesma assinatura
// sob os dois runtimes.
//
// A lição que este harness codifica: `failures=0` NÃO é o sinal — `leafTests` é.
// Um arquivo que não importa sob Deno simplesmente não roda, e a suíte fica verde
// com MENOS testes. Por isso a invariante trava em QUEDA de leafTests, não só em
// failures>0. (Mesmo padrão do `cancelled 1 / fail 0` que quase passou por verde.)
//
// Normalização cross-runner: Node emite só testcases-folha; Deno emite também um
// testcase-contêiner por `describe`. Regra agnóstica: um testcase é FOLHA se
// nenhum outro testcase começa com `nome + " > "`. No-op para o Node.
//
// Uso:
//   node --experimental-strip-types scripts/migration/runtime-signature.ts baseline <lane>
//   node --experimental-strip-types scripts/migration/runtime-signature.ts diff <lane>
//
// Sem dependências novas (ADR-0011): só node:*.

import { spawnSync } from 'node:child_process';
import { mkdir, readdir, writeFile, readFile, rm } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createConnection } from 'mysql2/promise';
import { SUITES } from '../ci/test-integration.ts';

const EX_USAGE = 64;
const EX_DATAERR = 65;
const EX_SOFTWARE = 70;

const BASELINE_DIR = 'scripts/migration/baselines';

// ── Lanes ────────────────────────────────────────────────────────────────────
// Uma lane é um conjunto de arquivos de teste + flags de env/runner. `domain` é pura
// (sem npm, sem DB); `all-unit` roda tudo (integração auto-skipa); as `int-*` vêm do
// manifesto SUITES e exigem MySQL real (túnel em 127.0.0.1:3306) + --allow-net no Deno.
type Lane = Readonly<{
  name: string;
  roots?: readonly string[]; // descobre *.test.ts sob estas pastas
  files?: readonly string[]; // OU lista explícita (suítes do manifesto)
  env: Readonly<Record<string, string>>;
  concurrency1?: boolean; // --test-concurrency=1 (evita corrida de migration)
  denoNet?: boolean; // Deno precisa de --allow-net p/ conectar no MySQL
  resetDb?: boolean; // DROP/CREATE core antes de cada run (contaminação cross-suite)
}>;

const baseLanes: Readonly<Record<string, Lane>> = {
  domain: { name: 'domain', roots: ['tests/modules'], env: {} }, // filtrado para **/domain/** abaixo
  'all-unit': { name: 'all-unit', roots: ['tests'], env: {} }, // integração auto-skipa sem *_INTEGRATION=1
};

// Lanes de integração derivadas do manifesto (as que usam MYSQL_INTEGRATION=1).
const integrationLanes = (): Record<string, Lane> => {
  const out: Record<string, Lane> = {};
  for (const [name, s] of Object.entries(SUITES)) {
    if (s.env['MYSQL_INTEGRATION'] !== '1') continue;
    out[`int-${name}`] = {
      name: `int-${name}`,
      files: s.paths,
      env: s.env,
      concurrency1: s.concurrency1,
      denoNet: true,
      resetDb: true,
    };
  }
  return out;
};

const LANES: Readonly<Record<string, Lane>> = { ...baseLanes, ...integrationLanes() };

type Signature = Readonly<{
  leafTests: number;
  failures: number;
  errors: number;
  skipped: number;
  filesRun: number;
}>;

type RunResult = Readonly<{ runtime: string; signature: Signature }>;

// ── Descoberta de arquivos ───────────────────────────────────────────────────
const findTestFiles = async (root: string, laneName: string): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries: Dirent[] = await readdir(dir, { withFileTypes: true }).catch(
      () => [] as Dirent[],
    );
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules') continue;
        await walk(full);
      } else if (e.name.endsWith('.test.ts')) {
        // lane `domain`: só arquivos sob um segmento `domain/`.
        if (laneName === 'domain' && !full.includes(`${path.sep}domain${path.sep}`)) continue;
        out.push(full);
      }
    }
  };
  await walk(root);
  return out.sort();
};

// ── Parse JUnit + normalização para teste-folha ──────────────────────────────
const decodeXml = (s: string): string =>
  s
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');

type TestCase = Readonly<{ name: string; failed: boolean; errored: boolean; skipped: boolean }>;

// Parse robusto por SPLIT em `<testcase` (aguenta a mistura self-closing `.../>` × corpo
// `...>...</testcase>` que quebrava o regex de corpo). Cada segmento = um testcase até o
// próximo; a falha/erro/skip é detectada até o `</testcase>` do próprio segmento.
const parseTestcases = (xml: string): TestCase[] => {
  const segs = xml.split('<testcase');
  const out: TestCase[] = [];
  for (const seg of segs.slice(1)) {
    const name = /^[^>]*?\bname="([^"]*)"/.exec(seg)?.[1];
    if (name === undefined) continue;
    const bodyEnd = seg.indexOf('</testcase>');
    const body = bodyEnd === -1 ? '' : seg.slice(0, bodyEnd); // self-closing → sem corpo → sem falha
    out.push({
      name: decodeXml(name),
      failed: /<failure\b/.test(body),
      errored: /<error\b/.test(body),
      skipped: /<skipped\b/.test(body),
    });
  }
  return out;
};

// Folha ⟺ nenhum outro testcase começa com `nome + " > "` (descarta os contêineres de
// `describe` que o Deno emite — e que herdam a falha do filho, inflando a contagem).
const keepLeaves = (cases: readonly TestCase[]): TestCase[] => {
  const names = new Set(cases.map((c) => c.name));
  return cases.filter((c) => ![...names].some((n) => n !== c.name && n.startsWith(`${c.name} > `)));
};

const signatureOf = (xml: string): Signature => {
  const leaves = keepLeaves(parseTestcases(xml));
  return {
    leafTests: leaves.length,
    failures: leaves.filter((c) => c.failed).length,
    errors: leaves.filter((c) => c.errored).length,
    skipped: leaves.filter((c) => c.skipped).length,
    filesRun: (xml.match(/<testsuite\b/g) ?? []).length,
  };
};

// ── Registro de runtimes ─────────────────────────────────────────────────────
// spawnSync com shell:false (idioma de scripts/ci/test-integration.ts). Cada runtime
// declara como monta os args e de onde vem o JUnit. Node/Bun escrevem em ARQUIVO
// (senão o stdout dos testes — logs de worker/email — corrompe o XML); Deno separa o
// reporter do stdout, então lê-se do stdout dele.
// node26 vem do fnm; sobrescreva com NODE26_BIN se necessário. Runtime sem binário é
// silenciosamente pulado no `matrix`.
const NODE26_BIN =
  process.env['NODE26_BIN'] ??
  `${process.env['HOME'] ?? ''}/.local/share/fnm/node-versions/v26.5.0/installation/bin/node`;

type RtSpec = Readonly<{
  bin: string;
  junitFromStdout: boolean;
  build: (files: readonly string[], lane: Lane, dest: string) => readonly string[];
}>;

const nodeArgs =
  (strip: boolean) =>
  (files: readonly string[], lane: Lane, dest: string): string[] => [
    '--test',
    ...(lane.concurrency1 === true ? ['--test-concurrency=1'] : []),
    ...(strip ? ['--experimental-strip-types'] : []), // Node 26 estabilizou o strip nativo
    '--no-warnings',
    '--test-reporter=junit',
    `--test-reporter-destination=${dest}`,
    ...files,
  ];

const RUNTIMES: Readonly<Record<string, RtSpec>> = {
  node: { bin: 'node', junitFromStdout: false, build: nodeArgs(true) },
  node26: { bin: NODE26_BIN, junitFromStdout: false, build: nodeArgs(false) },
  deno: {
    bin: 'deno',
    junitFromStdout: true,
    build: (files, lane) => [
      'test',
      '--allow-read',
      '--allow-env',
      '--allow-sys',
      ...(lane.denoNet === true ? ['--allow-net'] : []),
      '--no-check',
      '--reporter=junit',
      ...files,
    ],
  },
  bun: {
    bin: 'bun',
    junitFromStdout: false,
    build: (files, _lane, dest) => [
      'test',
      '--reporter=junit',
      `--reporter-outfile=${dest}`,
      ...files,
    ],
  },
};

const runJUnit = async (runtime: string, files: readonly string[], lane: Lane): Promise<string> => {
  const spec = RUNTIMES[runtime];
  if (spec === undefined) throw new Error(`runtime desconhecido: ${runtime}`);
  const spawnEnv = {
    env: { ...process.env, ...lane.env },
    encoding: 'utf8' as const,
    maxBuffer: 256 * 1024 * 1024,
  };
  if (spec.junitFromStdout) {
    const r = spawnSync(spec.bin, [...spec.build(files, lane, '')], spawnEnv);
    return r.stdout;
  }
  await mkdir(BASELINE_DIR, { recursive: true });
  const dest = path.join(BASELINE_DIR, `.junit-${runtime}-${process.pid}.xml`);
  spawnSync(spec.bin, [...spec.build(files, lane, dest)], spawnEnv);
  const xml = await readFile(dest, 'utf8').catch(() => '');
  await rm(dest, { force: true });
  return xml;
};

// DROP/CREATE `core` no MySQL de teste (via túnel 127.0.0.1:3306) — cada run de suíte
// de integração precisa de banco limpo (a mesma disciplina do runner do manifesto).
const resetDb = async (): Promise<void> => {
  const c = await createConnection({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'rootpw-migration-test-only',
  });
  await c.query('DROP DATABASE IF EXISTS `core`');
  await c.query('CREATE DATABASE `core` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  await c.end();
};

const runLane = async (runtime: string, lane: Lane): Promise<RunResult> => {
  const files =
    lane.files ??
    (await Promise.all((lane.roots ?? []).map(async (r) => findTestFiles(r, lane.name)))).flat();
  if (files.length === 0) {
    process.stderr.write(`[${runtime}] lane ${lane.name}: nenhum arquivo de teste encontrado\n`);
    process.exit(EX_DATAERR);
  }
  if (lane.resetDb === true) await resetDb();
  const xml = await runJUnit(runtime, [...files], lane);
  return { runtime, signature: signatureOf(xml) };
};

// ── Comandos ─────────────────────────────────────────────────────────────────
const fmt = (s: Signature): string =>
  `leafTests=${s.leafTests} failures=${s.failures} errors=${s.errors} skipped=${s.skipped} filesRun=${s.filesRun}`;

const baselinePath = (lane: string, runtime: string): string =>
  path.join(BASELINE_DIR, `${lane}.${runtime}.json`);

// Captura o baseline dos DOIS runtimes. `leafTests` NÃO é comparável cross-runner
// (Node nomeia o testcase só com o `it`; Deno com o caminho `describe > it`), então
// cada runtime guarda seu próprio número, usado para detectar QUEDA ao longo do tempo.
// O sinal cross-runner confiável é failures/errors.
const cmdBaseline = async (lane: Lane): Promise<number> => {
  process.stdout.write(`\n== BASELINE · lane ${lane.name} ==\n`);
  await mkdir(BASELINE_DIR, { recursive: true });
  for (const runtime of ['node', 'deno'] as const) {
    const { signature } = await runLane(runtime, lane);
    process.stdout.write(`  ${runtime}: ${fmt(signature)}\n`);
    await writeFile(baselinePath(lane.name, runtime), `${JSON.stringify(signature, null, 2)}\n`);
  }
  process.stdout.write(`  baselines gravados → ${BASELINE_DIR}/${lane.name}.{node,deno}.json\n`);
  return 0;
};

const loadBaseline = async (lane: string, runtime: string): Promise<Signature | undefined> => {
  try {
    return JSON.parse(await readFile(baselinePath(lane, runtime), 'utf8')) as Signature;
  } catch {
    return undefined;
  }
};

const cmdDiff = async (lane: Lane): Promise<number> => {
  const nodeBase = await loadBaseline(lane.name, 'node');
  const denoBase = await loadBaseline(lane.name, 'deno');
  if (nodeBase === undefined || denoBase === undefined) {
    process.stderr.write(`sem baseline completo — rode 'baseline ${lane.name}' primeiro\n`);
    return EX_DATAERR;
  }
  process.stdout.write(`\n== DIFF · lane ${lane.name} ==\n`);
  const { signature: d } = await runLane('deno', lane);
  process.stdout.write(`  baseline Node: ${fmt(nodeBase)}\n`);
  process.stdout.write(`  baseline Deno: ${fmt(denoBase)}\n`);
  process.stdout.write(`  atual    Deno: ${fmt(d)}\n`);

  const problems: string[] = [];
  // (1) Correção — cross-runner, comparável: Deno não pode introduzir falha/erro
  //     que o Node não tinha na mesma lane.
  if (d.failures > nodeBase.failures)
    problems.push(
      `REGRESSÃO: Deno tem mais falhas que o Node (${nodeBase.failures} → ${d.failures})`,
    );
  if (d.errors > nodeBase.errors)
    problems.push(`REGRESSÃO: Deno tem mais erros que o Node (${nodeBase.errors} → ${d.errors})`);
  // (2) Volume — per-runtime: Deno rodando MENOS que rodava antes ⇒ arquivo parou de carregar.
  if (d.leafTests < denoBase.leafTests)
    problems.push(
      `REGRESSÃO: Deno rodou menos testes que seu baseline (${denoBase.leafTests} → ${d.leafTests}) — arquivo não carregou?`,
    );

  if (problems.length === 0) {
    process.stdout.write(`  ✅ sem regressão (correção cross-runner ok; volume Deno estável)\n`);
    return 0;
  }
  for (const p of problems) process.stdout.write(`  ⚠️  ${p}\n`);
  return EX_SOFTWARE;
};

// ── bench: wall-clock por runtime (inquiry 0023 §5.3 "tempo de CI") ──────────
// Mede o tempo REAL de rodar a lane (spawn + compile/strip + execução) — que é o
// que o CI paga. 1ª iteração = COLD (Deno compila/cacheia TS; Node faz strip);
// as seguintes = WARM. Reporta as duas, porque o CI pode ser cold (cache frio) ou
// warm (cache quente entre jobs).
const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2 : (s[mid] ?? 0);
};

const cmdBench = async (lane: Lane, iterations: number): Promise<number> => {
  process.stdout.write(`\n== BENCH · lane ${lane.name} (${iterations}× por runtime) ==\n`);
  const files =
    lane.files ??
    (await Promise.all((lane.roots ?? []).map(async (r) => findTestFiles(r, lane.name)))).flat();
  for (const runtime of ['node', 'deno'] as const) {
    const times: number[] = [];
    for (let i = 0; i < iterations; i += 1) {
      if (lane.resetDb === true) await resetDb();
      const start = performance.now();
      await runJUnit(runtime, [...files], lane);
      times.push(performance.now() - start);
    }
    const cold = times[0] ?? 0;
    const warm = times.length > 1 ? median(times.slice(1)) : cold;
    process.stdout.write(
      `  ${runtime.padEnd(4)}: cold=${(cold / 1000).toFixed(2)}s  warm(med)=${(warm / 1000).toFixed(2)}s  (${times.map((t) => (t / 1000).toFixed(1)).join('/')}s)\n`,
    );
  }
  return 0;
};

// ── matrix: assinatura + tempo dos N runtimes lado a lado ────────────────────
// Estende o estudo do port para além de node/deno: node26 (TS nativo estável), bun.
// Runtime cujo binário não existe é pulado (reportado). 1º run = assinatura + cold;
// runs seguintes = warm.
const runtimeAvailable = (spec: RtSpec): boolean =>
  spawnSync(spec.bin, ['--version'], { encoding: 'utf8' }).status === 0;

const cmdMatrix = async (lane: Lane, iterations: number): Promise<number> => {
  process.stdout.write(`\n== MATRIX · lane ${lane.name} (${iterations}× por runtime) ==\n`);
  const files =
    lane.files ??
    (await Promise.all((lane.roots ?? []).map(async (r) => findTestFiles(r, lane.name)))).flat();
  process.stdout.write(`  runtime  | leaf/fail | cold    warm(med)\n`);
  for (const runtime of Object.keys(RUNTIMES)) {
    const spec = RUNTIMES[runtime];
    if (spec === undefined || !runtimeAvailable(spec)) {
      process.stdout.write(`  ${runtime.padEnd(8)} | (binário ausente — pulado)\n`);
      continue;
    }
    const times: number[] = [];
    const xmls: string[] = [];
    for (let i = 0; i < iterations; i += 1) {
      if (lane.resetDb === true) await resetDb();
      const start = performance.now();
      xmls.push(await runJUnit(runtime, [...files], lane));
      times.push(performance.now() - start);
    }
    const cold = times[0] ?? 0;
    const warm = times.length > 1 ? median(times.slice(1)) : cold;
    const sg = signatureOf(xmls[0] ?? '');
    process.stdout.write(
      `  ${runtime.padEnd(8)} | ${String(sg.leafTests).padStart(4)}/${sg.failures} | ${(cold / 1000).toFixed(2)}s  ${(warm / 1000).toFixed(2)}s\n`,
    );
  }
  return 0;
};

// ── main ─────────────────────────────────────────────────────────────────────
const main = async (): Promise<number> => {
  const [cmd, laneName] = process.argv.slice(2);
  if (cmd === undefined || laneName === undefined) {
    process.stderr.write(
      `uso: runtime-signature.ts <baseline|diff> <${Object.keys(LANES).join('|')}>\n`,
    );
    return EX_USAGE;
  }
  const lane = LANES[laneName];
  if (lane === undefined) {
    process.stderr.write(
      `lane desconhecida: ${laneName} (opções: ${Object.keys(LANES).join(', ')})\n`,
    );
    return EX_USAGE;
  }
  switch (cmd) {
    case 'baseline':
      return cmdBaseline(lane);
    case 'diff':
      return cmdDiff(lane);
    case 'bench': {
      const iters = Number(process.argv[4] ?? '3');
      return cmdBench(lane, Number.isFinite(iters) && iters > 0 ? iters : 3);
    }
    case 'matrix': {
      const iters = Number(process.argv[4] ?? '3');
      return cmdMatrix(lane, Number.isFinite(iters) && iters > 0 ? iters : 3);
    }
    default:
      process.stderr.write(`comando desconhecido: ${cmd}\n`);
      return EX_USAGE;
  }
};

process.exitCode = await main();
