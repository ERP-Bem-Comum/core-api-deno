/**
 * Guarda de boot da configuracao de persistencia dos 7 modulos (issue #456).
 *
 * Os incidentes #374 (tabelas bgp_* servidas vazias com o banco cheio) e #444 (relatorios vazios
 * com HTTP 200) tiveram a mesma causa: `env['X_DRIVER'] === 'mysql' ? mysql : memory`, repetido em
 * 7 pontos do `server.ts`. Nesse ternario, qualquer valor diferente de "mysql" — ausente, vazio ou
 * com typo — vira memoria, calado. Aqui a decisao e tomada UMA vez, com relatorio completo: em
 * producao configuracao ausente/invalida derruba o boot; fora de producao degrada para memoria
 * com um aviso que nomeia o modulo.
 *
 * Molde: `src/shared/http/email-link-base-urls.ts` (#331/#332) — acumula em `string[]` e so
 * retorna `err(errors)` no fim, para que o operador conserte tudo num deploy so (FR-005).
 *
 * Fora desta guarda por decisao registrada (FR-008): endereco de replica de leitura
 * (`*_READER_URL`, ADR-0026) e composicao de programa em contratos (ADR-0032) — as duas sao
 * degradacoes intencionais, e endurece-las aqui contradiria ADR aceito.
 *
 * Mensagens em PT sem acentuacao, como o molde: saem em stderr no boot, antes de qualquer
 * garantia de encoding do coletor de log. Nenhuma delas ecoa o VALOR de um endereco de conexao
 * (credencial viaja dentro dele) — so o nome da variavel.
 */

import { combine, err, ok, type Result } from '#src/shared/primitives/result.ts';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * A relacao "mysql => tem endereco" e uniao discriminada, nao campo opcional: o estado `mysql`
 * sem `connectionString` e irrepresentavel, e por isso nao precisa ser checado de novo adiante.
 */
export type ModuleDriverConfig =
  | Readonly<{ driver: 'memory' }>
  | Readonly<{ driver: 'mysql'; connectionString: string }>;

/** O modulo somente-leitura nao tem endereco proprio: consome quatro, resolvidos por cascata. */
export type ReportsDriverConfig =
  | Readonly<{ driver: 'memory' }>
  | Readonly<{
      driver: 'mysql';
      partnersUrl: string;
      financialUrl: string;
      contractsUrl: string;
      budgetPlansUrl: string;
    }>;

export type ModuleDriverMap = Readonly<{
  auth: ModuleDriverConfig;
  contracts: ModuleDriverConfig;
  partners: ModuleDriverConfig;
  programs: ModuleDriverConfig;
  financial: ModuleDriverConfig;
  budgetPlans: ModuleDriverConfig;
  reports: ReportsDriverConfig;
}>;

export type ModuleDriverConfigs = Readonly<{
  modules: ModuleDriverMap;
  /** Canal separado do de erros: degradacao aceita fora de producao ainda precisa ser visivel. */
  warnings: readonly string[];
}>;

type ModuleSpec = Readonly<{ name: string; driverVar: string; urlVar: string }>;

type ReportsSourceSpec = Readonly<{ overrideVar: string; sourceVar: string }>;

type Diagnostics = Readonly<{ errors: readonly string[]; warnings: readonly string[] }>;

type Resolution<TConfig> = Diagnostics & Readonly<{ config: TConfig }>;

/**
 * O que o operador declarou no campo de driver. `memory` e valor de primeira classe — ate hoje
 * era so "qualquer coisa != mysql", o que tornava o typo indistinguivel da intencao.
 */
type DriverDeclaration =
  | Readonly<{ kind: 'mysql' }>
  | Readonly<{ kind: 'memory' }>
  | Readonly<{ kind: 'absent' }>
  | Readonly<{ kind: 'invalid'; value: string }>;

const ACCEPTED_DRIVERS = ['mysql', 'memory'] as const;

const ACCEPTED_DRIVERS_TEXT = ACCEPTED_DRIVERS.map((driver) => `"${driver}"`).join(' ou ');

