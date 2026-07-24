# DENO-CUTOVER-GATE — W1 (deno-runtime-expert playbook)

## Resultado: ⚠️ BLOQUEADO — typecheck-sob-Deno precisa de investigação dedicada (escalado)

3 dos 4 gates são triviais sob Deno; o **typecheck** revelou um blocker real. `deno.json` foi
**revertido** ao estado verde da Etapa 2 (não commito gate meio-quebrado).

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

## Alternativa (tsc-sob-Deno) — também não trivial

`deno run -A npm:typescript@6.0.0/bin/tsc` falhou no specifier (`6.0.0` exato não existe; é range).
Mesmo com o specifier certo, o `tsc` sob Deno precisaria resolver `@types/node` + tsconfig sem o
node_modules — questão em aberto.

## Escalado ao humano (decisão de rota do typecheck-sob-Deno)

Nenhum é hack de 2 minutos. Opções:
- **A** — manter `tsc` como ferramenta de typecheck, invocado sob Deno com o specifier certo
  (`npm:typescript@<range>`), validando resolução de `@types` sob Deno.
- **B** — corrigir o `deno check` nativo (investigar `compilerOptions.types`/lib/module p/ o
  `@types/node` não estragar o `ImportMeta`). Spike dedicado.
- **C** — diferir só o typecheck: entregar os 3 gates (test/prettier/eslint sob Deno) e manter
  `pnpm run typecheck` (tsc) até o fim, migrando o typecheck por último.

Os outros 3 gates ficam prontos para entrega assim que a rota do typecheck for decidida.
