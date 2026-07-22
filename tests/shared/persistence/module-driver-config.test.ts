/**
 * SHARED-DRIVER-BOOT-GUARD — W0 (RED)
 *
 * Cobre os 14 casos do plano de testes da spec 037 (`specs/037-persistence-driver-boot-guard/`),
 * issue #456. Agrupados por user story: US1 (boot barrado em produção), US2 (diagnóstico completo
 * numa tentativa) e US3 (dev/testes sem fricção + degradações com ADR preservadas).
 *
 * DEVE FALHAR em W0:
 *   - `readModuleDriverConfigs` ainda não existe em `#src/shared/persistence/module-driver-config.ts`.
 * GREEN quando o W1 entregar a função compartilhada que substitui o ternário
 * `env['X_DRIVER'] === 'mysql' ? mysql : memory` copiado em 7 pontos de `src/server.ts`.
 *
 * Defeito de produção que motivou: o fallback silencioso para `memory` fez o #374 (7 tabelas `bgp_*`
 * zeradas num banco cheio) e o #444 (3 relatórios vazios com HTTP 200). Molde de desenho:
 * `src/shared/http/email-link-base-urls.ts` (#331/#332), que já resolveu a mesma classe de defeito.
 *
 * Casos 13 e 14 são os mais importantes da suíte: travam a implementação para que ela NÃO endureça
 * duas degradações que têm ADR aceito (ADR-0026 réplica de leitura; ADR-0032 composição de programa).
 *
 * Nenhuma asserção depende de acentuação nem de frase exata — só de nome de módulo, nome de variável
 * e do valor inválido recebido, que são os três elementos exigidos por FR-010.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { readModuleDriverConfigs } from '#src/shared/persistence/module-driver-config.ts';

type Env = Readonly<Record<string, string | undefined>>;

// Endereços distintos por módulo. No deploy real todos apontam para o mesmo database `core`
// (isolamento por prefixo — ADR-0014); aqui são distintos de propósito, para que os casos 4 e 11
// provem que a cascata do `reports` liga cada fonte ao módulo certo, e não a "uma URL qualquer".
const URL_AUTH = 'mysql://app@db:3306/core_auth';
const URL_CONTRACTS = 'mysql://app@db:3306/core_contracts';
const URL_PARTNERS = 'mysql://app@db:3306/core_partners';
const URL_PROGRAMS = 'mysql://app@db:3306/core_programs';
const URL_FINANCIAL = 'mysql://app@db:3306/core_financial';
const URL_BUDGET_PLANS = 'mysql://app@db:3306/core_budget_plans';
const URL_REPORTS_OVERRIDE = 'mysql://app@replica:3306/core_reports_override';

/**
 * Produção com os 7 módulos corretamente configurados em `mysql`.
 * Note o que NÃO está aqui, de propósito:
 *   - `CONTRACTS_READER_URL` / `PARTNERS_READER_URL` — réplica é opcional (ADR-0026, caso 13);
 *   - os 4 overrides `REPORTS_*_DATABASE_URL` — resolvem por cascata (FR-012, caso 11).
 * É a configuração de um ambiente correto: o boot MUST seguir idêntico ao de hoje (FR-009).
 */
const PROD_ALL_MYSQL: Env = {
  NODE_ENV: 'production',
  AUTH_DRIVER: 'mysql',
  AUTH_DATABASE_URL: URL_AUTH,
  CONTRACTS_DRIVER: 'mysql',
  CONTRACTS_DATABASE_URL: URL_CONTRACTS,
  PARTNERS_DRIVER: 'mysql',
  PARTNERS_DATABASE_URL: URL_PARTNERS,
  PROGRAMS_DRIVER: 'mysql',
  PROGRAMS_DATABASE_URL: URL_PROGRAMS,
  FINANCIAL_DRIVER: 'mysql',
  FINANCIAL_DATABASE_URL: URL_FINANCIAL,
  BUDGET_PLANS_DRIVER: 'mysql',
  BUDGET_PLANS_DATABASE_URL: URL_BUDGET_PLANS,
  REPORTS_DRIVER: 'mysql',
};