/** Nome do modulo em kebab-case, igual ao da pasta em `src/modules/` e ao da matriz de ambiente. */
const MODULE_SPECS = {
  auth: { name: 'auth', driverVar: 'AUTH_DRIVER', urlVar: 'AUTH_DATABASE_URL' },
  contracts: {
    name: 'contracts',
    driverVar: 'CONTRACTS_DRIVER',
    urlVar: 'CONTRACTS_DATABASE_URL',
  },
  partners: { name: 'partners', driverVar: 'PARTNERS_DRIVER', urlVar: 'PARTNERS_DATABASE_URL' },
  programs: { name: 'programs', driverVar: 'PROGRAMS_DRIVER', urlVar: 'PROGRAMS_DATABASE_URL' },
  financial: {
    name: 'financial',
    driverVar: 'FINANCIAL_DRIVER',
    urlVar: 'FINANCIAL_DATABASE_URL',
  },
  budgetPlans: {
    name: 'budget-plans',
    driverVar: 'BUDGET_PLANS_DRIVER',
    urlVar: 'BUDGET_PLANS_DATABASE_URL',
  },
} as const satisfies Readonly<Record<string, ModuleSpec>>;

const REPORTS_NAME = 'reports';
const REPORTS_DRIVER_VAR = 'REPORTS_DRIVER';

const REPORTS_SOURCE_SPECS = {
  partners: { overrideVar: 'REPORTS_DATABASE_URL', sourceVar: 'PARTNERS_DATABASE_URL' },
  financial: {
    overrideVar: 'REPORTS_FINANCIAL_DATABASE_URL',
    sourceVar: 'FINANCIAL_DATABASE_URL',
  },
  contracts: {
    overrideVar: 'REPORTS_CONTRACTS_DATABASE_URL',
    sourceVar: 'CONTRACTS_DATABASE_URL',
  },
  budgetPlans: {
    overrideVar: 'REPORTS_BUDGET_PLANS_DATABASE_URL',
    sourceVar: 'BUDGET_PLANS_DATABASE_URL',
  },
} as const satisfies Readonly<Record<string, ReportsSourceSpec>>;

/**
 * No ramo de ERRO esta config e descartada — o `Result` sai `err` e o `server.ts` encerra. Ela
 * existe para que o mapa dos 7 modulos seja sempre completo; nao e, em hipotese alguma, o fallback
 * silencioso que causou #374/#444.
 */
const MEMORY: Readonly<{ driver: 'memory' }> = { driver: 'memory' };

const NO_DIAGNOSTICS: Diagnostics = { errors: [], warnings: [] };

/** Variavel presente porem vazia conta como AUSENTE — nunca como valor invalido. */
const readVar = (env: Env, name: string): string | undefined => {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
};

const readDriver = (env: Env, name: string): DriverDeclaration => {
  const raw = readVar(env, name);
  if (raw === undefined) return { kind: 'absent' };
  if (raw === 'mysql') return { kind: 'mysql' };
  if (raw === 'memory') return { kind: 'memory' };
  return { kind: 'invalid', value: raw };
};

/**
 * O valor recebido NAO vai cru para o log (W2 — CWE-532 e CWE-117). O erro de operador mais provavel
 * nao e digitar "mysqll": e colar a connection string na variavel de driver do mesmo modulo
 * (`AUTH_DRIVER=mysql://user:senha@rds.../core`) — e ai usuario e senha iriam parar no coletor de
 * log, que tem audiencia maior e retencao mais longa que o secret store. Um `\n` no valor, alem
 * disso, forjaria uma linha inteira de diagnostico no stderr.
 *
 * Regra: eco so quando o valor TEM FORMA DE DRIVER (curto, sem simbolo de URL). Truncar seria
 * insuficiente — "mysql://core_app:SEN..." ainda entrega o inicio da senha. Todo typo plausivel
 * ("mysqll", "MySQL", "mysq1") casa e aparece inteiro, que e o que o operador precisa ver; uma URL
 * colada nao casa e nao aparece de forma nenhuma. O tamanho fica no lugar do valor porque ele
 * distingue "typo" de "variavel trocada" sem revelar nada.
 */
const DRIVER_VALUE_ECHO_SHAPE = /^[\w.-]{1,20}$/;

const echoableDriverValue = (value: string): string =>
  DRIVER_VALUE_ECHO_SHAPE.test(value)
    ? `"${value}"`
    : `(nao exibido — ${String(value.length)} caracteres fora do formato de driver)`;

// FR-010 (Uncle Bob, Codigo Limpo p. 107): cada mensagem nomeia a FONTE (o modulo) e a OPERACAO
// que falhou (a variavel). "driver mysql exige partnersUrl" — o texto de hoje — reprova nas duas.
const missingDriverError = (spec: Readonly<{ name: string; driverVar: string }>): string =>
  `${spec.name}: ${spec.driverVar} nao configurada — obrigatoria em producao ` +
  `(valores aceitos: ${ACCEPTED_DRIVERS_TEXT})`;

