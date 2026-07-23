// Orquestrador único dos testes de integração (Fase 1 — repo cleanup).
// Substitui as ~10 linhas gigantes de `test:integration:*` no package.json por um manifesto
// declarativo + um runner. Uso: `node scripts/ci/test-integration.ts <suite>`.
//
// Cada suite declara: serviços Docker a subir (mysql|minio), se cria os secrets de TESTE,
// a env var de gate (MYSQL_INTEGRATION etc.), a concorrência e os paths de teste.
// O runner: cria secrets → `docker compose up --wait` → `node --test` → SEMPRE derruba e limpa.
//
// Sem dependências novas (ADR-0011): só node:child_process (spawnSync, shell:false) + node:fs.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import process from 'node:process';

const EX_USAGE = 64; // sysexits.h — uso inválido.

export type Suite = Readonly<{
  services: readonly ('mysql' | 'minio' | 'mailpit')[];
  secrets: boolean; // cria os secrets de teste do MySQL
  env: Readonly<Record<string, string>>;
  concurrency1: boolean; // --test-concurrency=1
  paths: readonly string[];
}>;

// Secrets de TESTE (valores fixos, não-prod) — espelham o que os scripts inline criavam.
const TEST_SECRETS: Readonly<Record<string, string>> = {
  'secrets/mysql_root_password.txt': 'rootpw-migration-test-only',
  'secrets/mysql_app_password.txt': 'apppw-migration-test-only',
  'secrets/mysql_readonly_password.txt': 'ropw-migration-test-only',
};

const mysqlSuite = (env: Readonly<Record<string, string>>, paths: readonly string[]): Suite => ({
  services: ['mysql'],
  secrets: true,
  env,
  concurrency1: true,
  paths,
});

// ETL sem Docker (ETL-LEGACY-DIRECT-CONNECTION): legado e core-api ficam em DBs distintos do
// MESMO MySQL de teste (compose.yaml). A fixture SINTÉTICA é carregada via mysql2 no `before`
// de cada suite (helper load-fixture) — sem `compose.etl.yaml`. root já tem DROP/CREATE DATABASE.
const ETL_TEST_MYSQL_PORT = process.env['MYSQL_PORT'] ?? '3306';
const ETL_DB_ENV: Readonly<Record<string, string>> = {
  PARTNERS_ETL_INTEGRATION: '1',
  ETL_LEGACY_CONNECTION_STRING: `mysql://root:rootpw-migration-test-only@127.0.0.1:${ETL_TEST_MYSQL_PORT}/legacy`,
  ETL_CORE_CONNECTION_STRING: `mysql://root:rootpw-migration-test-only@127.0.0.1:${ETL_TEST_MYSQL_PORT}/core`,
};

