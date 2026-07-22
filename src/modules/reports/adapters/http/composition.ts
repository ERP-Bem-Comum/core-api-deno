/**
 * Composition root do módulo reports para a borda HTTP (ADR-0006/0025/0027, épico Relatórios #114).
 * Read-only, sem persistência/schema próprios — lê projeções de outros módulos via public-api (ACL):
 *  - REP-1 "Equipe ABC" (#238) ← `partners` (collaborators);
 *  - REP-2 "Fornecedores sem Contrato" (#240/#437) ← `financial` (candidatos: payables
 *    `contract_ref IS NULL`, `kind='Parent'`) MENOS `contracts` (contratantes com contrato Active),
 *    subtraídos em memória pelo use-case `listSuppliersWithoutActiveContract`;
 *  - REP-4 "Posição de Pagamentos" (#243) ← `financial` (fornecedor×CC×categoria, 3 baldes);
 *  - REP-3 "Análise de Planejamento" (#114) ← `financial` (categoria×CC×mês num período).
 *
 * Pools abertos UMA vez no boot (não por requisição — F1 do W2 #238 / incidente RDS 0001),
 * fechados no `shutdown()`. Molde: `buildPartnersReadPort`.
 */
import { ClockReal } from '#src/shared/adapters/clock-real.ts';
import type { Result } from '#src/shared/primitives/result.ts';
import {
  openCollaboratorProjectionReader,
  openCollaboratorDemographicsReader,
} from '#src/modules/partners/public-api/index.ts';
import {
  openSuppliersWithoutContractReader,
  openPaymentPositionReader,
  openPayablesAnalysisReader,
  openRealizedProvisionedReader,
} from '#src/modules/financial/public-api/index.ts';
import { buildBudgetPlansReadPort } from '#src/modules/budget-plans/public-api/read.ts';
import { buildContractsActiveContractorReadPort } from '#src/modules/contracts/public-api/index.ts';
import { TeamReportReadFromPartners } from '../persistence/team-report-read.partners.ts';
import { InMemoryTeamReportRead } from '../persistence/team-report-read.in-memory.ts';
import { TeamDemographicsReadFromPartners } from '../persistence/team-demographics-read.partners.ts';
import { InMemoryTeamDemographicsRead } from '../persistence/team-demographics-read.in-memory.ts';
import { SuppliersWithoutContractReadFromFinancial } from '../persistence/suppliers-without-contract-read.financial.ts';
import { InMemorySuppliersWithoutContractRead } from '../persistence/suppliers-without-contract-read.in-memory.ts';
import { ActiveContractorReadFromContracts } from '../persistence/active-contractor-read.contracts.ts';
import { InMemoryActiveContractorRead } from '../persistence/active-contractor-read.in-memory.ts';
import { PaymentPositionReadFromFinancial } from '../persistence/payment-position-read.financial.ts';
import { InMemoryPaymentPositionRead } from '../persistence/payment-position-read.in-memory.ts';
import {
  listSuppliersWithoutActiveContract,
  type ListSuppliersWithoutActiveContractError,
} from '../../application/use-cases/list-suppliers-without-active-contract.ts';
import { AnalysisReadFromFinancial } from '../persistence/analysis-read.financial.ts';
import { InMemoryAnalysisRead } from '../persistence/analysis-read.in-memory.ts';
import { RealizedReadFromSources } from '../persistence/realized-read.from-sources.ts';
import { InMemoryRealizedRead } from '../persistence/realized-read.in-memory.ts';
import type { TeamReportReadPort } from '../../application/ports/team-report-read.ts';
import type { TeamDemographicsReadPort } from '../../application/ports/team-demographics-read.ts';
import type {
  SupplierWithoutContract,
  SuppliersWithoutContractReadPort,
} from '../../application/ports/suppliers-without-contract-read.ts';
import type { ActiveContractorReadPort } from '../../application/ports/active-contractor-read.ts';
import type { PaymentPositionReadPort } from '../../application/ports/payment-position-read.ts';
import type { AnalysisReadPort } from '../../application/ports/analysis-read.ts';
import type { RealizedReadPort } from '../../application/ports/realized-read.ts';

export type ReportsDriver = 'memory' | 'mysql';

/**
 * União discriminada (#456): no driver `mysql` os quatro endereços são obrigatórios **por
 * construção** — o compilador garante o que até então eram quatro `throw` de boot aqui dentro.
 * A guarda de boot (`src/shared/persistence/module-driver-config.ts`) resolve a cascata
 * `REPORTS_*_DATABASE_URL` → `*_DATABASE_URL` do módulo-fonte e entrega o valor já pronto,
 * acumulando o que faltar com os erros dos outros módulos em vez de derrubar o boot sozinha.
 */