const invalidDriverError = (
  spec: Readonly<{ name: string; driverVar: string }>,
  value: string,
): string =>
  `${spec.name}: ${spec.driverVar} com valor invalido ${echoableDriverValue(value)} — ` +
  `valores aceitos: ${ACCEPTED_DRIVERS_TEXT}`;

const missingUrlError = (spec: ModuleSpec): string =>
  `${spec.name}: ${spec.urlVar} nao configurada — obrigatoria quando ${spec.driverVar} e "mysql"`;

const missingDriverWarning = (spec: Readonly<{ name: string; driverVar: string }>): string =>
  `${spec.name}: ${spec.driverVar} nao configurada — usando memory ` +
  `(dado volatil, perdido no restart)`;

const invalidDriverWarning = (
  spec: Readonly<{ name: string; driverVar: string }>,
  value: string,
): string =>
  `${spec.name}: ${spec.driverVar} com valor invalido ${echoableDriverValue(value)} — ` +
  `usando memory (valores aceitos: ${ACCEPTED_DRIVERS_TEXT})`;

/**
 * `memory` declarado em producao sobe (FR-007 e explicito: "sem falhar e sem exigir configuracao
 * adicional") — mas nao pode subir MUDO. O projeto ja decidiu essa exata classe ("estado declarado,
 * porem perigoso") no ADR-0052, e decidiu gritando: `server.ts` avisa em banner que o RBAC em
 * `bypass` NAO pode ser silencioso. Persistencia volatil perde mais que autorizacao desligada —
 * perde o trabalho do usuario. Este aviso tambem e o herdeiro do alarme pontual do PR #488, que a
 * regra compartilhada absorveu. Distingue DECLARADO de degradado: o texto nomeia a declaracao.
 */
const declaredMemoryWarning = (spec: Readonly<{ name: string; driverVar: string }>): string =>
  `${spec.name}: ${spec.driverVar}=memory DECLARADO em producao — a API NAO le o MySQL ` +
  `(dado volatil, perdido no restart)`;

const resolveModule = (
  env: Env,
  spec: ModuleSpec,
  isProduction: boolean,
): Resolution<ModuleDriverConfig> => {
  const declaration = readDriver(env, spec.driverVar);
  switch (declaration.kind) {
    case 'mysql': {
      const url = readVar(env, spec.urlVar);
      // Endereco obrigatorio em QUALQUER ambiente quando o driver e "mysql" (matriz, OBR-M).
      return url === undefined
        ? { config: MEMORY, errors: [missingUrlError(spec)], warnings: [] }
        : { config: { driver: 'mysql', connectionString: url }, ...NO_DIAGNOSTICS };
    }
    case 'memory':
      // Intencao declarada (FR-007): sobe em qualquer ambiente, sem erro. Em producao, com aviso.
      return isProduction
        ? { config: MEMORY, errors: [], warnings: [declaredMemoryWarning(spec)] }
        : { config: MEMORY, ...NO_DIAGNOSTICS };
    case 'absent':
      return isProduction
        ? { config: MEMORY, errors: [missingDriverError(spec)], warnings: [] }
        : { config: MEMORY, errors: [], warnings: [missingDriverWarning(spec)] };
    case 'invalid':
      // Quem digitou "mysqll" quis dizer "mysql": cobrar tambem o endereco fecha os dois defeitos
      // no mesmo deploy (US2-2). Fora de producao a regra segue permissiva, so que nao mais calada.
      return isProduction
        ? {
            config: MEMORY,
            errors: [
              invalidDriverError(spec, declaration.value),
              ...(readVar(env, spec.urlVar) === undefined ? [missingUrlError(spec)] : []),
            ],
            warnings: [],
          }
        : {
            config: MEMORY,
            errors: [],
            warnings: [invalidDriverWarning(spec, declaration.value)],
          };
  }
};

const resolveReportsSource = (env: Env, spec: ReportsSourceSpec): Result<string, string> => {
  // D4: valida-se o endereco EFETIVO. Validar so o override acusaria falta do que na pratica
  // existe — QA e producao usam a cascata e nao declaram os overrides.
  //
  // As duas leituras passam por `readVar`, entao `''` conta como AUSENTE nos dois degraus da
  // cascata — simetrico aos outros seis modulos (W2/C4). Isto e' estritamente melhor que o
  // `override ?? source` do `server.ts` de antes: o `??` so cai em undefined, logo um override
  // vazio VENCIA a cascata e chegava vazio no pool.
  const url = readVar(env, spec.overrideVar) ?? readVar(env, spec.sourceVar);
  return url === undefined
    ? err(
        `${REPORTS_NAME}: ${spec.overrideVar} nao configurada ` +
          `(nem ${spec.sourceVar}, usada por cascata) — ` +
          `obrigatoria quando ${REPORTS_DRIVER_VAR} e "mysql"`,
      )
    : ok(url);
};

