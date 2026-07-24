/**
 * W0 (RED) — Tests para `scripts/pipeline/dashboard.ts` + `dashboard-cli.ts`.
 *
 * Ticket: CTR-PIPELINE-DASHBOARD.
 *
 * Cobre CA-T1..T8:
 *   - T1: loadAllStates com 3 tickets válidos → 3 snapshots ordenados
 *   - T2: legacy (dir sem STATE.json) → skipped silenciosamente
 *   - T3: STATE.json corrompido → registrado em errors[] sem derrubar
 *   - T4: renderDashboardTable filter='open' → só in-progress/open
 *   - T5: renderDashboardTable filter='closed' → só closed-green/closed-rejected
 *   - T6: renderDashboardJson → JSON válido (summary + tickets[])
 *   - T7: daysOpen calculado com `now` injetado (ticket criado há 5 dias)
 *   - T8: CLI E2E — `dashboard-cli.ts` com `--json` em diretório vazio → summary.total=0, exit 0
 *
 * Estes tests DEVEM FALHAR em W0 — `scripts/pipeline/dashboard.ts` e
 * `scripts/pipeline/dashboard-cli.ts` ainda não existem.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PipelineState, WaveEntry, WaveId } from '../../scripts/pipeline/state-schema.ts';
import {
  loadAllStates,
  renderDashboardTable,
  renderDashboardJson,
  type DashboardFilter,
  type TicketSnapshot,
} from '../../scripts/pipeline/dashboard.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures helpers
// ──────────────────────────────────────────────────────────────────────────────

const WAVE_IDS: readonly WaveId[] = ['W0', 'W1', 'W2', 'W3'];

const pendingWave = (id: WaveId): WaveEntry => ({
  id,
  status: 'pending',
  agent: null,
  startedAt: null,
  finishedAt: null,
  rounds: 1,
  reportPath: null,
  outcome: null,
});

const makeState = (overrides: Partial<PipelineState> & { ticket: string }): PipelineState => ({
  schemaVersion: 1,
  size: 'S',
  createdAt: '2026-05-21T00:00:00.000Z',
  closedAt: null,
  currentWave: null,
  status: 'open',
  waves: WAVE_IDS.map(pendingWave),
  blockers: [],
  lastEvent: 'init',
  ...overrides,
});

const writeTicket = async (
  pipelineRoot: string,
  ticket: string,
  state: PipelineState | null,
): Promise<string> => {
  const dir = join(pipelineRoot, ticket);
  await mkdir(dir, { recursive: true });
  if (state !== null) {
    await writeFile(join(dir, 'STATE.json'), JSON.stringify(state, null, 2), 'utf8');
  }
  return dir;
};

const writeCorruptedTicket = async (pipelineRoot: string, ticket: string): Promise<string> => {
  const dir = join(pipelineRoot, ticket);
  await mkdir(dir, { recursive: true });
  // schemaVersion 2 — incompatible com parser v1
  await writeFile(
    join(dir, 'STATE.json'),
    JSON.stringify({ schemaVersion: 2, ticket, size: 'S' }),
    'utf8',
  );
  return dir;
};

const makePipelineRoot = async (): Promise<string> => {
  return await mkdtemp(join(tmpdir(), 'ctr-pipeline-dashboard-'));
};

// ──────────────────────────────────────────────────────────────────────────────
// CLI E2E helpers (mesmo pattern de tests/pipeline/state-cli.test.ts)
// ──────────────────────────────────────────────────────────────────────────────

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '..', '..');
const cliPath = resolve(repoRoot, 'scripts', 'pipeline', 'dashboard-cli.ts');

type RunResult = Readonly<{ code: number; stdout: string; stderr: string }>;

const runCli = async (cwd: string, args: readonly string[]): Promise<RunResult> => {
  const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', cliPath, ...args],
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
};

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('loadAllStates — leitura de múltiplos STATE.json', () => {
  it('CA-T1: 3 tickets válidos → 3 snapshots ordenados por nome do ticket', async () => {
    // Arrange
    const root = await makePipelineRoot();
    await writeTicket(root, 'CTR-ZULU', makeState({ ticket: 'CTR-ZULU' }));
    await writeTicket(root, 'CTR-ALPHA', makeState({ ticket: 'CTR-ALPHA' }));
    await writeTicket(root, 'CTR-MIKE', makeState({ ticket: 'CTR-MIKE' }));

    // Act
    const result = await loadAllStates(root);

    // Assert — 3 snapshots, ordenados alfabeticamente, sem erros
    assert.equal(result.snapshots.length, 3);
    assert.equal(result.errors.length, 0);
    assert.deepEqual(
      result.snapshots.map((s) => s.state.ticket),
      ['CTR-ALPHA', 'CTR-MIKE', 'CTR-ZULU'],
    );
  });

  it('CA-T2: diretório sem STATE.json é silenciosamente skipped (legacy)', async () => {
    // Arrange
    const root = await makePipelineRoot();
    await writeTicket(root, 'CTR-VALID', makeState({ ticket: 'CTR-VALID' }));
    await writeTicket(root, 'CTR-LEGACY', null); // diretório criado, sem STATE.json

    // Act
    const result = await loadAllStates(root);

    // Assert — só 1 snapshot, 0 erros (legacy é silencioso)
    assert.equal(result.snapshots.length, 1);
    assert.equal(result.snapshots[0]?.state.ticket, 'CTR-VALID');
    assert.equal(result.errors.length, 0);
  });

  it('CA-T3: STATE.json corrompido (schemaVersion: 2) → registrado em errors[] sem derrubar', async () => {
    // Arrange
    const root = await makePipelineRoot();
    await writeTicket(root, 'CTR-OK', makeState({ ticket: 'CTR-OK' }));
    await writeCorruptedTicket(root, 'CTR-BAD');

    // Act
    const result = await loadAllStates(root);

    // Assert — 1 snapshot válido + 1 erro com reason descritivo
    assert.equal(result.snapshots.length, 1);
    assert.equal(result.snapshots[0]?.state.ticket, 'CTR-OK');
    assert.equal(result.errors.length, 1);
    const error = result.errors[0];
    assert.ok(error !== undefined);
    assert.ok(
      error.reason.includes('SchemaVersionMismatch') || error.reason.includes('schemaVersion'),
      `reason deve referenciar o problema de schema; obtido: ${error.reason}`,
    );
    assert.ok(
      error.ticketDir.includes('CTR-BAD'),
      `ticketDir deve apontar para o ticket corrompido; obtido: ${error.ticketDir}`,
    );
  });
});

describe('renderDashboardTable — filtros', () => {
  const baseNow = new Date('2026-05-21T12:00:00.000Z');

  const makeSnapshot = (
    ticket: string,
    status: PipelineState['status'],
    currentWave: WaveId | null = null,
  ): TicketSnapshot => ({
    state: makeState({ ticket, status, currentWave }),
    ticketDir: `/tmp/.../${ticket}`,
    daysOpen: 0,
    w2Rounds: 1,
  });

  it('CA-T4: filter="open" inclui open + in-progress, exclui closed', () => {
    // Arrange
    const snapshots: readonly TicketSnapshot[] = [
      makeSnapshot('CTR-OPEN-1', 'open'),
      makeSnapshot('CTR-OPEN-2', 'in-progress', 'W1'),
      makeSnapshot('CTR-CLOSED-1', 'closed-green'),
    ];
    const filter: DashboardFilter = 'open';

    // Act
    const md = renderDashboardTable(snapshots, { filter, now: baseNow });

    // Assert
    assert.ok(md.includes('CTR-OPEN-1'), 'deve incluir ticket open');
    assert.ok(md.includes('CTR-OPEN-2'), 'deve incluir ticket in-progress');
    assert.ok(!md.includes('CTR-CLOSED-1'), 'deve excluir ticket closed-green');
  });

  it('CA-T5: filter="closed" inclui closed-green + closed-rejected, exclui open', () => {
    // Arrange
    const snapshots: readonly TicketSnapshot[] = [
      makeSnapshot('CTR-OPEN-1', 'open'),
      makeSnapshot('CTR-DONE-OK', 'closed-green'),
      makeSnapshot('CTR-DONE-REJ', 'closed-rejected'),
    ];
    const filter: DashboardFilter = 'closed';

    // Act
    const md = renderDashboardTable(snapshots, { filter, now: baseNow });

    // Assert
    assert.ok(md.includes('CTR-DONE-OK'), 'deve incluir closed-green');
    assert.ok(md.includes('CTR-DONE-REJ'), 'deve incluir closed-rejected');
    assert.ok(!md.includes('CTR-OPEN-1'), 'deve excluir ticket open');
  });
});

describe('renderDashboardJson — output estruturado', () => {
  const baseNow = new Date('2026-05-21T12:00:00.000Z');

  it('CA-T6: produz JSON válido com summary{total,open,closed,blocked} e tickets[]', () => {
    // Arrange — createdAt ajustado para que o recompute via `now` produza
    // daysOpen=2 no primeiro ticket. baseNow é 2026-05-21T12:00; createdAt
    // 2026-05-19T00:00 → diff 2.5 dias → floor = 2.
    const snapshots: readonly TicketSnapshot[] = [
      {
        state: makeState({
          ticket: 'CTR-A',
          status: 'in-progress',
          currentWave: 'W2',
          createdAt: '2026-05-19T00:00:00.000Z',
        }),
        ticketDir: '/tmp/a',
        daysOpen: 0, // ignorado pelo render — recomputado via now+createdAt
        w2Rounds: 1,
      },
      {
        state: makeState({
          ticket: 'CTR-B',
          status: 'closed-green',
          createdAt: '2026-05-20T00:00:00.000Z',
          closedAt: '2026-05-20T00:00:00.000Z',
        }),
        ticketDir: '/tmp/b',
        daysOpen: 0,
        w2Rounds: 2,
      },
    ];

    // Act
    const out = renderDashboardJson(snapshots, { filter: 'all', now: baseNow });

    // Assert — JSON parseável
    const parsed = JSON.parse(out) as {
      summary: { total: number; open: number; closed: number; blocked: number };
      tickets: readonly { ticket: string; status: string; daysOpen: number }[];
    };
    assert.equal(parsed.summary.total, 2);
    assert.equal(parsed.summary.open, 1);
    assert.equal(parsed.summary.closed, 1);
    assert.equal(parsed.summary.blocked, 0);
    assert.equal(parsed.tickets.length, 2);
    assert.equal(parsed.tickets[0]?.ticket, 'CTR-A');
    assert.equal(parsed.tickets[0]?.daysOpen, 2);
  });
});

describe('daysOpen — cálculo via now injetado', () => {
  it('CA-T7: ticket criado há 5 dias com now injetado retorna daysOpen=5', async () => {
    // Arrange
    const root = await makePipelineRoot();
    const createdAt = '2026-05-16T00:00:00.000Z'; // 5 dias antes de baseNow
    await writeTicket(root, 'CTR-OLD', makeState({ ticket: 'CTR-OLD', createdAt }));

    // Act — loadAllStates não calcula daysOpen (precisa de `now` no render).
    // Mas o snapshot exposto deve incluir `state.createdAt` e o cálculo
    // de daysOpen é deterministico via render with now injection.
    const result = await loadAllStates(root);
    const baseNow = new Date('2026-05-21T00:00:00.000Z');

    // Assert — render usa now injetado; daysOpen deve refletir 5 dias
    const md = renderDashboardTable(result.snapshots, { filter: 'all', now: baseNow });
    assert.ok(
      md.includes('| 5 ') || md.includes('5 days') || md.includes(' 5 |'),
      `output deve mostrar daysOpen=5 derivado de now injetado; obtido:\n${md}`,
    );
  });
});

describe('dashboard-cli — comando CLI', () => {
  it('CA-T8: `pnpm run pipeline:status --json` em diretório sem tickets → summary.total=0, exit 0', async () => {
    // Arrange — cria cwd com .claude/.pipeline vazio
    const cwdRoot = await mkdtemp(join(tmpdir(), 'ctr-pipeline-dashboard-cli-'));
    await mkdir(join(cwdRoot, '.claude', '.pipeline'), { recursive: true });

    // Act
    const r = await runCli(cwdRoot, ['--json']);

    // Assert — exit 0 (não é erro fatal), JSON parseável, summary zerado
    assert.equal(r.code, 0, `exit code esperado 0; stderr: ${r.stderr}`);
    const parsed = JSON.parse(r.stdout) as { summary: { total: number } };
    assert.equal(parsed.summary.total, 0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CTR-PIPELINE-SUPERSEDE-STATUS — status `superseded` no resumo e nos filtros.
// Hoje `summarize` joga qualquer status fora de open/closed no balde `blocked`;
// superseded é terminal e NÃO pode ser contado como blocked.
// ──────────────────────────────────────────────────────────────────────────────

describe('dashboard — superseded (CTR-PIPELINE-SUPERSEDE-STATUS)', () => {
  const now = new Date('2026-05-27T00:00:00.000Z');

  const supersededSnap = (): TicketSnapshot => ({
    state: makeState({
      ticket: 'CTR-SUPERSEDED',
      status: 'superseded',
      closedAt: '2026-05-27T00:00:00.000Z',
    }),
    ticketDir: '/tmp/CTR-SUPERSEDED',
    daysOpen: 0,
    w2Rounds: 1,
  });

  it('CA-D1: superseded NÃO conta como blocked e tem contagem própria no summary JSON', () => {
    const out = renderDashboardJson([supersededSnap()], { filter: 'all', now });
    const json = JSON.parse(out) as {
      summary: { open: number; closed: number; blocked: number; superseded?: number };
    };
    assert.equal(json.summary.blocked, 0, 'superseded não pode cair no balde blocked');
    assert.equal(json.summary.superseded, 1, 'summary deve expor contagem própria de superseded');
  });

  it('CA-D2: linha-resumo do markdown não classifica superseded como blocked', () => {
    const md = renderDashboardTable([supersededSnap()], { filter: 'all', now });
    assert.ok(md.includes('0 blocked'), `esperado "0 blocked" na linha-resumo, foi:\n${md}`);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CTR-PIPELINE-SUMMARIZE-EXHAUSTIVE — `summarize` exaustivo (sem `else` catch-all).
// O catch-all atual contaria qualquer status fora dos baldes conhecidos como
// `blocked` — o mesmo defeito que CTR-PIPELINE-SUPERSEDE-STATUS corrigiu pontualmente.
// ──────────────────────────────────────────────────────────────────────────────

describe('dashboard — summarize exaustivo (CTR-PIPELINE-SUMMARIZE-EXHAUSTIVE)', () => {
  const now = new Date('2026-05-27T00:00:00.000Z');

  const snapOf = (status: PipelineState['status'], ticket: string): TicketSnapshot => ({
    state: makeState({ ticket, status }),
    ticketDir: `/tmp/${ticket}`,
    daysOpen: 0,
    w2Rounds: 1,
  });

  it('CA-E1 (caracterização): cada status real cai no balde certo', () => {
    const snaps: readonly TicketSnapshot[] = [
      snapOf('open', 'A'),
      snapOf('in-progress', 'B'),
      snapOf('closed-green', 'C'),
      snapOf('closed-rejected', 'D'),
      snapOf('superseded', 'E'),
      snapOf('blocked', 'F'),
    ];
    const json = JSON.parse(renderDashboardJson(snaps, { filter: 'all', now })) as {
      summary: { total: number; open: number; closed: number; superseded: number; blocked: number };
    };
    assert.equal(json.summary.total, 6);
    assert.equal(json.summary.open, 2, 'open + in-progress');
    assert.equal(json.summary.closed, 2, 'closed-green + closed-rejected');
    assert.equal(json.summary.superseded, 1);
    assert.equal(json.summary.blocked, 1);
  });

  it('CA-E2: status fora do enum NÃO é silenciosamente contado como blocked', () => {
    // Cast deliberado: simula um status adicionado ao enum no futuro sem atualizar
    // `summarize`. Com o `else` catch-all atual vira blocked; com switch exaustivo,
    // o ESLint pegaria a omissão em compile-time e o runtime não o classifica como blocked.
    const mystery: TicketSnapshot = {
      state: makeState({
        ticket: 'CTR-MYSTERY',
        status: 'mystery-future' as PipelineState['status'],
      }),
      ticketDir: '/tmp/CTR-MYSTERY',
      daysOpen: 0,
      w2Rounds: 1,
    };
    const json = JSON.parse(renderDashboardJson([mystery], { filter: 'all', now })) as {
      summary: { blocked: number };
    };
    assert.equal(
      json.summary.blocked,
      0,
      'status desconhecido não pode ser silenciosamente classificado como blocked',
    );
  });
});
