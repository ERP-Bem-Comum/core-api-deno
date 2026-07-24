/**
 * W0 (RED) - Tests para `scripts/pipeline/metrics.ts` + `metrics-cli.ts`.
 *
 * Ticket: CTR-PIPELINE-METRICS.
 *
 * Cobre CA-T1..T8:
 *   - T1: computeMetrics([]) retorna shape valido com tudo zerado
 *   - T2: byStatus agrega corretamente (open + closed-green + closed-rejected)
 *   - T3: bySize agrega corretamente
 *   - T4: W2 rounds avg + distribution (round1Only, round2, round3)
 *   - T5: totalDuration (avg/min/max/median) para tickets closed-green
 *   - T6: topAgents ordenado por count DESC
 *   - T7: rejectionRate corretamente calculado (sem divisao por zero)
 *   - T8: CLI E2E - metrics-cli.ts com --json retorna parseable JSON
 *
 * Estes tests DEVEM FALHAR em W0 - `scripts/pipeline/metrics.ts` e
 * `scripts/pipeline/metrics-cli.ts` ainda nao existem.
 *
 * ASCII puro em comentarios e strings de display (precaucao para o bug do
 * Node 24 strip-types que disparou em dashboard.ts).
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  PipelineState,
  TicketSize,
  TicketStatus,
  WaveEntry,
  WaveId,
  WaveOutcome,
} from '../../scripts/pipeline/state-schema.ts';
import type { TicketSnapshot } from '../../scripts/pipeline/dashboard.ts';
import {
  computeMetrics,
  renderMetricsJson,
  renderMetricsMd,
} from '../../scripts/pipeline/metrics.ts';

// ----------------------------------------------------------------------------
// Fixtures helpers
// ----------------------------------------------------------------------------

const WAVE_IDS: readonly WaveId[] = ['W0', 'W1', 'W2', 'W3'];

type WaveOverride = Readonly<{
  status?: WaveEntry['status'];
  agent?: string | null;
  rounds?: number;
  outcome?: WaveOutcome | null;
}>;

const makeWave = (id: WaveId, ov: WaveOverride = {}): WaveEntry => ({
  id,
  status: ov.status ?? 'pending',
  agent: ov.agent ?? null,
  startedAt: null,
  finishedAt: null,
  rounds: ov.rounds ?? 1,
  reportPath: null,
  outcome: ov.outcome ?? null,
});

type StateOverride = Readonly<{
  ticket: string;
  size?: TicketSize;
  status?: TicketStatus;
  createdAt?: string;
  closedAt?: string | null;
  waves?: readonly (WaveOverride & { id: WaveId })[];
}>;

const makeState = (ov: StateOverride): PipelineState => {
  const waveOverrides = new Map<WaveId, WaveOverride>((ov.waves ?? []).map((w) => [w.id, w]));
  return {
    schemaVersion: 1,
    ticket: ov.ticket,
    size: ov.size ?? 'S',
    createdAt: ov.createdAt ?? '2026-05-21T00:00:00.000Z',
    closedAt: ov.closedAt ?? null,
    currentWave: null,
    status: ov.status ?? 'open',
    waves: WAVE_IDS.map((id) => makeWave(id, waveOverrides.get(id) ?? {})),
    blockers: [],
    lastEvent: 'init',
  };
};

const makeSnapshot = (state: PipelineState): TicketSnapshot => {
  const w2 = state.waves.find((w) => w.id === 'W2');
  return {
    state,
    ticketDir: `/tmp/${state.ticket}`,
    daysOpen: 0,
    w2Rounds: w2?.rounds ?? 1,
  };
};

// ----------------------------------------------------------------------------
// CLI E2E helpers (mesmo pattern de tests/pipeline/dashboard.test.ts)
// ----------------------------------------------------------------------------

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '..', '..');
const cliPath = resolve(repoRoot, 'scripts', 'pipeline', 'metrics-cli.ts');

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

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('computeMetrics - shape e empty input', () => {
  it('CA-T1: computeMetrics([]) retorna shape valido com tudo zerado', () => {
    // Act
    const m = computeMetrics([]);

    // Assert
    assert.equal(m.total, 0);
    assert.equal(m.byStatus.open, 0);
    assert.equal(m.byStatus.inProgress, 0);
    assert.equal(m.byStatus.closedGreen, 0);
    assert.equal(m.byStatus.closedRejected, 0);
    assert.equal(m.byStatus.blocked, 0);
    assert.equal(m.bySize.XS, 0);
    assert.equal(m.bySize.S, 0);
    assert.equal(m.bySize.M, 0);
    assert.equal(m.bySize.L, 0);
    assert.equal(m.bySize.XL, 0);
    assert.equal(m.w2Rounds.count, 0);
    assert.equal(m.totalDuration.count, 0);
    assert.equal(m.topAgents.length, 0);
    assert.equal(m.rejectionRate, 0);
  });
});

describe('computeMetrics - byStatus', () => {
  it('CA-T2: 3 snapshots (1 open, 1 closed-green, 1 closed-rejected)', () => {
    // Arrange
    const snapshots: readonly TicketSnapshot[] = [
      makeSnapshot(makeState({ ticket: 'CTR-1', status: 'open' })),
      makeSnapshot(makeState({ ticket: 'CTR-2', status: 'closed-green' })),
      makeSnapshot(makeState({ ticket: 'CTR-3', status: 'closed-rejected' })),
    ];

    // Act
    const m = computeMetrics(snapshots);

    // Assert
    assert.equal(m.total, 3);
    assert.equal(m.byStatus.open, 1);
    assert.equal(m.byStatus.closedGreen, 1);
    assert.equal(m.byStatus.closedRejected, 1);
    assert.equal(m.byStatus.inProgress, 0);
    assert.equal(m.byStatus.blocked, 0);
  });
});

describe('computeMetrics - bySize', () => {
  it('CA-T3: 4 snapshots (1 XS, 2 S, 1 M)', () => {
    // Arrange
    const snapshots: readonly TicketSnapshot[] = [
      makeSnapshot(makeState({ ticket: 'CTR-1', size: 'XS' })),
      makeSnapshot(makeState({ ticket: 'CTR-2', size: 'S' })),
      makeSnapshot(makeState({ ticket: 'CTR-3', size: 'S' })),
      makeSnapshot(makeState({ ticket: 'CTR-4', size: 'M' })),
    ];

    // Act
    const m = computeMetrics(snapshots);

    // Assert
    assert.equal(m.bySize.XS, 1);
    assert.equal(m.bySize.S, 2);
    assert.equal(m.bySize.M, 1);
    assert.equal(m.bySize.L, 0);
    assert.equal(m.bySize.XL, 0);
  });
});

describe('computeMetrics - W2 rounds', () => {
  it('CA-T4: 3 W2 done com rounds 1/2/3 -> avg=2.0, round1Only=1, round2=1, round3=1', () => {
    // Arrange
    const snapshots: readonly TicketSnapshot[] = [
      makeSnapshot(
        makeState({
          ticket: 'CTR-R1',
          waves: [{ id: 'W2', status: 'done', rounds: 1, outcome: 'APPROVED' }],
        }),
      ),
      makeSnapshot(
        makeState({
          ticket: 'CTR-R2',
          waves: [{ id: 'W2', status: 'done', rounds: 2, outcome: 'APPROVED' }],
        }),
      ),
      makeSnapshot(
        makeState({
          ticket: 'CTR-R3',
          waves: [{ id: 'W2', status: 'done', rounds: 3, outcome: 'APPROVED' }],
        }),
      ),
    ];

    // Act
    const m = computeMetrics(snapshots);

    // Assert
    assert.equal(m.w2Rounds.count, 3);
    assert.equal(m.w2Rounds.avg, 2.0);
    assert.equal(m.w2Rounds.round1Only, 1);
    assert.equal(m.w2Rounds.round2, 1);
    assert.equal(m.w2Rounds.round3, 1);
  });
});

describe('computeMetrics - totalDuration', () => {
  it('CA-T5: 2 closed-green com 3 e 7 dias -> avg=5, min=3, max=7, median=5', () => {
    // Arrange - createdAt + closedAt produzem durations conhecidas
    const snapshots: readonly TicketSnapshot[] = [
      makeSnapshot(
        makeState({
          ticket: 'CTR-3D',
          status: 'closed-green',
          createdAt: '2026-05-10T00:00:00.000Z',
          closedAt: '2026-05-13T00:00:00.000Z',
        }),
      ),
      makeSnapshot(
        makeState({
          ticket: 'CTR-7D',
          status: 'closed-green',
          createdAt: '2026-05-10T00:00:00.000Z',
          closedAt: '2026-05-17T00:00:00.000Z',
        }),
      ),
      // ticket open NAO deve entrar nas estatisticas de duration
      makeSnapshot(makeState({ ticket: 'CTR-OPEN', status: 'open' })),
    ];

    // Act
    const m = computeMetrics(snapshots);

    // Assert
    assert.equal(m.totalDuration.count, 2);
    assert.equal(m.totalDuration.avgDays, 5);
    assert.equal(m.totalDuration.minDays, 3);
    assert.equal(m.totalDuration.maxDays, 7);
    assert.equal(m.totalDuration.medianDays, 5);
  });
});

describe('computeMetrics - topAgents', () => {
  it('CA-T6: agentes ordenados por count DESC', () => {
    // Arrange - tdd-strategist em 2 waves diferentes; code-reviewer em 1
    const snapshots: readonly TicketSnapshot[] = [
      makeSnapshot(
        makeState({
          ticket: 'CTR-A',
          waves: [
            { id: 'W0', status: 'done', agent: 'tdd-strategist' },
            { id: 'W2', status: 'done', agent: 'code-reviewer' },
          ],
        }),
      ),
      makeSnapshot(
        makeState({
          ticket: 'CTR-B',
          waves: [{ id: 'W0', status: 'done', agent: 'tdd-strategist' }],
        }),
      ),
    ];

    // Act
    const m = computeMetrics(snapshots);

    // Assert
    assert.ok(m.topAgents.length >= 2, 'deve ter pelo menos 2 agentes');
    assert.equal(m.topAgents[0]?.agent, 'tdd-strategist');
    assert.equal(m.topAgents[0]?.count, 2);
    assert.equal(m.topAgents[1]?.agent, 'code-reviewer');
    assert.equal(m.topAgents[1]?.count, 1);
  });
});

describe('computeMetrics - rejectionRate', () => {
  it('CA-T7: 4 W2 done (2 rounds=1, 2 rounds>1) -> rejectionRate=0.5; e [] -> 0 sem divisao por zero', () => {
    // Arrange
    const snapshots: readonly TicketSnapshot[] = [
      makeSnapshot(
        makeState({
          ticket: 'CTR-R1A',
          waves: [{ id: 'W2', status: 'done', rounds: 1 }],
        }),
      ),
      makeSnapshot(
        makeState({
          ticket: 'CTR-R1B',
          waves: [{ id: 'W2', status: 'done', rounds: 1 }],
        }),
      ),
      makeSnapshot(
        makeState({
          ticket: 'CTR-R2',
          waves: [{ id: 'W2', status: 'done', rounds: 2 }],
        }),
      ),
      makeSnapshot(
        makeState({
          ticket: 'CTR-R3',
          waves: [{ id: 'W2', status: 'done', rounds: 3 }],
        }),
      ),
    ];

    // Act
    const m = computeMetrics(snapshots);

    // Assert
    assert.equal(m.rejectionRate, 0.5, 'rejectionRate = 2/4 = 0.5');

    // E sem divisao por zero quando vazio
    const empty = computeMetrics([]);
    assert.equal(empty.rejectionRate, 0);
  });
});

describe('metrics-cli - comando CLI', () => {
  it('CA-T8: `pipeline:metrics --json` em diretorio com 1 ticket retorna JSON parseable, exit 0', async () => {
    // Arrange - cria cwd com .claude/.pipeline/<ticket>/STATE.json
    const cwdRoot = await mkdtemp(join(tmpdir(), 'ctr-pipeline-metrics-cli-'));
    const ticketDir = join(cwdRoot, '.claude', '.pipeline', 'CTR-FIXTURE');
    await mkdir(ticketDir, { recursive: true });
    const state = makeState({ ticket: 'CTR-FIXTURE', status: 'closed-green' });
    await writeFile(join(ticketDir, 'STATE.json'), JSON.stringify(state, null, 2), 'utf8');

    // Act
    const r = await runCli(cwdRoot, ['--json']);

    // Assert
    assert.equal(r.code, 0, `exit code esperado 0; stderr: ${r.stderr}`);
    const parsed = JSON.parse(r.stdout) as {
      total: number;
      byStatus: { closedGreen: number };
    };
    assert.equal(parsed.total, 1);
    assert.equal(parsed.byStatus.closedGreen, 1);

    // renderMetricsJson deve estar disponivel para uso programatico tambem
    const direct = renderMetricsJson(computeMetrics([makeSnapshot(state)]));
    const directParsed = JSON.parse(direct) as { total: number };
    assert.equal(directParsed.total, 1);
  });
});

// ----------------------------------------------------------------------------
// CTR-PIPELINE-SUPERSEDE-STATUS - status `superseded` nas metricas.
// Hoje `byStatusOf` tem switch sem default: status superseded some das contagens
// (total deixa de bater com a soma das linhas).
// ----------------------------------------------------------------------------

describe('metrics - superseded (CTR-PIPELINE-SUPERSEDE-STATUS)', () => {
  it('CA-M1: byStatus conta superseded em campo proprio', () => {
    const snaps = [
      makeSnapshot(
        makeState({ ticket: 'A', status: 'superseded', closedAt: '2026-05-22T00:00:00.000Z' }),
      ),
    ];
    const m = computeMetrics(snaps);
    assert.equal((m.byStatus as { superseded?: number }).superseded, 1);
  });

  it('CA-M2: total bate com a soma das contagens de status (superseded incluso)', () => {
    const snaps = [
      makeSnapshot(makeState({ ticket: 'A', status: 'open' })),
      makeSnapshot(
        makeState({ ticket: 'B', status: 'closed-green', closedAt: '2026-05-22T00:00:00.000Z' }),
      ),
      makeSnapshot(
        makeState({ ticket: 'C', status: 'superseded', closedAt: '2026-05-22T00:00:00.000Z' }),
      ),
    ];
    const m = computeMetrics(snaps);
    const bs = m.byStatus as {
      open: number;
      inProgress: number;
      closedGreen: number;
      closedRejected: number;
      blocked: number;
      superseded?: number;
    };
    const sum =
      bs.open +
      bs.inProgress +
      bs.closedGreen +
      bs.closedRejected +
      bs.blocked +
      (bs.superseded ?? 0);
    assert.equal(sum, m.total, 'soma das linhas de status deve igualar o total de tickets');
  });

  it('CA-M3: renderMetricsMd inclui linha de superseded na tabela Status', () => {
    const m = computeMetrics([
      makeSnapshot(
        makeState({ ticket: 'A', status: 'superseded', closedAt: '2026-05-22T00:00:00.000Z' }),
      ),
    ]);
    const md = renderMetricsMd(m);
    assert.match(md, /\| superseded \| 1 \|/, 'tabela Status deve ter linha superseded');
  });
});