/** Produção com os 7 módulos pedindo `memory` explicitamente (intenção declarada — FR-007). */
const PROD_ALL_MEMORY: Env = {
  NODE_ENV: 'production',
  AUTH_DRIVER: 'memory',
  CONTRACTS_DRIVER: 'memory',
  PARTNERS_DRIVER: 'memory',
  PROGRAMS_DRIVER: 'memory',
  FINANCIAL_DRIVER: 'memory',
  BUDGET_PLANS_DRIVER: 'memory',
  REPORTS_DRIVER: 'memory',
};

/** Devolve uma cópia do ambiente sem as chaves informadas (simula variável não declarada). */
const without = (env: Env, ...keys: readonly string[]): Env =>
  Object.fromEntries(Object.entries(env).filter(([key]) => !keys.includes(key)));

/** Junta as mensagens de erro num texto só, para asserção por conteúdo. */
const errorText = (result: ReturnType<typeof readModuleDriverConfigs>): string =>
  result.ok ? '' : result.error.join('\n');

describe('SHARED-DRIVER-BOOT-GUARD — US1: deploy incompleto e barrado antes de servir trafego', () => {
  it('caso 1 — producao + driver ausente: erro nomeia o modulo E a variavel (#374)', () => {
    const r = readModuleDriverConfigs(without(PROD_ALL_MYSQL, 'BUDGET_PLANS_DRIVER'));

    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error.length, 1);
    // FR-010: a mensagem tem de dizer QUAL modulo (a fonte) e QUAL variavel (o que fazer).
    // `budget-plans` em minusculo-kebab nao pode ser satisfeito pelo nome da env sozinho.
    assert.match(errorText(r), /budget-plans/);
    assert.match(errorText(r), /BUDGET_PLANS_DRIVER/);
  });

  it('caso 2 — producao + mysql sem URL: erro nomeia a variavel de endereco', () => {
    const r = readModuleDriverConfigs(without(PROD_ALL_MYSQL, 'AUTH_DATABASE_URL'));

    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error.length, 1);
    assert.match(errorText(r), /auth/);
    assert.match(errorText(r), /AUTH_DATABASE_URL/);
  });

  it('caso 3 — producao + typo no driver (mysqll): erro cita o valor recebido e os aceitos', () => {
    const r = readModuleDriverConfigs({ ...PROD_ALL_MYSQL, PROGRAMS_DRIVER: 'mysqll' });

    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error.length, 1);
    assert.match(errorText(r), /programs/);
    assert.match(errorText(r), /PROGRAMS_DRIVER/);
    // o valor recebido (hoje um typo cai em memory, calado — CA6 da #456)
    assert.match(errorText(r), /mysqll/);
    // e os valores aceitos: `memory` so aparece se a mensagem listar o dominio permitido
    assert.match(errorText(r), /memory/);
  });

  it('caso 4 — producao + configuracao completa: ok, os 7 modulos em mysql, sem aviso (FR-009)', () => {
    const r = readModuleDriverConfigs(PROD_ALL_MYSQL);

    assert.equal(r.ok, true);
    if (!r.ok) return;
    const { modules } = r.value;
    assert.equal(modules.auth.driver, 'mysql');
    assert.equal(modules.contracts.driver, 'mysql');
    assert.equal(modules.partners.driver, 'mysql');
    assert.equal(modules.programs.driver, 'mysql');
    assert.equal(modules.financial.driver, 'mysql');
    assert.equal(modules.budgetPlans.driver, 'mysql');
    assert.equal(modules.reports.driver, 'mysql');
    // o endereco de cada modulo chega resolvido — o server.ts so le a decisao ja tomada
    if (modules.auth.driver === 'mysql') assert.equal(modules.auth.connectionString, URL_AUTH);
    if (modules.budgetPlans.driver === 'mysql') {
      assert.equal(modules.budgetPlans.connectionString, URL_BUDGET_PLANS);
    }
    // ambiente correto nao gera aviso nenhum (nenhum modulo degradado)
    assert.deepEqual(r.value.warnings, []);
  });

  it('caso 9 — variavel vazia conta como AUSENTE, nunca como valor invalido', () => {
    // Prova sem prescrever texto: o relatorio de `X_DRIVER=""` tem de ser IDENTICO ao de `X_DRIVER`
    // nao declarada. Se a implementacao tratasse vazio como valor invalido, as mensagens divergiriam.
    const omitted = readModuleDriverConfigs(without(PROD_ALL_MYSQL, 'AUTH_DRIVER'));
    const empty = readModuleDriverConfigs({ ...PROD_ALL_MYSQL, AUTH_DRIVER: '' });
    assert.equal(omitted.ok, false);
    assert.equal(empty.ok, false);
    if (omitted.ok || empty.ok) return;
    assert.deepEqual(empty.error, omitted.error);

    // mesma regra para o endereco de conexao (Edge Case: "endereco presente mas vazio")
    const urlOmitted = readModuleDriverConfigs(without(PROD_ALL_MYSQL, 'AUTH_DATABASE_URL'));
    const urlEmpty = readModuleDriverConfigs({ ...PROD_ALL_MYSQL, AUTH_DATABASE_URL: '' });
    assert.equal(urlOmitted.ok, false);
    assert.equal(urlEmpty.ok, false);
    if (urlOmitted.ok || urlEmpty.ok) return;
    assert.deepEqual(urlEmpty.error, urlOmitted.error);
  });

  it('caso 10 — NODE_ENV ausente nao e producao: regra permissiva, sem erro', () => {
    const r = readModuleDriverConfigs(without(PROD_ALL_MYSQL, 'NODE_ENV', 'AUTH_DRIVER'));

    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.modules.auth.driver, 'memory');
  });
});

