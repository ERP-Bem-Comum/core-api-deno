/**
 * W0 (RED) — Tests para `scripts/pipeline/state-cli.ts`.
 *
 * Ticket: CTR-PIPELINE-STATE-JSON.
 *
 * Cobre CA-T8..T12: CLI `pnpm run pipeline:state` com 6 subcomandos.
 * Cada teste roda o CLI via `execFile` em um diretório temporário isolado.
 *
 * **Convenção do CLI sob teste:**
 *   - cwd contém `<root>/.claude/.pipeline/<ticket>/` quando aplicável.
 *   - `init <ticket> --size S` cria STATE.json com 4 waves pending.
 *   - `wave-start <ticket> <wave> --agent <name>` rejeita se anterior não está done (exit 2).
 *   - `wave-finish <ticket> <wave> --outcome <X> --report <path>` avança currentWave.
 *   - `wave-round <ticket> <wave>` incrementa rounds; max 3, 4ª chamada falha (exit 2).
 *   - `close <ticket>` rejeita se alguma wave não está done (exit 2).
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '..', '..');
const cliPath = resolve(repoRoot, 'scripts', 'pipeline', 'state-cli.ts');

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

const makeTicketDir = async (ticket: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'ctr-pipeline-cli-'));
  const ticketDir = join(root, '.claude', '.pipeline', ticket);
  await mkdir(ticketDir, { recursive: true });
  return root;
};

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, 'utf8')) as T;

type WaveSnapshot = Readonly<{
  id: string;
  status: string;
  outcome: string | null;
  rounds: number;
}>;

type StateSnapshot = Readonly<{
  ticket: string;
  size: string;
  status: string;
  currentWave: string | null;
  closedAt: string | null;
  waves: readonly WaveSnapshot[];
}>;

describe('state-cli — comandos CLI', () => {
  it('CA-T8: `state init <ticket> --size S` cria STATE.json com 4 waves pending', async () => {
    // Arrange
    const ticket = 'CTR-CLI-T8';
    const root = await makeTicketDir(ticket);

    // Act
    const r = await runCli(root, ['init', ticket, '--size', 'S']);

    // Assert
    assert.equal(r.code, 0, `exit code esperado 0; stderr: ${r.stderr}`);

    const stateJson = join(root, '.claude', '.pipeline', ticket, 'STATE.json');
    assert.ok(existsSync(stateJson), 'STATE.json deve existir após init');

    const content = await readJson<StateSnapshot>(stateJson);
    assert.equal(content.ticket, ticket);
    assert.equal(content.size, 'S');
    assert.equal(content.status, 'open');
    assert.equal(content.waves.length, 4);
    assert.deepEqual(
      content.waves.map((w) => w.id),
      ['W0', 'W1', 'W2', 'W3'],
    );
    assert.ok(
      content.waves.every((w) => w.status === 'pending'),
      'todas as waves devem nascer pending',
    );
  });

  it('CA-T9: `state wave-start W1` rejeita se W0 não está done (exit code 2)', async () => {
    // Arrange
    const ticket = 'CTR-CLI-T9';
    const root = await makeTicketDir(ticket);
    await runCli(root, ['init', ticket, '--size', 'S']);

    // Act — tenta iniciar W1 sem fechar W0
    const r = await runCli(root, ['wave-start', ticket, 'W1', '--agent', 'ts-domain-modeler']);

    // Assert
    assert.equal(r.code, 2, `esperado exit 2; obtido ${r.code}; stderr: ${r.stderr}`);
    assert.ok(r.stderr.length > 0, 'stderr deve trazer mensagem de erro explicando o motivo');
  });

  it('CA-T10: `state wave-finish W0` avança currentWave para W1', async () => {
    // Arrange
    const ticket = 'CTR-CLI-T10';
    const root = await makeTicketDir(ticket);
    await runCli(root, ['init', ticket, '--size', 'S']);
    await runCli(root, ['wave-start', ticket, 'W0', '--agent', 'tdd-strategist']);

    // Act
    const r = await runCli(root, [
      'wave-finish',
      ticket,
      'W0',
      '--outcome',
      'RED',
      '--report',
      '002-tests/REPORT.md',
    ]);

    // Assert
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);

    const stateJson = join(root, '.claude', '.pipeline', ticket, 'STATE.json');
    const content = await readJson<StateSnapshot>(stateJson);
    assert.equal(content.currentWave, 'W1', 'currentWave deve avançar para W1');

    const w0 = content.waves.find((w) => w.id === 'W0');
    assert.equal(w0?.status, 'done');
    assert.equal(w0?.outcome, 'RED');
  });

  it('CA-T11: `state wave-round W2` incrementa até 3; 4ª chamada falha com exit 2', async () => {
    // Arrange
    const ticket = 'CTR-CLI-T11';
    const root = await makeTicketDir(ticket);
    await runCli(root, ['init', ticket, '--size', 'S']);
    await runCli(root, ['wave-start', ticket, 'W0', '--agent', 'tdd-strategist']);
    await runCli(root, [
      'wave-finish',
      ticket,
      'W0',
      '--outcome',
      'RED',
      '--report',
      '002-tests/REPORT.md',
    ]);
    await runCli(root, ['wave-start', ticket, 'W1', '--agent', 'ts-domain-modeler']);
    await runCli(root, [
      'wave-finish',
      ticket,
      'W1',
      '--outcome',
      'GREEN',
      '--report',
      '003-impl/REPORT.md',
    ]);
    await runCli(root, ['wave-start', ticket, 'W2', '--agent', 'code-reviewer']);

    // Act — round inicial é 1; chamadas sucessivas: 1→2, 2→3 (ok); 3→4 deve falhar
    const r2 = await runCli(root, ['wave-round', ticket, 'W2']);
    const r3 = await runCli(root, ['wave-round', ticket, 'W2']);
    const r4 = await runCli(root, ['wave-round', ticket, 'W2']);

    // Assert
    assert.equal(r2.code, 0, `2ª chamada (1→2): ${r2.stderr}`);
    assert.equal(r3.code, 0, `3ª chamada (2→3): ${r3.stderr}`);
    assert.equal(r4.code, 2, `4ª chamada deve falhar com exit 2; stderr: ${r4.stderr}`);

    const stateJson = join(root, '.claude', '.pipeline', ticket, 'STATE.json');
    const content = await readJson<StateSnapshot>(stateJson);
    const w2 = content.waves.find((w) => w.id === 'W2');
    assert.equal(w2?.rounds, 3, 'rounds deve ficar travado em 3 após tentativa de exceder');
  });

  it('CA-T12: `state close` rejeita ticket com waves pendentes (exit code 2)', async () => {
    // Arrange
    const ticket = 'CTR-CLI-T12';
    const root = await makeTicketDir(ticket);
    await runCli(root, ['init', ticket, '--size', 'S']);
    await runCli(root, ['wave-start', ticket, 'W0', '--agent', 'tdd-strategist']);
    await runCli(root, [
      'wave-finish',
      ticket,
      'W0',
      '--outcome',
      'RED',
      '--report',
      '002-tests/REPORT.md',
    ]);
    // W1, W2, W3 continuam pending

    // Act
    const r = await runCli(root, ['close', ticket]);

    // Assert
    assert.equal(r.code, 2, `esperado exit 2; obtido ${r.code}; stderr: ${r.stderr}`);

    const stateJson = join(root, '.claude', '.pipeline', ticket, 'STATE.json');
    const content = await readJson<StateSnapshot>(stateJson);
    assert.notEqual(content.status, 'closed-green', 'status não deve mudar para closed-green');
    assert.equal(content.closedAt, null, 'closedAt deve continuar null');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CTR-PIPELINE-WAVE-REOPEN — subcomando `wave-reopen <ticket> <Wn> [--agent <a>]`.
// Modela o ciclo W2 REJECTED → fix → re-review → APPROVED sem editar STATE.json à mão.
// ─────────────────────────────────────────────────────────────────────────────

const stateJsonPath = (root: string, ticket: string): string =>
  join(root, '.claude', '.pipeline', ticket, 'STATE.json');

// Leva o ticket até `<wave>` done com o outcome informado, partindo do init.
// Fecha as waves anteriores em sequência para respeitar a ordem do pipeline.
const driveToWaveDone = async (
  root: string,
  ticket: string,
  wave: 'W0' | 'W1' | 'W2' | 'W3',
  outcome: string,
): Promise<void> => {
  const order = ['W0', 'W1', 'W2', 'W3'] as const;
  const reports = [
    '002-tests/REPORT.md',
    '003-impl/REPORT.md',
    '004-code-review/REVIEW.md',
    '005-quality/REPORT.md',
  ];
  const agents = ['tdd-strategist', 'ts-domain-modeler', 'code-reviewer', 'ts-quality-checker'];
  const targetIdx = order.indexOf(wave);
  await runCli(root, ['init', ticket, '--size', 'S']);
  for (let i = 0; i <= targetIdx; i++) {
    await runCli(root, ['wave-start', ticket, order[i]!, '--agent', agents[i]!]);
    const waveOutcome =
      i === targetIdx ? outcome : i === 0 ? 'RED' : i === 1 ? 'GREEN' : 'APPROVED';
    await runCli(root, [
      'wave-finish',
      ticket,
      order[i]!,
      '--outcome',
      waveOutcome,
      '--report',
      reports[i]!,
    ]);
  }
};

describe('state-cli — wave-reopen (CTR-PIPELINE-WAVE-REOPEN)', () => {
  it('CA-1: reabre wave done+REJECTED → in-progress, rounds++, limpa outcome/finishedAt', async () => {
    // Arrange — W2 done REJECTED (W3 pending)
    const ticket = 'CTR-REOPEN-1';
    const root = await makeTicketDir(ticket);
    await driveToWaveDone(root, ticket, 'W2', 'REJECTED');

    // Act
    const r = await runCli(root, ['wave-reopen', ticket, 'W2', '--agent', 'code-reviewer']);

    // Assert
    assert.equal(r.code, 0, `esperado exit 0; stderr: ${r.stderr}`);
    const content = await readJson<StateSnapshot>(stateJsonPath(root, ticket));
    const w2 = content.waves.find((w) => w.id === 'W2');
    assert.equal(w2?.status, 'in-progress', 'W2 deve voltar a in-progress');
    assert.equal(w2?.outcome, null, 'outcome deve ser limpo');
    assert.equal(w2?.rounds, 2, 'rounds deve incrementar de 1 para 2');
    assert.equal(content.currentWave, 'W2', 'currentWave deve voltar para W2');
  });

  it('CA-2: após reopen, wave-finish APPROVED fecha a wave e re-renderiza STATE.md', async () => {
    // Arrange
    const ticket = 'CTR-REOPEN-2';
    const root = await makeTicketDir(ticket);
    await driveToWaveDone(root, ticket, 'W2', 'REJECTED');
    await runCli(root, ['wave-reopen', ticket, 'W2']);

    // Act
    const r = await runCli(root, [
      'wave-finish',
      ticket,
      'W2',
      '--outcome',
      'APPROVED',
      '--report',
      '004-code-review/REVIEW.md',
    ]);

    // Assert
    assert.equal(r.code, 0, `esperado exit 0; stderr: ${r.stderr}`);
    const content = await readJson<StateSnapshot>(stateJsonPath(root, ticket));
    const w2 = content.waves.find((w) => w.id === 'W2');
    assert.equal(w2?.status, 'done');
    assert.equal(w2?.outcome, 'APPROVED', 'outcome final deve ser APPROVED');
    assert.equal(content.currentWave, 'W3', 'currentWave deve avançar para W3');

    const md = await readFile(join(root, '.claude', '.pipeline', ticket, 'STATE.md'), 'utf8');
    assert.match(md, /APPROVED/, 'STATE.md deve refletir o novo outcome');
  });

  it('CA-3: recusa reabrir wave com outcome ≠ REJECTED (exit ≠ 0)', async () => {
    // Arrange — W0 done RED, sem waves posteriores não-pending
    const ticket = 'CTR-REOPEN-3';
    const root = await makeTicketDir(ticket);
    await driveToWaveDone(root, ticket, 'W0', 'RED');

    // Act
    const r = await runCli(root, ['wave-reopen', ticket, 'W0']);

    // Assert — exit 2 (violação de invariante) e mensagem específica de outcome,
    // não o exit 1 genérico de "subcomando desconhecido".
    assert.equal(r.code, 2, `esperado exit 2; obtido ${r.code}; stderr: ${r.stderr}`);
    assert.match(r.stderr, /REJECTED/i, 'stderr deve explicar que só REJECTED é reabrível');
    const content = await readJson<StateSnapshot>(stateJsonPath(root, ticket));
    const w0 = content.waves.find((w) => w.id === 'W0');
    assert.equal(w0?.status, 'done', 'W0 deve permanecer done');
    assert.equal(w0?.outcome, 'RED', 'outcome não deve mudar');
  });

  it('CA-4: recusa reabrir se alguma wave posterior não está pending (exit ≠ 0)', async () => {
    // Arrange — W1 done REJECTED, W2 in-progress (posterior não-pending)
    const ticket = 'CTR-REOPEN-4';
    const root = await makeTicketDir(ticket);
    await runCli(root, ['init', ticket, '--size', 'S']);
    await runCli(root, ['wave-start', ticket, 'W0', '--agent', 'tdd-strategist']);
    await runCli(root, [
      'wave-finish',
      ticket,
      'W0',
      '--outcome',
      'RED',
      '--report',
      '002-tests/REPORT.md',
    ]);
    await runCli(root, ['wave-start', ticket, 'W1', '--agent', 'ts-domain-modeler']);
    await runCli(root, [
      'wave-finish',
      ticket,
      'W1',
      '--outcome',
      'REJECTED',
      '--report',
      '003-impl/REPORT.md',
    ]);
    await runCli(root, ['wave-start', ticket, 'W2', '--agent', 'code-reviewer']);

    // Act — tenta reabrir W1 com W2 já in-progress
    const r = await runCli(root, ['wave-reopen', ticket, 'W1']);

    // Assert — exit 2 e mensagem citando a wave posterior, não o exit 1 genérico.
    assert.equal(r.code, 2, `esperado exit 2; obtido ${r.code}; stderr: ${r.stderr}`);
    assert.match(r.stderr, /posterior|W2/i, 'stderr deve mencionar a wave posterior que bloqueia');
    const content = await readJson<StateSnapshot>(stateJsonPath(root, ticket));
    const w1 = content.waves.find((w) => w.id === 'W1');
    assert.equal(w1?.status, 'done', 'W1 deve permanecer done');
  });

  it('CA-5: respeita MAX_ROUNDS = 3 — reopen na wave já em 3 rounds escala (exit ≠ 0)', async () => {
    // Arrange — W2 in-progress, eleva rounds a 3, finaliza REJECTED
    const ticket = 'CTR-REOPEN-5';
    const root = await makeTicketDir(ticket);
    await runCli(root, ['init', ticket, '--size', 'S']);
    await runCli(root, ['wave-start', ticket, 'W0', '--agent', 'tdd-strategist']);
    await runCli(root, [
      'wave-finish',
      ticket,
      'W0',
      '--outcome',
      'RED',
      '--report',
      '002-tests/REPORT.md',
    ]);
    await runCli(root, ['wave-start', ticket, 'W1', '--agent', 'ts-domain-modeler']);
    await runCli(root, [
      'wave-finish',
      ticket,
      'W1',
      '--outcome',
      'GREEN',
      '--report',
      '003-impl/REPORT.md',
    ]);
    await runCli(root, ['wave-start', ticket, 'W2', '--agent', 'code-reviewer']);
    await runCli(root, ['wave-round', ticket, 'W2']); // 1→2
    await runCli(root, ['wave-round', ticket, 'W2']); // 2→3
    await runCli(root, [
      'wave-finish',
      ticket,
      'W2',
      '--outcome',
      'REJECTED',
      '--report',
      '004-code-review/REVIEW.md',
    ]);

    // Act — W2 done+REJECTED com rounds=3; reopen excederia MAX_ROUNDS
    const r = await runCli(root, ['wave-reopen', ticket, 'W2']);

    // Assert
    assert.equal(r.code, 2, `esperado exit 2 (escala humano); stderr: ${r.stderr}`);
    const content = await readJson<StateSnapshot>(stateJsonPath(root, ticket));
    const w2 = content.waves.find((w) => w.id === 'W2');
    assert.equal(w2?.rounds, 3, 'rounds deve permanecer travado em 3');
    assert.equal(w2?.status, 'done', 'W2 não deve reabrir além do limite');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CTR-PIPELINE-SUPERSEDE-STATUS — subcomando `supersede <ticket> --by <outro>`.
// Encerra um ticket como substituído/duplicado por outro, sem exigir as 4 waves
// done — diferente de `close`, que só aceita ticket com pipeline completo.
// ─────────────────────────────────────────────────────────────────────────────

type SupersededSnapshot = StateSnapshot & { supersededBy?: string | null };

describe('state-cli — supersede (CTR-PIPELINE-SUPERSEDE-STATUS)', () => {
  it('CA-S1: supersede seta status superseded + supersededBy + closedAt sem exigir waves done', async () => {
    // Arrange — ticket alvo e ticket vencedor, ambos recém-criados (waves pending)
    const ticket = 'CTR-SUPERSEDE-1';
    const winner = 'CTR-SUPERSEDE-1-WINNER';
    const root = await makeTicketDir(ticket);
    await runCli(root, ['init', ticket, '--size', 'S']);
    await runCli(root, ['init', winner, '--size', 'S']);

    // Act — supersede num ticket com TODAS as waves pending
    const r = await runCli(root, ['supersede', ticket, '--by', winner]);

    // Assert
    assert.equal(r.code, 0, `esperado exit 0; stderr: ${r.stderr}`);
    const content = await readJson<SupersededSnapshot>(stateJsonPath(root, ticket));
    assert.equal(content.status, 'superseded', 'status deve virar superseded');
    assert.equal(content.supersededBy, winner, 'supersededBy deve apontar o ticket vencedor');
    assert.notEqual(content.closedAt, null, 'closedAt deve ser preenchido');
    assert.ok(
      content.waves.every((w) => w.status === 'pending'),
      'supersede não deve exigir nem alterar as waves',
    );
  });

  it('CA-S2: supersede sem --by falha citando a flag e não altera o status', async () => {
    // Arrange
    const ticket = 'CTR-SUPERSEDE-2';
    const root = await makeTicketDir(ticket);
    await runCli(root, ['init', ticket, '--size', 'S']);

    // Act
    const r = await runCli(root, ['supersede', ticket]);

    // Assert — erro específico de flag, não o exit genérico de "wave id obrigatória"
    assert.notEqual(r.code, 0, 'deve falhar sem --by');
    assert.match(r.stderr, /--by/, 'stderr deve citar a flag --by ausente');
    const content = await readJson<StateSnapshot>(stateJsonPath(root, ticket));
    assert.equal(content.status, 'open', 'status não deve mudar sem --by');
  });

  it('CA-S3: supersede recusa ticket já terminal (exit 2)', async () => {
    // Arrange — ticket levado a closed-green
    const ticket = 'CTR-SUPERSEDE-3';
    const winner = 'CTR-SUPERSEDE-3-WINNER';
    const root = await makeTicketDir(ticket);
    await driveToWaveDone(root, ticket, 'W3', 'ALL-GREEN');
    await runCli(root, ['close', ticket]);
    await runCli(root, ['init', winner, '--size', 'S']);

    // Act
    const r = await runCli(root, ['supersede', ticket, '--by', winner]);

    // Assert — não sobrescreve um terminal já alcançado
    assert.equal(r.code, 2, `esperado exit 2; stderr: ${r.stderr}`);
    const content = await readJson<StateSnapshot>(stateJsonPath(root, ticket));
    assert.equal(content.status, 'closed-green', 'ticket terminal não deve ser sobrescrito');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CTR-PIPELINE-SUPERSEDE-NO-SELF — recusa auto-referência (`--by` == ticket).
// ─────────────────────────────────────────────────────────────────────────────

describe('state-cli — supersede recusa auto-referência (CTR-PIPELINE-SUPERSEDE-NO-SELF)', () => {
  it('CA-S4: supersede <ticket> --by <ticket> (mesmo id) falha com exit 2 e não altera o status', async () => {
    const ticket = 'CTR-SUPERSEDE-SELF';
    const root = await makeTicketDir(ticket);
    await runCli(root, ['init', ticket, '--size', 'S']);

    const r = await runCli(root, ['supersede', ticket, '--by', ticket]);

    assert.equal(r.code, 2, `esperado exit 2 para auto-referência; stderr: ${r.stderr}`);
    const content = await readJson<StateSnapshot>(stateJsonPath(root, ticket));
    assert.equal(content.status, 'open', 'auto-referência não deve mudar o status');
  });
});