const resolveReportsSources = (env: Env): Result<ReportsDriverConfig, readonly string[]> => {
  // `combine` acumula os erros das quatro fontes antes de abortar — a fonte que falta deixa de
  // interromper sozinha o boot, como faz hoje `reports/.../composition.ts` (4 throws, exit 1).
  // Argumentos de tipo explicitos: o erro `E` so aparece dentro do mapped type do parametro,
  // posicao de onde o compilador nao consegue inferi-lo (cai em `unknown`).
  const sources = combine<[string, string, string, string], string>([
    resolveReportsSource(env, REPORTS_SOURCE_SPECS.partners),
    resolveReportsSource(env, REPORTS_SOURCE_SPECS.financial),
    resolveReportsSource(env, REPORTS_SOURCE_SPECS.contracts),
    resolveReportsSource(env, REPORTS_SOURCE_SPECS.budgetPlans),
  ] as const);
  if (!sources.ok) return err(sources.error);
  const [partnersUrl, financialUrl, contractsUrl, budgetPlansUrl] = sources.value;
  return ok({ driver: 'mysql', partnersUrl, financialUrl, contractsUrl, budgetPlansUrl });
};

const resolveReports = (env: Env, isProduction: boolean): Resolution<ReportsDriverConfig> => {
  const spec = { name: REPORTS_NAME, driverVar: REPORTS_DRIVER_VAR };
  const declaration = readDriver(env, REPORTS_DRIVER_VAR);
  switch (declaration.kind) {
    case 'mysql': {
      const sources = resolveReportsSources(env);
      return sources.ok
        ? { config: sources.value, ...NO_DIAGNOSTICS }
        : { config: MEMORY, errors: sources.error, warnings: [] };
    }
    case 'memory':
      return isProduction
        ? { config: MEMORY, errors: [], warnings: [declaredMemoryWarning(spec)] }
        : { config: MEMORY, ...NO_DIAGNOSTICS };
    case 'absent':
      return isProduction
        ? { config: MEMORY, errors: [missingDriverError(spec)], warnings: [] }
        : { config: MEMORY, errors: [], warnings: [missingDriverWarning(spec)] };
    case 'invalid': {
      if (!isProduction) {
        return {
          config: MEMORY,
          errors: [],
          warnings: [invalidDriverWarning(spec, declaration.value)],
        };
      }
      const sources = resolveReportsSources(env);
      return {
        config: MEMORY,
        errors: [invalidDriverError(spec, declaration.value), ...(sources.ok ? [] : sources.error)],
        warnings: [],
      };
    }
  }
};

export const readModuleDriverConfigs = (
  env: Env,
): Result<ModuleDriverConfigs, readonly string[]> => {
  const isProduction = env['NODE_ENV'] === 'production';

  const auth = resolveModule(env, MODULE_SPECS.auth, isProduction);
  const contracts = resolveModule(env, MODULE_SPECS.contracts, isProduction);
  const partners = resolveModule(env, MODULE_SPECS.partners, isProduction);
  const programs = resolveModule(env, MODULE_SPECS.programs, isProduction);
  const financial = resolveModule(env, MODULE_SPECS.financial, isProduction);
  const budgetPlans = resolveModule(env, MODULE_SPECS.budgetPlans, isProduction);
  const reports = resolveReports(env, isProduction);

  // Ordem estavel (a dos modulos) para que a saida seja previsivel e testavel por igualdade.
  const diagnostics: readonly Diagnostics[] = [
    auth,
    contracts,
    partners,
    programs,
    financial,
    budgetPlans,
    reports,
  ];
  const errors = diagnostics.flatMap((entry) => entry.errors);
  if (errors.length > 0) return err(errors);

  return ok({
    modules: {
      auth: auth.config,
      contracts: contracts.config,
      partners: partners.config,
      programs: programs.config,
      financial: financial.config,
      budgetPlans: budgetPlans.config,
      reports: reports.config,
    },
    warnings: diagnostics.flatMap((entry) => entry.warnings),
  });
};