describe('SHARED-DRIVER-BOOT-GUARD — US2: diagnostico completo numa unica tentativa', () => {
  it('caso 5 — producao + 3 modulos quebrados: exatamente 3 erros no MESMO retorno', () => {
    // auth sem driver, programs com typo, reports sem driver. Nenhum dos tres e fonte da cascata
    // do reports, entao o total de problemas e exatamente 3 — o teste mede acumulacao, nao cascata.
    const r = readModuleDriverConfigs({
      ...without(PROD_ALL_MYSQL, 'AUTH_DRIVER', 'REPORTS_DRIVER'),
      PROGRAMS_DRIVER: 'mysqll',
    });

    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error.length, 3);
    assert.match(errorText(r), /AUTH_DRIVER/);
    assert.match(errorText(r), /PROGRAMS_DRIVER/);
    assert.match(errorText(r), /REPORTS_DRIVER/);
  });

  it('caso 6 — um modulo com 2 problemas simultaneos: ambos aparecem no retorno', () => {
    // Driver invalido E endereco ausente no mesmo modulo (US2-2). Quem digitou `mysqll` quis dizer
    // `mysql`: avisar tambem da URL faltante fecha os dois defeitos num deploy so.
    const r = readModuleDriverConfigs({
      ...without(PROD_ALL_MYSQL, 'AUTH_DATABASE_URL'),
      AUTH_DRIVER: 'mysqll',
    });

    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error.length, 2);
    assert.match(errorText(r), /mysqll/);
    assert.match(errorText(r), /AUTH_DATABASE_URL/);
  });

  it('caso 11 — reports: as 4 fontes resolvidas por CASCATA (overrides ausentes) devolvem ok', () => {
    const r = readModuleDriverConfigs(PROD_ALL_MYSQL);

    assert.equal(r.ok, true);
    if (!r.ok) return;
    const { reports } = r.value.modules;
    assert.equal(reports.driver, 'mysql');
    if (reports.driver !== 'mysql') return;
    // D4: valida-se o endereco EFETIVO. Sem override, cada fonte cai no *_DATABASE_URL do
    // modulo-fonte — e tem de cair no modulo CERTO, nao numa URL qualquer.
    assert.equal(reports.partnersUrl, URL_PARTNERS);
    assert.equal(reports.financialUrl, URL_FINANCIAL);
    assert.equal(reports.contractsUrl, URL_CONTRACTS);
    assert.equal(reports.budgetPlansUrl, URL_BUDGET_PLANS);

    // e o override especifico, quando declarado, vence a cascata (semantica do `??` de hoje)
    const overridden = readModuleDriverConfigs({
      ...PROD_ALL_MYSQL,
      REPORTS_CONTRACTS_DATABASE_URL: URL_REPORTS_OVERRIDE,
    });
    assert.equal(overridden.ok, true);
    if (!overridden.ok) return;
    const overriddenReports = overridden.value.modules.reports;
    if (overriddenReports.driver !== 'mysql') return assert.fail('reports deveria estar em mysql');
    assert.equal(overriddenReports.contractsUrl, URL_REPORTS_OVERRIDE);
    assert.equal(overriddenReports.partnersUrl, URL_PARTNERS);
  });

  it('caso 12 — reports com 1 fonte que nao resolve: erro ACUMULADO, nunca isolado (FR-012)', () => {
    // financial pediu memory explicitamente e nao tem URL => a fonte financeira do reports nao
    // resolve. Somado a um problema nao relacionado (auth sem driver), o retorno tem de trazer OS
    // DOIS. Hoje o `reports/adapters/http/composition.ts:112` lanca sozinho e sai com exit 1.
    const r = readModuleDriverConfigs({
      ...without(PROD_ALL_MYSQL, 'AUTH_DRIVER', 'FINANCIAL_DATABASE_URL'),
      FINANCIAL_DRIVER: 'memory',
    });

    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error.length, 2);
    // o problema do reports esta no mesmo relatorio que o do auth
    assert.match(errorText(r), /AUTH_DRIVER/);
    assert.match(errorText(r), /reports/);
    assert.match(errorText(r), /REPORTS_FINANCIAL_DATABASE_URL/);
  });
});

