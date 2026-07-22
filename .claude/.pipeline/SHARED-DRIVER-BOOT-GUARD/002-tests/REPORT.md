# SHARED-DRIVER-BOOT-GUARD — W0 (testes RED)

- **Wave**: W0 · **Outcome**: **RED** (confirmado)
- **Data**: 2026-07-22
- **Skill**: `tdd-strategist`
- **Branch**: `fix/456-driver-boot-guard` (worktree `.claude/worktrees/456-driver-boot-guard`)
- **Spec**: `specs/037-persistence-driver-boot-guard/` · **Issue**: #456 · **Incidentes**: #374, #444
- **Tarefas cobertas**: T008–T015 (US1), T022–T026 (US2), T032–T036 (US3)

## Arquivo entregue

`tests/shared/persistence/module-driver-config.test.ts` — **14 casos** em 3 `describe` (um por user
story), unidade pura, zero I/O, `node:test` + `node:assert/strict`. Nenhum arquivo em `src/` foi
tocado (disciplina fail-first).

## Assinatura assumida (contrato que o W1 tem de honrar)

O W0 fixa a forma; o W1 implementa exatamente isto ou os 14 casos não fecham.

```ts
export const readModuleDriverConfigs = (
  env: Readonly<Record<string, string | undefined>>,
): Result<ModuleDriverConfigs, readonly string[]> => { /* ... */ };

export type ModuleDriverConfigs = Readonly<{
  modules: ModuleDriverMap;      // os 7 módulos, todos presentes
  warnings: readonly string[];   // FR-006 — canal SEPARADO do de erros
}>;

export type ModuleDriverMap = Readonly<{
  auth: ModuleDriverConfig;
  contracts: ModuleDriverConfig;
  partners: ModuleDriverConfig;
  programs: ModuleDriverConfig;
  financial: ModuleDriverConfig;
  budgetPlans: ModuleDriverConfig;   // chave camelCase; nome exibido = `budget-plans`
  reports: ReportsDriverConfig;      // única com forma diferente (4 endereços)
}>;

// União discriminada por `driver` — `mysql` sem endereço é IRREPRESENTÁVEL (data-model.md)
export type ModuleDriverConfig =
  | Readonly<{ driver: 'memory' }>
  | Readonly<{ driver: 'mysql'; connectionString: string }>;

export type ReportsDriverConfig =
  | Readonly<{ driver: 'memory' }>
  | Readonly<{
      driver: 'mysql';
      partnersUrl: string;
      financialUrl: string;
      contractsUrl: string;
      budgetPlansUrl: string;
    }>;
```

Nomes dos campos do `reports` escolhidos para casar com `ReportsCompositionConfig`
(`src/modules/reports/adapters/http/composition.ts`), tornando a T029 uma passagem direta.

## Cobertura: caso → CA/FR → o que a asserção prova

| #      | Caso                                              | CA / FR           | Asserção-chave                                                                                   |
| ------ | ------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| **1**  | produção + driver ausente (`budget-plans`)        | US1-1, FR-002     | 1 erro; casa `/budget-plans/` **e** `/BUDGET_PLANS_DRIVER/` — o kebab minúsculo não pode vir da env |
| **2**  | produção + `mysql` sem URL (`auth`)               | US1-2, FR-003     | 1 erro; casa `/auth/` e `/AUTH_DATABASE_URL/`; **não** cai em memory                              |
| **3**  | produção + typo `mysqll` (`programs`)             | US1-3, FR-002     | 1 erro; casa `/mysqll/` (valor recebido) e `/memory/` (domínio aceito)                            |
| **4**  | produção + configuração completa                  | US1-4, FR-009     | `ok`; os 7 em `mysql`; `connectionString` correta; `warnings` **vazio**                            |
| **5**  | produção + 3 módulos quebrados                    | US2-1, FR-005     | `error.length === 3` — auth, programs e reports no **mesmo** retorno                               |
| **6**  | 1 módulo com 2 problemas (driver inválido + URL)  | US2-2             | `error.length === 2`; casa `/mysqll/` **e** `/AUTH_DATABASE_URL/`                                  |
| **7**  | fora de produção + nada configurado               | US3-1, FR-006     | `ok`; 7 em `memory`; `warnings.length === 7`; cada nome de módulo aparece                          |
| **8**  | `memory` explícito em produção                    | US3-2, FR-007     | `ok`, sem erro, 7 em `memory` — intenção declarada é respeitada                                    |
| **9**  | `X_DRIVER=''` e `X_DATABASE_URL=''`               | Edge Case         | `deepEqual(erro_do_vazio, erro_do_omitido)` — vazio **é** ausente, nunca "valor inválido"          |
| **10** | `NODE_ENV` ausente                                | Edge Case         | `ok`; driver ausente → `memory`, sem erro (regra permissiva)                                       |
| **11** | reports: 4 fontes por **cascata** (+ override)    | FR-012, D4        | cada URL cai no módulo-fonte **certo** (URLs distintas por módulo); override vence a cascata       |
| **12** | reports: 1 fonte não resolve                      | FR-012, US2-3     | `error.length === 2` — o erro do reports vem **acumulado** com o do auth, não isolado              |
| **13** | **CRÍTICO** — réplica de leitura ausente          | FR-008, ADR-0026  | `ok`; e com o relatório aberto por outro motivo, **nenhuma** mensagem cita `*_READER_URL`          |
| **14** | **CRÍTICO** — composição de programa indisponível | FR-008, ADR-0032  | `programs=memory` + `contracts=mysql` → `ok`; contracts segue resolvendo; idem fora de produção    |