export type ReportsCompositionConfig =
  | Readonly<{ driver: 'memory' }>
  | Readonly<{
      driver: 'mysql';
      /** Connection string do `partners` — fonte do REP-1 (ADR-0014). */
      partnersUrl: string;
      /** Connection string do `financial` — fonte do REP-2/REP-4 e do realizado (S6, ADR-0014). */
      financialUrl: string;
      /** Connection string do `contracts` — subtraendo do anti-join do REP-2 (#437, ADR-0014). */
      contractsUrl: string;
      /** Connection string do `budget-plans` — fonte do orçado no Realizado × Planejado (S6). */
      budgetPlansUrl: string;
    }>;

export type ReportsHttpDeps = Readonly<{
  listTeam: TeamReportReadPort['list'];
  /** REP-1 demográficos: contagem agregada (nunca linha por pessoa) — gate LGPD dedicado. */
  listTeamDemographics: TeamDemographicsReadPort['list'];
  listSuppliersWithoutContract: () => Promise<
    Result<readonly SupplierWithoutContract[], ListSuppliersWithoutActiveContractError>
  >;
  listPaymentPosition: PaymentPositionReadPort['list'];
  listAnalysis: AnalysisReadPort['list'];
  /** S6 (#502): Realizado × Planejado — árvore de 3 níveis costurada de budget-plans × financial. */
  listRealized: RealizedReadPort['list'];
  shutdown: () => Promise<void>;
}>;