describe('SHARED-DRIVER-BOOT-GUARD — US3: dev/testes sem fricção e degradações com ADR intactas', () => {
  it('caso 7 — fora de producao + nada configurado: ok em memory + 1 aviso por modulo degradado', () => {
    const r = readModuleDriverConfigs({});

    assert.equal(r.ok, true);
    if (!r.ok) return;
    const { modules, warnings } = r.value;
    assert.equal(modules.auth.driver, 'memory');
    assert.equal(modules.contracts.driver, 'memory');
    assert.equal(modules.partners.driver, 'memory');
    assert.equal(modules.programs.driver, 'memory');
    assert.equal(modules.financial.driver, 'memory');
    assert.equal(modules.budgetPlans.driver, 'memory');
    assert.equal(modules.reports.driver, 'memory');
    // "um aviso por modulo degradado" (Assumptions da spec) — 7 modulos degradados, 7 avisos
    assert.equal(warnings.length, 7);
    const warningText = warnings.join('\n');
    for (const name of [
      'auth',
      'contracts',
      'partners',
      'programs',
      'financial',
      'budget-plans',
      'reports',
    ]) {
      assert.match(warningText, new RegExp(name));
    }
  });

  it('caso 8 — memory EXPLICITO em producao: ok, sem erro (FR-007)', () => {
    const r = readModuleDriverConfigs(PROD_ALL_MEMORY);

    assert.equal(r.ok, true);
    if (!r.ok) return;
    const { modules } = r.value;
    assert.equal(modules.auth.driver, 'memory');
    assert.equal(modules.contracts.driver, 'memory');
    assert.equal(modules.partners.driver, 'memory');
    assert.equal(modules.programs.driver, 'memory');
    assert.equal(modules.financial.driver, 'memory');
    assert.equal(modules.budgetPlans.driver, 'memory');
    assert.equal(modules.reports.driver, 'memory');
  });

  it('caso 13 — CRITICO: replica de leitura ausente NAO e erro (ADR-0026, FR-008)', () => {
    // PROD_ALL_MYSQL nao declara CONTRACTS_READER_URL nem PARTNERS_READER_URL de proposito:
    // "ausente -> reusa o writer, single-node". Endurecer isso contradiz ADR aceito.
    assert.equal(readModuleDriverConfigs(PROD_ALL_MYSQL).ok, true);

    // e mesmo com o relatorio de erros aberto por outro motivo, nenhuma mensagem pode cobrar a
    // replica — a guarda nao alcanca a degradacao intencional.
    const broken = readModuleDriverConfigs(without(PROD_ALL_MYSQL, 'AUTH_DRIVER'));
    assert.equal(broken.ok, false);
    if (broken.ok) return;
    assert.equal(errorText(broken).includes('READER_URL'), false);
    assert.equal(errorText(broken).includes('CONTRACTS_READER_URL'), false);
    assert.equal(errorText(broken).includes('PARTNERS_READER_URL'), false);
  });

  it('caso 14 — CRITICO: composicao de programa indisponivel nao derruba o boot (ADR-0032, FR-008)', () => {
    // O bloco `program` do contracts so existe quando programs esta em mysql; indisponivel, ele
    // DEGRADA de proposito. Com programs em memory declarado, o contracts segue em mysql e o
    // retorno segue `ok` — a guarda nao pode transformar essa degradacao em falha de boot.
    const r = readModuleDriverConfigs({
      ...without(PROD_ALL_MYSQL, 'PROGRAMS_DATABASE_URL'),
      PROGRAMS_DRIVER: 'memory',
    });

    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.modules.programs.driver, 'memory');
    assert.equal(r.value.modules.contracts.driver, 'mysql');
    if (r.value.modules.contracts.driver === 'mysql') {
      assert.equal(r.value.modules.contracts.connectionString, URL_CONTRACTS);
    }

    // fora de producao, com programs simplesmente nao declarado, tambem nao ha erro
    const dev = readModuleDriverConfigs(
      without(PROD_ALL_MYSQL, 'NODE_ENV', 'PROGRAMS_DRIVER', 'PROGRAMS_DATABASE_URL'),
    );
    assert.equal(dev.ok, true);
  });
});

