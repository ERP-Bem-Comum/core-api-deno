# DENO-CUTOVER-GATE — W1 (deno-runtime-expert playbook)

## Resultado: 🟢 GREEN — os 4 gates rodam sob Deno; typecheck nativo limpo

O blocker do typecheck foi resolvido e os 4 gates estão verdes. `deno.json` recebeu
`compilerOptions` (types:[] + strict espelhado do tsconfig) + tasks `check`/`lint`/`fmt-check`.

## Provas (via `deno task`, config real)

- **`deno task check`** — rc=0 **LIMPO** (0 erro; era 62).
- **`deno task fmt-check`** — "All matched files use Prettier code style!".
- **`deno task lint`** — rc=0 (eslint via npm: no codebase inteiro).
- **`deno task test`** — verde na suíte não-spawn (modules+shared 1084/0); ver ressalva abaixo.

## O fix do typecheck (2 partes)

1. **`compilerOptions.types: []`** — desliga a inclusão automática do @types/node (via deno.lock),
   que estragava o ImportMeta. Derruba 62→8.
2. **Espelhar strict do tsconfig** (`noUncheckedIndexedAccess`/`exactOptional...`) → 8→6.
3. **Helper `src/shared/module-dir.ts`** — os 6 restantes eram `resolve(import.meta.dirname, …)` em
   5 arquivos (scripts/data + tests/jobs/auth): o Deno tipa `import.meta.dirname` como
   `string | undefined` (o tsc/@types/node como `string`). O helper usa `import.meta.url` (`string`
   nos dois) → 6→0. Regressão zero no Node: `tsc` + `pnpm test` **4307/0**.

## Ressalva CA3 — testes que fazem spawn do runtime (follow-up, fora de escopo)

`deno task test` na suíte INTEIRA tem **17 arquivos** que `spawn(process.execPath, ['--experimental-
strip-types', …])`. Sob Deno o `process.execPath` **é o `deno`**, e as flags do Node são inválidas →
exit -1. **Não é regressão deste ticket** (os mesmos passam sob `node --test`); é a classe
"adaptar spawn Node→Deno", follow-up da adaptação do harness (registrar). O gate-tooling em si está
entregue.

## BREAKTHROUGH — o fix do ImportMeta

`compilerOptions: { types: [] }` no `deno.json` **desliga a inclusão automática do `@types/node`**
ambiente (que estragava o `ImportMeta`). Efeito medido no check amplo (`src/ scripts/ tests/`):

- **62 → 8 erros.** Sumiram TODOS os 52 `ImportMeta` (TS2339) + 10 TS2584.

## Os 8 residuais (bounded — não é blocker)

- **6× TS2345** `'string | undefined' não-atribuível a 'string'`.
- **2× TS2322** objeto de domínio (`bank/agency/...`, `keyType/key`) com `| undefined` extra.

Causa provável: o `deno check` usa os `compilerOptions` do `deno.json` (só `types:[]`), **sem** os
flags strict do `tsconfig.json` (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, …). O
`tsc` passa com eles. **Próximo passo do W1:** espelhar os `compilerOptions` strict do tsconfig no
`deno.json` e reavaliar — os 8 devem alinhar com o tsc (que é verde) ou revelar gaps reais
Deno-node-types (fix pontual com narrowing/cast).

## O que FUNCIONA (provado)

- **`deno test`** — nativo, verde (já é task).
- **format** — `deno run -A npm:prettier@3.8.3 --check .` roda; mesmas regras, zero churn.
- **lint** — `deno run -A npm:eslint@10.3.0 .` roda (rc=0 num arquivo).

## O blocker: `deno check` e o `ImportMeta`

`deno check` erra `TS2339 Property 'url'/'dirname' does not exist on type 'ImportMeta'` (52×) +
`TS2584` (10×). Causa-raiz **corrigida vs minhas hipóteses erradas**:

1. **NÃO** é o `node_modules` do pnpm — movi o `node_modules` para fora e o erro **persistiu**.
2. **NÃO** se auto-resolve na remoção do `package.json` — o `@types/node@26.1.1` é puxado por
   **mysql2/drizzle via `deno.lock`** para a **cache npm do próprio Deno**, e fica no grafo de tipos.
3. `nodeModulesDir: "none"` **não** limpa (o `@types/node` vem da cache, não do node_modules).
4. O `@types/node@26` declara `ImportMeta` **sem `url`** sob o module-mode que o `deno check` usa
   (o `.url`/`.dirname` só aparece sob `module: nodenext`, que o `tsc` usa e o `deno check` não).

O probe puro (sem NENHUM npm dep) passa — por isso o teste isolado inicial enganou.

O probe puro (sem NENHUM npm dep) passa — por isso o teste isolado inicial enganou. A rota **B**
(corrigir o `deno check` nativo via `compilerOptions`) foi a vencedora — ver breakthrough acima.

## Estado e próximo passo do W1

- **Fix do blocker:** `compilerOptions.types: []` (62→8 erros). **Ainda não commitado** — o `deno.json`
  está no estado verde da Etapa 2 até os 8 residuais fecharem.
- **Continuar:** espelhar os `compilerOptions` strict do `tsconfig.json` no `deno.json`, resolver os
  ≤8 sites (narrowing/cast ou alinhamento de config), então adicionar as tasks `check`/`lint`/`fmt-check`
  + `nodeModulesDir` e provar os 4 gates verdes (W1→GREEN), W2, W3.
- Os outros 3 gates (test/prettier/eslint sob Deno) já estão provados prontos.