### Por que os casos 13 e 14 estão escritos assim

A função é pura e não abre porta nem pool, então "composição indisponível" e "réplica ausente" só
podem ser observadas pela **projeção no ambiente**: o caso 13 prova que nenhuma variável `*_READER_URL`
entra no relatório de erros; o caso 14 prova que ter `programs` fora do `mysql` (única condição em que
o read port de programa não é montado, `server.ts:152-163`) **não** produz erro. São exatamente os dois
pontos em que um W1 zeloso demais atropelaria ADR aceito.

## Prova do RED

Suíte completa (`pnpm test`), cauda literal:

```text
ℹ tests 4309
ℹ suites 1234
ℹ pass 4289
ℹ fail 1
ℹ cancelled 0
ℹ skipped 19
ℹ todo 0
ℹ duration_ms 104774.773709

✖ failing tests:

test at tests/shared/persistence/module-driver-config.test.ts:1:1
✖ tests/shared/persistence/module-driver-config.test.ts (112.364167ms)
  'test failed'
[ELIFECYCLE] Test failed. See above for more details.
```

Causa do vermelho, isolando o arquivo — **é o RED correto** (inexistência da API, não asserção falsa):

```text
$ node --test --experimental-strip-types --enable-source-maps --no-warnings \
    tests/shared/persistence/module-driver-config.test.ts

node:internal/modules/esm/resolve:271
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '<repo>/src/shared/persistence/module-driver-config.ts'
  imported from '<repo>/tests/shared/persistence/module-driver-config.test.ts'
    at finalizeResolution (node:internal/modules/esm/resolve:271:11)
    ...
  code: 'ERR_MODULE_NOT_FOUND'
}

Node.js v24.16.0
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

### Baseline para o gate W3 (SC-005)

- Baseline atual da suíte: **4308** testes (4309 menos o arquivo novo, que hoje conta como 1 falha
  de módulo não resolvido).
- Alvo pós-W1: **4322** (`4308 + 14`), com `fail 0`.

### Formatação e lint do arquivo novo

- `prettier --check` → **verde** (`All matched files use Prettier code style!`).
- `eslint` → os 146 erros restantes são **todos** derivados do módulo inexistente
  (`no-unsafe-*` / "type that cannot be resolved") e somem no W1. Os 4 achados **independentes** do
  RED foram corrigidos ainda no W0: `no-dynamic-delete` (o helper `without` passou a usar
  `Object.fromEntries` + `filter`) e 3× `prefer-includes` (no caso 13).

## Premissas assumidas (o W1 depende delas)

1. **`warnings` viaja no canal de sucesso**, dentro de `ModuleDriverConfigs`, e **não** no `Result`
   de erro. D1 fixa `Result<ModuleDriverConfigs, readonly string[]>`, e a T037 pede "canal separado
   do de erros" — logo o único lugar possível é o valor de sucesso.
2. **Um aviso por módulo degradado** (`warnings.length === 7` no caso 7). Vem literalmente das
   Assumptions da spec: _"um aviso por módulo degradado"_.
3. **`memory` explícito não gera aviso** — o caso 8 **não** assere sobre `warnings`, de propósito,
   para não impedir o W1 de avisar também nesse cenário se julgar útil. Só o caso 4 exige
   `warnings` vazio, e ali todos os módulos estão em `mysql`.
4. **Nome do módulo nas mensagens = identificador kebab-case** (`budget-plans`, `reports`, `auth`…),
   igual ao da `contracts/env-matrix.md` e ao nome da pasta em `src/modules/`. É o que torna o caso 1
   verificável: `BUDGET_PLANS_DRIVER` sozinho não satisfaz `/budget-plans/`.
5. **A cascata do `reports` lê a variável de ambiente crua do módulo-fonte**, não a configuração já
   resolvida. Ou seja: `REPORTS_X_DATABASE_URL ?? X_DATABASE_URL` direto do `env` — idêntico a
   `server.ts:267-273` de hoje, que é o exigido por FR-009. Consequência exercitada no caso 1:
   `BUDGET_PLANS_DRIVER` ausente **não** derruba a fonte de orçamento do reports, porque
   `BUDGET_PLANS_DATABASE_URL` continua declarada.
6. **Driver inválido também dispara a checagem de endereço** (caso 6). É o que US2-2 pede
   literalmente; a leitura é que quem digitou `mysqll` quis dizer `mysql`, e o objetivo da US2 é
   fechar os dois defeitos num deploy só.
7. **A variável nomeada no erro do `reports` é a específica dele** (`REPORTS_FINANCIAL_DATABASE_URL`
   no caso 12). Se o W1 preferir citar as duas (a específica **e** a do módulo-fonte), o teste
   continua passando — a asserção é por conteúdo, não por igualdade de string.
8. **Nenhuma asserção depende de acentuação nem de frase exata.** Os regexes só tocam nome de módulo,
   nome de variável e o valor inválido recebido — os três elementos que FR-010 exige. O W1 tem
   liberdade total de redação.
9. **Nenhuma mensagem pode ecoar o valor de uma connection string** (`data-model.md`, seção final).
   Não há teste dedicado a isso — fica como item explícito para o W2.

## Divergências encontradas entre a spec e o `src/server.ts` real

A `contracts/env-matrix.md` foi conferida linha a linha (tarefa T005). **A matriz está correta**:
todos os números de linha e todas as variáveis batem com o `server.ts` da branch. Achados marginais:

1. **`env-matrix.md:25` cita `server.ts:150,212` para `PROGRAMS_DRIVER`.** A leitura em `:212` existe,
   mas há **uma terceira** ocorrência em `:153` (a guarda do read port de programa). O `plan.md` já
   contabiliza isso ao dizer "8 leituras de `*_DRIVER`" para 7 módulos. Sem impacto no W0 — só vale
   para o W1 não esquecer de trocar as **três** leituras de `PROGRAMS_DRIVER`.
2. **`budget-plans` já diverge dos outros 6 hoje** (`server.ts:244-245`):
   `BUDGET_PLANS_DRIVER === 'mysql' && budgetPlansWriterUrl !== undefined` — testa só `undefined`,
   **não** string vazia. Ou seja, `BUDGET_PLANS_DATABASE_URL=''` hoje entra no ramo `mysql` com
   connection string vazia. O caso 9 endurece isso para todos os módulos (vazio = ausente), o que é
   **mudança de comportamento intencional** e está coberta pelo Edge Case da spec
   (_"endereço de conexão presente mas vazio: tratado como ausente"_).
3. **`server.ts:246-254` (aviso pontual do PR #488)** existe e está exatamente onde o `research.md`
   R4 diz. O W1 tem de removê-lo (T042) para não duplicar o aviso genérico.
4. **`reports/adapters/http/composition.ts:109-119`** confirmado: são **4** `throw new Error` — um por
   fonte —, cada um interrompendo o boot sozinho com `exit 1`. É o comportamento que o caso 12
   substitui por erro acumulado com `exit 78` (FR-013).

## Próximo passo

W1 (`003-impl`): criar `src/shared/persistence/module-driver-config.ts` com a assinatura acima, no
molde de `src/shared/http/email-link-base-urls.ts` (acumula em `string[]`, `err(errors)` só no fim).
Meta: os 14 casos verdes e `pnpm test` com **4322** testes, `fail 0`.