describe('SHARED-DRIVER-BOOT-GUARD — invariante de credencial (W2 M3/S1)', () => {
  // `data-model.md` exige: nenhuma mensagem pode ecoar o VALOR de um endereco de conexao — so o
  // NOME da variavel. Cobre CWE-532 (credencial em log) e CWE-117 (log injection).
  //
  // Este caso nasceu de um erro real do W1: a primeira versao do controle truncava o valor em 20
  // caracteres e PARECIA correta, mas imprimia `"mysql://core_app:SEN..."` — truncar e' inutil
  // aqui, porque usuario e inicio de senha moram no PREFIXO da connection string. O controle
  // certo filtra por FORMA (so ecoa o que parece nome de driver), nao por tamanho. Um controle
  // que ja falhou uma vez precisa de teste.
  const SENHA = 'S3nh4Sup3rSecreta';
  const URL_COM_CREDENCIAL = `mysql://core_app:${SENHA}@rds.interno:3306/core`;

  it('caso 15 — URL colada na variavel de DRIVER por engano nao vaza credencial na mensagem', () => {
    const r = readModuleDriverConfigs({ ...PROD_ALL_MYSQL, AUTH_DRIVER: URL_COM_CREDENCIAL });

    assert.equal(r.ok, false);
    if (r.ok) return;
    const texto = errorText(r);
    assert.equal(texto.includes(SENHA), false, 'a senha vazou na mensagem de erro');
    assert.equal(texto.includes('core_app'), false, 'o usuario do banco vazou na mensagem');
    assert.equal(texto.includes('rds.interno'), false, 'o host do banco vazou na mensagem');
    // a mensagem segue util: nomeia modulo e variavel (FR-010)
    assert.match(texto, /auth/);
    assert.match(texto, /AUTH_DRIVER/);
  });

  it('caso 16 — valor de driver com quebra de linha nao forja linha no stderr (CWE-117)', () => {
    const r = readModuleDriverConfigs({
      ...PROD_ALL_MYSQL,
      AUTH_DRIVER: 'mysql\nserver: financial: tudo certo',
    });

    assert.equal(r.ok, false);
    if (r.ok) return;
    // cada erro e' escrito como UMA linha no stderr; um valor com \n nao pode virar duas
    for (const linha of r.error) assert.equal(linha.includes('\n'), false);
  });

  it('caso 17 — nenhum aviso ecoa valor de endereco de conexao', () => {
    // ambiente degradado (fora de producao) e' o caminho que mais gera avisos
    const r = readModuleDriverConfigs({
      NODE_ENV: 'development',
      AUTH_DRIVER: URL_COM_CREDENCIAL,
      AUTH_DATABASE_URL: URL_COM_CREDENCIAL,
    });

    assert.equal(r.ok, true);
    if (!r.ok) return;
    const avisos = r.value.warnings.join('\n');
    assert.equal(avisos.includes(SENHA), false, 'a senha vazou num aviso');
    assert.equal(avisos.includes('core_app'), false, 'o usuario do banco vazou num aviso');
  });
});
