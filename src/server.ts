/**
 * Entrypoint HTTP — lê config, sobe Fastify, graceful shutdown.
 *
 * Composicao dos adapters de modulo (ex.: auth) sera feita aqui quando
 * cada modulo exportar seu plugin via <modulo>/public-api/http.ts (ADR-0006).
 */

import process from 'node:process';

import { buildApp } from '#src/shared/http/app.ts';
import { readHttpConfig } from '#src/shared/http/config.ts';
import { readEmailLinkBaseUrls } from '#src/shared/http/email-link-base-urls.ts';
import { readModuleDriverConfigs } from '#src/shared/persistence/module-driver-config.ts';
import {
  installLastResortHandlers,
  processLastResortDeps,
} from '#src/shared/runtime/last-resort.ts';
import {
  authHttpPlugin,
  buildAuthHttpDeps,
  makeRequireAuth,
  resolveRbacMode,
  rbacBypassBanner,
  parseE2eAuthSeed,
  usersHttpPlugin,
  approversHttpPlugin,
  rolesHttpPlugin,
  meHttpPlugin,
} from '#src/modules/auth/public-api/http.ts';
import {
  contractsHttpPlugin,
  buildContractsHttpDeps,
} from '#src/modules/contracts/public-api/http.ts';
import {
  collaboratorsHttpPlugin,
  suppliersHttpPlugin,
  suppliersBatchHttpPlugin,
  financiersHttpPlugin,
  partnerGeographyHttpPlugin,
  actHttpPlugin,
  partnersHttpPlugin,
  buildPartnersHttpDeps,
} from '#src/modules/partners/public-api/http.ts';
import {
  programsHttpPlugin,
  buildProgramsHttpDeps,
  type ProgramsCompositionConfig,
} from '#src/modules/programs/public-api/http.ts';
import {
  buildProgramsReadPort,
  type ProgramsReadPort,
} from '#src/modules/programs/public-api/index.ts';
import type { LogoS3Config } from '#src/modules/programs/adapters/storage/logo-storage.s3.ts';
import {
  financialHttpPlugin,
  buildFinancialHttpDeps,
} from '#src/modules/financial/public-api/http.ts';
import {
  budgetPlansHttpPlugin,
  buildBudgetPlansHttpDeps,
  parseE2eBudgetPlansSeed,
} from '#src/modules/budget-plans/public-api/http.ts';
import { reportsHttpPlugin, buildReportsHttpDeps } from '#src/modules/reports/public-api/http.ts';

// Config S3/MinIO do logo de programa (ADR-0019 / issue #244 IAM Role).
// Retorna config quando endpoint + bucket presentes (minimo para S3); credentials opcionais:
//   ambas presentes -> estaticas (dev/MinIO/Magalu);
//   ambas ausentes  -> provider chain (IAM Role ECS/IMDS — prod AWS);
//   XOR             -> undefined (config pela metade, fall-safe para in-memory).
const readProgramsLogoConfig = (
  env: Readonly<Record<string, string | undefined>>,
): LogoS3Config | undefined => {
  const endpoint = env['PROGRAMS_LOGO_S3_ENDPOINT'];
  const region = env['PROGRAMS_LOGO_S3_REGION'];
  const bucket = env['PROGRAMS_LOGO_S3_BUCKET'];

  if (
    endpoint === undefined ||
    endpoint.length === 0 ||
    bucket === undefined ||
    bucket.length === 0
  ) {
    return undefined;
  }

  const accessKeyId = env['PROGRAMS_LOGO_S3_ACCESS_KEY_ID'];
  const secretAccessKey = env['PROGRAMS_LOGO_S3_SECRET_ACCESS_KEY'];
  const hasKey = accessKeyId !== undefined && accessKeyId.length > 0;
  const hasSecret = secretAccessKey !== undefined && secretAccessKey.length > 0;

  // XOR: config pela metade e erro — fall-safe p/ in-memory.
  if (hasKey !== hasSecret) {
    return undefined;
  }

  const credentialFields: Readonly<{ accessKeyId?: string; secretAccessKey?: string }> =
    hasKey && hasSecret ? { accessKeyId, secretAccessKey } : {};

  return {
    endpoint,
    region: region ?? 'us-east-1',
    ...credentialFields,
    bucket,
    forcePathStyle: env['PROGRAMS_LOGO_S3_FORCE_PATH_STYLE'] !== 'false',
  };
};