export const SUITES: Readonly<Record<string, Suite>> = {
  contracts: mysqlSuite({ MYSQL_INTEGRATION: '1' }, [
    'tests/modules/contracts/adapters/persistence/migrations/*.test.ts',
    'tests/modules/contracts/adapters/persistence/mysql-driver.test.ts',
    'tests/modules/contracts/adapters/persistence/drizzle-mysql.test.ts',
    'tests/modules/contracts/adapters/persistence/contract-contractor-schema.mysql.test.ts',
    'tests/modules/contracts/adapters/persistence/contract-repository-paged.integration.test.ts',
    'tests/modules/contracts/adapters/persistence/outbox-schema.test.ts',
    'tests/modules/contracts/adapters/persistence/repos/outbox-repository.drizzle.test.ts',
    'tests/modules/contracts/adapters/persistence/repos/find-expirable.mysql.test.ts',
    'tests/modules/contracts/adapters/persistence/job-run.drizzle-mysql.test.ts',
    // #437: contratantes com contrato Active (public-api) — fonte do anti-join do relatório
    // "Fornecedores sem Contrato" no módulo reports.
    'tests/modules/contracts/public-api/active-contractor-read.drizzle-mysql.test.ts',
    'tests/modules/contracts/worker/outbox-worker.integration.test.ts',
  ]),
  auth: mysqlSuite({ MYSQL_INTEGRATION: '1' }, [
    'tests/modules/auth/adapters/persistence/refresh-token-repository.drizzle.test.ts',
    'tests/modules/auth/adapters/persistence/user-repository.drizzle.test.ts',
    'tests/modules/auth/adapters/persistence/user-query.drizzle.test.ts',
    'tests/modules/auth/adapters/persistence/role-repository.drizzle.test.ts',
    'tests/modules/auth/adapters/persistence/approver-authority.drizzle.test.ts',
    'tests/modules/auth/adapters/persistence/schema-hardening.test.ts',
    'tests/modules/auth/public-api/auth-etl-port.integration.test.ts',
  ]),
  partners: mysqlSuite({ MYSQL_INTEGRATION: '1' }, [
    'tests/modules/partners/adapters/persistence/repos/financier-repository.drizzle.test.ts',
    'tests/modules/partners/adapters/persistence/repos/supplier-repository.drizzle.test.ts',
    'tests/modules/partners/adapters/persistence/outbox-repository.drizzle-mysql.test.ts',
    'tests/modules/partners/adapters/persistence/repos/collaborator-repository.drizzle.test.ts',
    'tests/modules/partners/adapters/persistence/repos/collaborator-invite-token-repository.drizzle.test.ts',
    'tests/modules/partners/adapters/persistence/repos/contract-count-store.drizzle.test.ts',
    // Backfill e2e ctr_contracts (read via public-api) → par_contract_count_view (#110). Aplica as
    // migrations de ambos os módulos no mesmo MySQL de teste; cobre a query GROUP BY + idempotência.
    'tests/jobs/partners/contract-count-backfill.integration.test.ts',
    'tests/modules/partners/adapters/persistence/repos/user-profile-repository.drizzle.test.ts',
    // Batch reader e2e (#356): getSuppliersView WHERE IN contra MySQL real (CA7 anti-N+1).
    'tests/modules/partners/adapters/persistence/repos/suppliers-batch-reader.drizzle.test.ts',
    'tests/modules/partners/public-api/partners-etl-port.integration.test.ts',
    // #238 REP-1: projeção de collaborators p/ o módulo reports (9 colunas LGPD-safe)
    'tests/modules/partners/public-api/collaborator-projection.drizzle-mysql.test.ts',
    'tests/modules/partners/public-api/partners-etl-store-integrity.integration.test.ts',
    'tests/modules/partners/public-api/partners-read-port.integration.test.ts',
  ]),
  programs: mysqlSuite({ MYSQL_INTEGRATION: '1' }, [
    'tests/modules/programs/adapters/persistence/drizzle-mysql.test.ts',
    'tests/modules/programs/adapters/persistence/program-list-read.drizzle-mysql.test.ts',
  ]),
  'budget-plans': mysqlSuite({ MYSQL_INTEGRATION: '1' }, [
    // #316 — árvore de custos (estava órfã: escrita na Fatia 2 mas nunca registrada no runner).
    'tests/modules/budget-plans/adapters/persistence/cost-structure.drizzle-mysql.test.ts',
    // #317 — BudgetResultRepository (add/list/delete) contra MySQL real.
    'tests/modules/budget-plans/adapters/persistence/budget-result.drizzle-mysql.test.ts',
    // #318 — ciclo de vida: FK auto-ref parent_id (0004) + listChildren + findRoot + alocação de versão.
    'tests/modules/budget-plans/adapters/persistence/plan-lifecycle.drizzle-mysql.test.ts',
    // #319 — Consolidado ABC: listApprovedByYear (WHERE status/year/program + ORDER BY id) + vigente por família.
    'tests/modules/budget-plans/adapters/persistence/consolidated.drizzle-mysql.test.ts',
    // #423 — contrato do BudgetPlanRepository contra MySQL real (estava órfão: nunca registrado). Cobre
    // listPaged rootsOnly=true (parent_id IS NULL) + upsert/listYears/ordenação sobre FK auto-referente.
    'tests/modules/budget-plans/adapters/persistence/drizzle-mysql.test.ts',
    // #377 BGP-DELETE-BUDGET-ATOMIC — removeBudget atômico: upsert do plano + delete dos
    // bgp_budget_results na MESMA tx; caminho feliz + rollback (evento malformado reverte tudo).
    'tests/modules/budget-plans/adapters/persistence/remove-budget-atomic.drizzle-mysql.test.ts',
    // BGP-ETL-LEGACY-ID (fatia 1/3 ETL) — legacy_id INT NULL + UNIQUE nas 6 tabelas bgp_*:
    // CA1 (information_schema) + CA2 (multiplos NULL) + CA3 (dup -> ER_DUP_ENTRY) + CA4 (regressao).
    'tests/modules/budget-plans/adapters/persistence/legacy-id.drizzle-mysql.test.ts',
    // BGP-ETL-WRITE-PORT (fatia 2/3 ETL) — buildBudgetPlansEtlPort: pool boot-scoped (CA1),
    // grava legacy_id (CA2), idempotencia por legacy_id (CA3), erro de conexao -> Result (CA5).
    'tests/modules/budget-plans/public-api/budget-plans-etl-port.integration.test.ts',
    // BGP-READ-PORT (fatia 1/3 REPORTS-REALIZED-VS-PLANNED) — buildBudgetPlansReadPort:
    // pool boot-scoped (CA1), 3 niveis da arvore (CA2), grade de 12 meses com zerados (CA3),
    // filtros combinaveis programa/plano/ano/Rede (CA4), plain rows (CA6).
    'tests/modules/budget-plans/public-api/budget-plans-read-port.integration.test.ts',
  ]),
  financial: mysqlSuite({ MYSQL_INTEGRATION: '1' }, [
    'tests/modules/financial/adapters/persistence/document-repository.drizzle-mysql.test.ts',
    // FIN-DOC-SUBCATEGORY-STAMP (#502 · S1) — coluna subcategory_ref em fin_documents +
    // fin_payable_view (CA1 information_schema) + regressão dos refs irmãos (CA8). Não executado
    // nesta janela (#500); registrado para o ritual manual / quando o runner de integração fechar.
    'tests/modules/financial/adapters/persistence/subcategory-ref-stamp.drizzle-mysql.test.ts',
    'tests/modules/financial/adapters/persistence/supplier-view-store.drizzle-mysql.test.ts',
    'tests/modules/financial/adapters/persistence/document-supplier-view-join.drizzle-mysql.test.ts',
    'tests/modules/financial/adapters/persistence/cedente-account-store.drizzle-mysql.test.ts',
    'tests/modules/financial/adapters/persistence/bank-statement-repository.drizzle-mysql.test.ts',
    'tests/modules/financial/adapters/persistence/reconciliation-repository.drizzle-mysql.test.ts',
    // #269 — ExpectedCounterpartStore (fin_expected_counterpart 0034 + outbox na tx)
    'tests/modules/financial/adapters/persistence/expected-counterpart-store.drizzle-mysql.test.ts',
    'tests/modules/financial/adapters/persistence/match-suggestion.drizzle-mysql.test.ts',
    'tests/modules/financial/adapters/persistence/payable-list-view.drizzle-mysql.test.ts',
    'tests/modules/financial/adapters/persistence/manual-entry.drizzle-mysql.test.ts',
    // FIN-MANUAL-ENTRY-TAXONOMY (#502 · S2) — colunas budget_plan_ref + subcategory_ref em
    // fin_manual_entries (CA1 information_schema) + regressão dos refs irmãos (CA8). Não executado
    // nesta janela (#500); registrado para o ritual manual / quando o runner de integração fechar.
    'tests/modules/financial/adapters/persistence/manual-entry-taxonomy.drizzle-mysql.test.ts',
    'tests/modules/financial/adapters/persistence/manual-payment.drizzle-mysql.test.ts',
    'tests/modules/financial/adapters/persistence/reconciliation-period.drizzle-mysql.test.ts',
    'tests/modules/financial/adapters/persistence/category-read.drizzle-mysql.test.ts',
    'tests/modules/financial/adapters/persistence/cost-center-read.drizzle-mysql.test.ts',
    // #127 — outbox transacional do financial (atomicidade estado+evento)
    'tests/modules/financial/adapters/persistence/fin-outbox-schema.drizzle-mysql.test.ts',
    'tests/modules/financial/adapters/persistence/document-outbox-atomic.drizzle-mysql.test.ts',
    'tests/modules/financial/adapters/persistence/reconciliation-outbox-atomic.drizzle-mysql.test.ts',
    'tests/modules/financial/adapters/persistence/statement-period-outbox-atomic.drizzle-mysql.test.ts',
    // #146 — PayableDocumentView (JOIN fin_payables × fin_documents para export CSV-Nibo)
    'tests/modules/financial/adapters/persistence/payable-document-view.drizzle-mysql.test.ts',
    // #357 — PayableSummaryByIdsView (JOIN fin_payables × fin_documents × fin_supplier_view p/ payables:batch)
    'tests/modules/financial/adapters/persistence/payable-summary-by-ids-view.drizzle-mysql.test.ts',
    'tests/modules/financial/adapters/persistence/document-summary-by-ids-view.drizzle-mysql.test.ts',
    // #240 REP-2: agregação "fornecedores sem contrato" (fin_payable_view ⟕ fin_supplier_view)
    'tests/modules/financial/public-api/suppliers-without-contract.drizzle-mysql.test.ts',
    // #243 REP-4: "posição de pagamentos" (fin_payable_view × cost_center × categoria, 3 baldes)
    'tests/modules/financial/public-api/payment-position.drizzle-mysql.test.ts',
    // REP-3 #114: "análise de planejamento" (fin_payable_view por categoria×CC×mês, DATE_FORMAT)
    'tests/modules/financial/public-api/payables-analysis.drizzle-mysql.test.ts',
    // #416 BGP-INSIGHTS-REALIZED: "realizado por plano" (Σ reconciled_value_cents Active, JOIN 3-hop
    // fin_reconciliation_items → fin_reconciliations → fin_payables → fin_documents.budget_plan_ref)
    'tests/modules/financial/public-api/realized-by-plan.drizzle-mysql.test.ts',
    // FIN-REALIZED-PROVISIONED-READ (fatia 2/3 REPORTS-REALIZED-VS-PLANNED): realizado + provisionado
    // por (budget_plan_ref, category_ref, mês). Realizado=Σ reconciled_value_cents Active (mês=reconciled_at);
    // provisionado=fin_payables Approved sem item Active (mês=due_date). Mesmo JOIN 3-hop do #416.
    'tests/modules/financial/public-api/realized-provisioned.drizzle-mysql.test.ts',
    // FIN-REALIZED-SUBCATEGORY-GRAIN (#502 · S5): grão desce a subcategoria (RealizedProvisionedRow
    // ganha subcategoryRef; realizado+provisionado agrupam por (plano, categoria, subcategoria, mês))
    // + inclui o realizado dos TÍTULOS MANUAIS (fin_manual_entries → fin_reconciliations Active,
    // regra: budget_plan_ref IS NOT NULL E type NOT IN Transfer/Investment/Redemption). Não executado
    // nesta janela (#500); registrado para o ritual manual / quando o runner de integração fechar.
    'tests/modules/financial/public-api/realized-provisioned-subcategory.drizzle-mysql.test.ts',
    'tests/workers/supplier-view-projection/projection.integration.test.ts',
  ]),
  'etl:orchestrate': mysqlSuite(ETL_DB_ENV, ['tests/etl/orchestrate.integration.test.ts']),
  'etl:contracts': mysqlSuite(ETL_DB_ENV, ['tests/etl/contracts/writer.integration.test.ts']),
  'etl:financial': mysqlSuite(ETL_DB_ENV, ['tests/etl/financial/writer.integration.test.ts']),
  // BGP-ETL-READER-MAPPER (fatia 3/3) — full-cycle legado -> bgp_* contra o banco de referencia:
  // CA1 (contagens 5/5/4679/36/38/390) + CA2 (isBalanced) + CA3 (idempotencia) + CA4 (model derivado).
  'etl:budget-plans': mysqlSuite(ETL_DB_ENV, ['tests/etl/budget-plans/writer.integration.test.ts']),
  storage: {
    services: ['minio'],
    secrets: false,
    env: { STORAGE_INTEGRATION: '1' },
    concurrency1: false,
    paths: ['tests/modules/contracts/adapters/storage/s3.integration.test.ts'],
  },
  photo: {
    services: ['minio'],
    secrets: false,
    env: { STORAGE_INTEGRATION: '1' },
    concurrency1: false,
    paths: ['tests/modules/auth/adapters/storage/profile-photo-storage.s3.integration.test.ts'],
  },
  logo: {
    services: ['minio'],
    secrets: false,
    env: { STORAGE_INTEGRATION: '1' },
    concurrency1: false,
    paths: ['tests/modules/programs/adapters/storage/logo-storage.s3.integration.test.ts'],
  },
  infra: {
    services: [],
    secrets: false,
    env: { COMPOSE_INTEGRATION: '1' },
    concurrency1: true,
    paths: ['tests/infra/mysql-compose.test.ts'],
  },
  notifications: {
    // sobe o Mailpit do compose (profile `mail`; nomeá-lo no `up` ativa o profile) — SMTP efêmero.
    services: ['mailpit'],
    secrets: false,
    env: {
      NOTIFICATIONS_INTEGRATION: '1',
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1025',
      SMTP_SECURE: 'false',
      SMTP_REQUIRE_TLS: 'false',
      // Mailpit aceita qualquer credencial (MP_SMTP_AUTH_ACCEPT_ANY) — valores dummy.
      SMTP_USER: 'ci',
      SMTP_PASS: 'ci',
      EMAIL_FROM: 'CI <ci@local>',
    },
    concurrency1: false,
    paths: ['tests/modules/notifications/**/*.test.ts'],
  },
  etl: {
    services: ['mysql'],
    secrets: true,
    env: ETL_DB_ENV,
    // Os dois readers recriam o MESMO DB `legacy` (load-fixture) no MySQL de teste —
    // rodar em paralelo colide; serializa (ETL-CONTRACTS-WRITER).
    concurrency1: true,
    paths: [
      'tests/etl/legacy/reader.integration.test.ts',
      'tests/etl/contracts/reader.integration.test.ts',
    ],
  },
};