export const buildReportsHttpDeps = async (
  config: ReportsCompositionConfig,
): Promise<ReportsHttpDeps> => {
  if (config.driver === 'memory') {
    const team: TeamReportReadPort = InMemoryTeamReportRead();
    const demographics: TeamDemographicsReadPort = InMemoryTeamDemographicsRead();
    const suppliers: SuppliersWithoutContractReadPort = InMemorySuppliersWithoutContractRead();
    const activeContractors: ActiveContractorReadPort = InMemoryActiveContractorRead();
    const position: PaymentPositionReadPort = InMemoryPaymentPositionRead();
    const analysis: AnalysisReadPort = InMemoryAnalysisRead();
    const realized: RealizedReadPort = InMemoryRealizedRead();
    return {
      listTeam: team.list,
      listTeamDemographics: demographics.list,
      listSuppliersWithoutContract: listSuppliersWithoutActiveContract({
        suppliersRead: suppliers,
        activeContractorsRead: activeContractors,
      }),
      listPaymentPosition: position.list,
      listAnalysis: analysis.list,
      listRealized: realized.list,
      shutdown: () => Promise.resolve(),
    };
  }
  const { partnersUrl, financialUrl, contractsUrl, budgetPlansUrl } = config;

  // Defesa em profundidade (W2/C4): o tipo garante PRESENCA, nao conteudo — `partnersUrl: ''`
  // type-checka. O unico chamador de producao (`server.ts`) recebe da guarda de boot, que ja trata
  // `''` como ausente e acusa a variavel pelo nome; esta linha existe para o chamador FUTURO (worker,
  // harness, job) que leia env por conta propria e chegaria ao mysql2 com `uri: ''` e um erro
  // ininteligivel. Nao e' a validacao de ambiente que a T028 tirou daqui — aquela nomeava env e
  // derrubava o boot uma fonte por vez; esta e' uma assertiva de invariante do contrato do adapter,
  // inalcancavel pelo boot, e mantem o reports simetrico aos outros quatro composition roots.
  if ([partnersUrl, financialUrl, contractsUrl, budgetPlansUrl].some((url) => url.length === 0)) {
    throw new Error('reports-composition: driver mysql exige as 4 connection strings nao-vazias');
  }

  const teamReaderR = await openCollaboratorProjectionReader({
    connectionString: partnersUrl,
  });
  if (!teamReaderR.ok) {
    throw new Error(`reports-composition: falha ao abrir reader do partners: ${teamReaderR.error}`);
  }
  const teamReader = teamReaderR.value;

  // Pool próprio do reader demográfico, também aberto UMA vez no boot (incidente RDS 0001).
  // `referenceDate` da faixa etária sai do ClockReal, injetado aqui — nunca de `new Date()` lá.
  const demographicsReaderR = await openCollaboratorDemographicsReader({
    connectionString: partnersUrl,
    clock: ClockReal(),
  });
  if (!demographicsReaderR.ok) {
    await teamReader.close();
    throw new Error(
      `reports-composition: falha ao abrir reader (demographics) do partners: ${demographicsReaderR.error}`,
    );
  }
  const demographicsReader = demographicsReaderR.value;

  const suppliersReaderR = await openSuppliersWithoutContractReader({
    connectionString: financialUrl,
  });
  if (!suppliersReaderR.ok) {
    await teamReader.close();
    await demographicsReader.close();
    throw new Error(
      `reports-composition: falha ao abrir reader (suppliers) do financial: ${suppliersReaderR.error}`,
    );
  }
  const suppliersReader = suppliersReaderR.value;

  const positionReaderR = await openPaymentPositionReader({
    connectionString: financialUrl,
    clock: ClockReal(),
  });
  if (!positionReaderR.ok) {
    await teamReader.close();
    await demographicsReader.close();
    await suppliersReader.close();
    throw new Error(
      `reports-composition: falha ao abrir reader (payment-position) do financial: ${positionReaderR.error}`,
    );
  }
  const positionReader = positionReaderR.value;

  const contractorsReaderR = await buildContractsActiveContractorReadPort({
    connectionString: contractsUrl,
  });
  if (!contractorsReaderR.ok) {
    await teamReader.close();
    await demographicsReader.close();
    await suppliersReader.close();
    await positionReader.close();
    throw new Error(
      `reports-composition: falha ao abrir reader (active-contractor) do contracts: ${contractorsReaderR.error}`,
    );
  }
  const contractorsReader = contractorsReaderR.value;

  const analysisReaderR = await openPayablesAnalysisReader({ connectionString: financialUrl });
  if (!analysisReaderR.ok) {
    await teamReader.close();
    await demographicsReader.close();
    await suppliersReader.close();
    await positionReader.close();
    await contractorsReader.close();
    throw new Error(
      `reports-composition: falha ao abrir reader (analysis) do financial: ${analysisReaderR.error}`,
    );
  }
  const analysisReader = analysisReaderR.value;

  // S6 (#502): duas fontes do Realizado × Planejado — orçado (budget-plans) + realizado/provisionado
  // (financial). Pools próprios abertos UMA vez no boot (incidente RDS 0001), fechados no shutdown.
  const budgetPlansReadR = await buildBudgetPlansReadPort({ connectionString: budgetPlansUrl });
  if (!budgetPlansReadR.ok) {
    await teamReader.close();
    await demographicsReader.close();
    await suppliersReader.close();
    await positionReader.close();
    await contractorsReader.close();
    await analysisReader.close();
    throw new Error(
      `reports-composition: falha ao abrir read port (planned-amounts) do budget-plans: ${budgetPlansReadR.error}`,
    );
  }
  const budgetPlansRead = budgetPlansReadR.value;

  const realizedReaderR = await openRealizedProvisionedReader({ connectionString: financialUrl });
  if (!realizedReaderR.ok) {
    await teamReader.close();
    await demographicsReader.close();
    await suppliersReader.close();
    await positionReader.close();
    await contractorsReader.close();
    await analysisReader.close();
    await budgetPlansRead.close();
    throw new Error(
      `reports-composition: falha ao abrir reader (realized-provisioned) do financial: ${realizedReaderR.error}`,
    );
  }
  const realizedReader = realizedReaderR.value;

  const teamPort = TeamReportReadFromPartners(teamReader.list);
  const demographicsPort = TeamDemographicsReadFromPartners(demographicsReader.list);
  const suppliersPort = SuppliersWithoutContractReadFromFinancial(suppliersReader.list);
  const contractorsPort = ActiveContractorReadFromContracts(
    contractorsReader.listContractorsWithActiveContract,
  );
  const positionPort = PaymentPositionReadFromFinancial(positionReader.list);
  const analysisPort = AnalysisReadFromFinancial(analysisReader.list);
  const realizedPort = RealizedReadFromSources(
    budgetPlansRead.listPlannedAmounts,
    realizedReader.list,
  );

  return {
    listTeam: teamPort.list,
    listTeamDemographics: demographicsPort.list,
    listSuppliersWithoutContract: listSuppliersWithoutActiveContract({
      suppliersRead: suppliersPort,
      activeContractorsRead: contractorsPort,
    }),
    listPaymentPosition: positionPort.list,
    listAnalysis: analysisPort.list,
    listRealized: realizedPort.list,
    shutdown: async () => {
      await teamReader.close();
      await demographicsReader.close();
      await suppliersReader.close();
      await positionReader.close();
      await contractorsReader.close();
      await analysisReader.close();
      await budgetPlansRead.close();
      await realizedReader.close();
    },
  };
};