const main = async (): Promise<void> => {
  const config = readHttpConfig(process.env);

  // #456 — decisao UNICA de driver dos 7 modulos, antes de qualquer pool ser aberto: em producao,
  // configuracao ausente/invalida derruba o boot com o relatorio completo (EX_CONFIG=78, FR-004/005);
  // fora de producao degrada para memoria AVISANDO modulo a modulo (FR-006). Ate aqui cada modulo
  // decidia sozinho, lendo a propria variavel de driver num ternario calado (`=== 'mysql' ? mysql :
  // memory`) — o que serviu banco vazio com HTTP 200 em #374 (budget-plans) e #444 (reports).
  //
  // Encerra com `process.exitCode` + `return`, nunca com `process.exit`: em container o stderr e um
  // pipe, e `handbook/reference/nodejs/Process.md:4156-4163` e literal — "Pipes (and sockets):
  // _synchronous_ on Windows, _asynchronous_ on POSIX" … "not written at all if `process.exit()` is
  // called before an asynchronous write completes". Um `exit 78` mudo aniquilaria o valor da feature,
  // que e o diagnostico (FR-005/FR-010), nao o codigo de saida. Mesmo padrao dos jobs
  // (`src/jobs/auth/sync-permissions/run.ts:7-8`) e dos workers. Seguro aqui porque nenhum handle
  // esta aberto neste ponto do boot: o event loop esvazia e o processo sai com 78.
  const drivers = readModuleDriverConfigs(process.env);
  if (!drivers.ok) {
    for (const message of drivers.error) process.stderr.write(`server: ${message}\n`);
    process.exitCode = 78;
    return;
  }
  const modules = drivers.value.modules;
  for (const warning of drivers.value.warnings) process.stderr.write(`server: ${warning}\n`);

  // Seed RBAC via env — inerte fora de E2E/dev (guarda dupla CORE_API_E2E + AUTH_SEED_JSON).
  const authSeed = parseE2eAuthSeed(process.env);
  // BE-REC-001: limite dedicado de login/refresh via env; ausente/malformado → default (5/min).
  const sensitiveMax = Number.parseInt(process.env['AUTH_LOGIN_RATE_LIMIT_MAX'] ?? '', 10);
  const sensitiveRateLimit =
    Number.isInteger(sensitiveMax) && sensitiveMax > 0
      ? {
          max: sensitiveMax,
          timeWindow: process.env['AUTH_LOGIN_RATE_LIMIT_WINDOW'] ?? '1 minute',
        }
      : undefined;
  // BE-REC-003 + #331/#332: origem confiável dos links de e-mail (nunca header Host).
  // Inválida, ou ausente em produção → boot falha (EX_CONFIG), nunca link localhost/relativo.
  // `process.exitCode` + `return` pelo mesmo motivo do bloco de drivers acima (Process.md:4156-4163).
  const emailLinkUrls = readEmailLinkBaseUrls(process.env);
  if (!emailLinkUrls.ok) {
    for (const message of emailLinkUrls.error) process.stderr.write(`server: ${message}\n`);
    process.exitCode = 78;
    return;
  }
  const { resetBaseUrl, activationBaseUrl, selfRegistrationBaseUrl } = emailLinkUrls.value;
  // ADR-0052 — modo do RBAC. `bypass` desliga a autorização por permissão (todo autenticado é
  // super-usuário). NÃO pode ser silencioso: um banner gritante no boot torna o estado inconfundível.
  const rbacMode = resolveRbacMode(process.env);
  if (rbacMode === 'bypass') {
    process.stderr.write(rbacBypassBanner(process.env['NODE_ENV'] ?? 'undefined'));
  }
  const authDeps = await buildAuthHttpDeps({
    driver: modules.auth.driver,
    rbacMode,
    ...(modules.auth.driver === 'mysql' ? { connectionString: modules.auth.connectionString } : {}),
    ...(authSeed !== undefined ? { seed: authSeed } : {}),
    ...(sensitiveRateLimit !== undefined ? { sensitiveRateLimit } : {}),
    ...(resetBaseUrl !== undefined ? { resetBaseUrl } : {}),
    ...(activationBaseUrl !== undefined ? { activationBaseUrl } : {}),
  });

  // CTR-NUMBER-PROGRAM: read port de programs (ADR-0006/0014) p/ contracts compor o bloco
  // `program`. Só em mysql; falha de abertura DEGRADA (não derruba o boot — a composição do
  // programa é opcional, ADR-0032). Fechado no graceful shutdown.
  const programs = modules.programs;
  let programsReadPort: ProgramsReadPort | undefined = undefined;
  if (programs.driver === 'mysql') {
    const portR = await buildProgramsReadPort({ connectionString: programs.connectionString });
    if (portR.ok) programsReadPort = portR.value;
    else
      process.stderr.write(
        `server: programs read port indisponível (${portR.error}) — bloco program degradado\n`,
      );
  }

  // RW split (ADR-0026): o writer vem da guarda; CONTRACTS_READER_URL = réplica OPCIONAL — fica
  // fora da guarda de propósito (#456 FR-008), ausente → reusa o writer, single-node.
  const contracts = modules.contracts;
  const contractsReaderUrl = process.env['CONTRACTS_READER_URL'];
  const contractsDeps = await buildContractsHttpDeps(
    contracts.driver === 'mysql'
      ? {
          driver: 'mysql',
          writerUrl: contracts.connectionString,
          ...(contractsReaderUrl !== undefined ? { readerUrl: contractsReaderUrl } : {}),
          ...(programsReadPort !== undefined ? { programReadPort: programsReadPort } : {}),
        }
      : {
          driver: 'memory',
          ...(programsReadPort !== undefined ? { programReadPort: programsReadPort } : {}),
        },
  );

  // RW split (ADR-0026) do módulo partners: o writer vem da guarda; PARTNERS_READER_URL = réplica
  // OPCIONAL, também fora da guarda (#456 FR-008) — ausente → reusa o writer.
  const partners = modules.partners;
  const partnersReaderUrl = process.env['PARTNERS_READER_URL'];
  const partnersDeps = await buildPartnersHttpDeps(
    partners.driver === 'mysql'
      ? {
          driver: 'mysql',
          writerUrl: partners.connectionString,
          ...(partnersReaderUrl !== undefined ? { readerUrl: partnersReaderUrl } : {}),
          // campo legado PT do partners — rename rastreado na issue #333
          ...(selfRegistrationBaseUrl !== undefined
            ? { autocadastroBaseUrl: selfRegistrationBaseUrl }
            : {}),
        }
      : {
          driver: 'memory',
          // campo legado PT do partners — rename rastreado na issue #333
          ...(selfRegistrationBaseUrl !== undefined
            ? { autocadastroBaseUrl: selfRegistrationBaseUrl }
            : {}),
        },
  );

  // Módulo programs (spec 008, ADR-0033) → /api/v1/programs. Logo storage S3/MinIO (ADR-0019)
  // só quando todas as envs PROGRAMS_LOGO_* presentes; ausente → storage in-memory (degradado).
  // Mesma connection string do read port acima.
  const programsLogo = readProgramsLogoConfig(process.env);
  const programsDeps = await buildProgramsHttpDeps(
    programs.driver === 'mysql'
      ? ({
          driver: 'mysql',
          writerUrl: programs.connectionString,
          ...(programsLogo !== undefined ? { logo: programsLogo } : {}),
        } satisfies ProgramsCompositionConfig)
      : ({
          driver: 'memory',
          ...(programsLogo !== undefined ? { logo: programsLogo } : {}),
        } satisfies ProgramsCompositionConfig),
  );

  // Módulo financial (spec 009, fatia 1) → /api/v2/financial. Greenfield V2 (plugin direto).
  const financial = modules.financial;
  const financialDeps = await buildFinancialHttpDeps(
    financial.driver === 'mysql'
      ? { driver: 'mysql', writerUrl: financial.connectionString }
      : { driver: 'memory' },
  );

  // Módulo budget-plans (BGP-PLAN-CRUD, issue #315) → /api/v2/budget-plans. Greenfield V2
  // (plugin direto). Uma connection string: bgp_* + read ports prg_*/par_* (ADR-0014).
  const budgetPlans = modules.budgetPlans;
  // Seed de catálogo via env — inerte fora de E2E/dev (guarda dupla CORE_API_E2E +
  // BUDGET_PLANS_SEED_JSON). Malformado sob a flag → boot falha (o throw propaga p/ main().catch).
  // Só o ramo memory consome; o mysql lê prg_*/par_* real.
  const budgetPlansSeed = parseE2eBudgetPlansSeed(process.env);
  const budgetPlansDeps = await buildBudgetPlansHttpDeps(
    budgetPlans.driver === 'mysql'
      ? { driver: 'mysql', connectionString: budgetPlans.connectionString }
      : { driver: 'memory', ...(budgetPlansSeed !== undefined ? { seed: budgetPlansSeed } : {}) },
  );

  // Módulo reports (épico Relatórios #114) → /api/v2/reports. Greenfield V2 (plugin direto).
  // Read-only, sem writer próprio — lê projeções via public-api (ADR-0006/0014): REP-1 (#238) do
  // `partners` (par_*), REP-2 (#240) do `financial` (fin_*) e, desde #437, o conjunto de
  // contratantes com contrato Active do `contracts` (ctr_*) para o anti-join do REP-2; S6 (#502)
  // soma o orçado do `budget-plans` (bgp_*). A cascata `REPORTS_*_DATABASE_URL` → `*_DATABASE_URL`
  // do módulo-fonte é resolvida pela guarda de boot, que entrega os quatro endereços já validados.
  const reportsDeps = await buildReportsHttpDeps(modules.reports);

  // requireAuth do auth (cross-módulo via public-api, ADR-0006/0024) protege as rotas de contracts.
  const requireAuth = makeRequireAuth(authDeps.verifyAccessToken);

  const app = await buildApp({
    routes: [
      // Modelo novo (greenfield) → /api/v2 (plugin direto, forma legada do buildApp).
      authHttpPlugin(authDeps),
      contractsHttpPlugin(contractsDeps, { requireAuth, authorize: authDeps.authorize }),
      financialHttpPlugin(financialDeps, { requireAuth, authorize: authDeps.authorize }),
      // Resolução em lote de fornecedores (#356; ADR-0049 §3) → /api/v2/partners/suppliers:batch.
      suppliersBatchHttpPlugin(partnersDeps, {
        requireAuth,
        authorize: authDeps.authorize,
      }),
      budgetPlansHttpPlugin(budgetPlansDeps, { requireAuth, authorize: authDeps.authorize }),
      // Relatórios (REPORTS-TEAM-ABC #238) → /api/v2/reports/team. Greenfield V2 (plugin direto).
      reportsHttpPlugin(reportsDeps, { requireAuth, authorize: authDeps.authorize }),
      // Espelho do legado (ADR-0033) → /api/v1.
      {
        plugin: collaboratorsHttpPlugin(partnersDeps, {
          requireAuth,
          authorize: authDeps.authorize,
          hasPermission: authDeps.hasPermission,
        }),
        prefix: '/api/v1',
      },
      {
        plugin: suppliersHttpPlugin(partnersDeps, {
          requireAuth,
          authorize: authDeps.authorize,
          hasPermission: authDeps.hasPermission,
        }),
        prefix: '/api/v1',
      },
      {
        plugin: financiersHttpPlugin(partnersDeps, {
          requireAuth,
          authorize: authDeps.authorize,
          hasPermission: authDeps.hasPermission,
        }),
        prefix: '/api/v1',
      },
      {
        plugin: partnerGeographyHttpPlugin(partnersDeps, {
          requireAuth,
          authorize: authDeps.authorize,
        }),
        prefix: '/api/v1',
      },
      {
        plugin: actHttpPlugin(partnersDeps, {
          requireAuth,
          authorize: authDeps.authorize,
        }),
        prefix: '/api/v1',
      },
      {
        plugin: partnersHttpPlugin(partnersDeps, {
          requireAuth,
          authorize: authDeps.authorize,
          hasPermission: authDeps.hasPermission,
        }),
        prefix: '/api/v1',
      },
      // Gestão de programas (spec 008, ADR-0033) → /api/v1/programs[/:id][/...].
      {
        plugin: programsHttpPlugin(programsDeps, {
          requireAuth,
          authorize: authDeps.authorize,
        }),
        prefix: '/api/v1',
      },
      // Gestão de usuários (spec 005 US1/US2/US3/US4/US5, ADR-0037) → /api/v1/users[/:id][/...].
      {
        plugin: usersHttpPlugin(
          {
            listUsers: authDeps.listUsers,
            getUser: authDeps.getUser,
            createUserByAdmin: authDeps.createUserByAdmin,
            updateUserProfile: authDeps.updateUserProfile,
            activateUser: authDeps.activateUser,
            deactivateUser: authDeps.deactivateUser,
            setProfilePhoto: authDeps.setProfilePhoto,
            removeProfilePhoto: authDeps.removeProfilePhoto,
            getProfilePhoto: authDeps.getProfilePhoto,
          },
          { requireAuth, authorize: authDeps.authorize },
        ),
        prefix: '/api/v1',
      },
      // Listagem de aprovadores (#148) → /api/v1/approvers. Plugin separado (aditivo). RBAC user:list.
      {
        plugin: approversHttpPlugin(
          { listUsersByPermission: authDeps.listUsersByPermission },
          { requireAuth, authorize: authDeps.authorize },
        ),
        prefix: '/api/v1',
      },
      // Gestão de acessos (spec 006 US1) → /api/v1/users/:id/permissions. RBAC administrativo.
      {
        plugin: rolesHttpPlugin(
          {
            getUserPermissions: authDeps.getUserPermissions,
            listPermissionCatalog: authDeps.listPermissionCatalog,
            listRoles: authDeps.listRoles,
            createRole: authDeps.createRole,
            updateRole: authDeps.updateRole,
            archiveRole: authDeps.archiveRole,
            assignRole: authDeps.assignRole,
            revokeRole: authDeps.revokeRole,
          },
          { requireAuth, authorize: authDeps.authorize },
        ),
        prefix: '/api/v1',
      },
      // Minha Conta (spec 005 US7) → /api/v1/me[/password-reset]. Self por construção (req.userId).
      {
        plugin: meHttpPlugin(
          {
            getUser: authDeps.getUser,
            updateUserProfile: authDeps.updateUserProfile,
            requestPasswordReset: authDeps.requestPasswordReset,
            setProfilePhoto: authDeps.setProfilePhoto,
            removeProfilePhoto: authDeps.removeProfilePhoto,
            getProfilePhoto: authDeps.getProfilePhoto,
          },
          { requireAuth },
        ),
        prefix: '/api/v1',
      },
    ],
    config,
  });

  // Graceful shutdown: SIGTERM / SIGINT → app.close() (drena conexoes abertas)
  const shutdown = async (): Promise<void> => {
    app.log.info('Graceful shutdown iniciado…');
    await app.close();
    await authDeps.shutdown();
    await contractsDeps.shutdown();
    await partnersDeps.shutdown();
    await programsDeps.shutdown();
    await financialDeps.shutdown();
    await budgetPlansDeps.shutdown();
    await reportsDeps.shutdown();
    // CTR-NUMBER-PROGRAM: fecha o pool do read port de programs injetado em contracts.
    if (programsReadPort !== undefined) await programsReadPort.close();
    app.log.info('Servidor encerrado.');
  };

  const onSignal = (): void => {
    void shutdown().catch((err: unknown) => {
      process.stderr.write(`Erro no shutdown: ${String(err)}\n`);
      process.exit(1);
    });
  };

  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);

  // Handlers de ultimo recurso para erros fora da cadeia de promise
  installLastResortHandlers(shutdown, processLastResortDeps());

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`core-api HTTP listening on ${config.host}:${config.port}`);
};

main().catch((err: unknown) => {
  process.stderr.write(`Fatal ao iniciar: ${String(err)}\n`);
  process.exit(1);
});