const writeTestSecrets = (): void => {
  mkdirSync('secrets', { recursive: true });
  for (const [path, value] of Object.entries(TEST_SECRETS)) {
    writeFileSync(path, value);
    chmodSync(path, 0o644);
  }
};

const removeTestSecrets = (): void => {
  for (const path of Object.keys(TEST_SECRETS)) {
    rmSync(path, { force: true });
  }
};

const dockerUp = (services: readonly string[]): number =>
  spawnSync('docker', ['compose', 'up', '-d', ...services, '--wait'], { stdio: 'inherit' })
    .status ?? 1;

const dockerDown = (): void => {
  spawnSync('docker', ['compose', 'down', '-v'], { stdio: 'ignore' });
};

const runNodeTest = (suite: Suite): number => {
  const flags = [
    '--test',
    ...(suite.concurrency1 ? ['--test-concurrency=1'] : []),
    '--experimental-strip-types',
    '--enable-source-maps',
    '--no-warnings',
  ];
  return (
    spawnSync('node', [...flags, ...suite.paths], {
      stdio: 'inherit',
      env: { ...process.env, ...suite.env },
    }).status ?? 1
  );
};

const main = (): number => {
  const name = process.argv[2];
  const suite = name === undefined ? undefined : SUITES[name];
  if (suite === undefined) {
    process.stderr.write(
      `uso: node scripts/ci/test-integration.ts <suite>\nsuites: ${Object.keys(SUITES).join(', ')}\n`,
    );
    return EX_USAGE;
  }

  if (suite.secrets) writeTestSecrets();
  try {
    if (suite.services.length > 0) {
      const up = dockerUp(suite.services);
      if (up !== 0) return up;
    }
    return runNodeTest(suite);
  } finally {
    if (suite.services.length > 0) dockerDown();
    if (suite.secrets) removeTestSecrets();
  }
};

// Só executa quando invocado direto (não quando importado, ex.: pelo harness de
// assinatura de runtime que reusa o manifesto SUITES sem rodar as suítes).
if (import.meta.filename === process.argv[1]) process.exitCode = main();
