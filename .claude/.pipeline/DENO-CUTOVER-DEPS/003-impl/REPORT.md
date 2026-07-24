# DENO-CUTOVER-DEPS — W1 (deno-runtime-expert playbook)

## Resultado: 🟢 GREEN — import map externo declara as ~15 deps; resolução e função provadas

## Mudança

- `deno.json#imports` — adicionados os mapeamentos externos (bare + trailing-slash onde há subpath):
  `jsr:@panva/jose` para jose; `npm:` para o resto; **zod fica `npm:zod@4.4.3`** (+ `zod/`).
- `deno.lock` — regenerado do zero a partir do import map, isolado do `package.json`
  (`DENO_NO_PACKAGE_JSON=1 deno cache src/server.ts`): **885 linhas, 136 pacotes npm** + jose (jsr).

Nada em `src/` ou `package.json` tocado.

## Provas

**CA1/CA2 — resolução (169 → 0):**
```
$ DENO_NO_PACKAGE_JSON=1 deno check src/server.ts
resolução ("not a dependency"): 0    (era 169)
import.meta.url (TS2339):        6    ← pré-existente ao Deno (ver nota), NÃO deste diff
```

**CA3 — funcional (sob isolamento, resolve via deno.json+deno.lock):**
```
$ DENO_NO_PACKAGE_JSON=1 deno test tests/shared/http/
ok | 8 passed (32 steps) | 0 failed
```
O Fastify **subiu e serviu `/docs/json` (openapi 3.1.1)** — prova que `zod`+`zod-openapi`+
`fastify-zod-openapi` funcionam com zod em npm (a decisão do dual-package protege exatamente isto).

**CA4 — deno.lock + audit:** lock gerado (re-resolução deliberada: `mysql2 3.22.3→3.23.1`,
`@aws-sdk 3.1052→3.1093`; zod/fastify/drizzle pinados iguais). `deno audit` → 2 vulns (triadas abaixo).

## Triagem do `deno audit` (2 vulns, ambas `@fastify/static`)

| advisory | sev | veredito |
| --- | --- | --- |
| route guard bypass (path traversal), `<=10.1.0` | high | **pré-existente** |
| auth bypass (non-canonical URL), `<=10.1.1` | moderate | **pré-existente** |

- Transitiva: `@fastify/swagger-ui@5.2.6 → @fastify/static` (9.x). **NÃO** temos dep direta.
- **Paridade com o mundo Node:** `pnpm audit --prod` acha **3** vulns (2 high, 1 moderate) —
  `@fastify/static` **9.1.3** (também `<=10.1.1`) **+ find-my-way**. O Deno acha **2**: a re-resolução
  pegou `find-my-way` já corrigido. Ou seja, **o cutover não piora** (2 ≤ 3), e o `@fastify/static`
  é advisory **do projeto hoje**, não do cutover. Fix exige `@fastify/swagger-ui` ir ao static 10.x
  (major upstream). Superfície **dev-only** (swagger 404 em produção — provado no CA3).
- **Ação:** registrar via issue-report (afeta o mundo Node hoje); **fora do escopo** deste ticket
  (anti-padrão #15). CA4 satisfeito: high **triado**, não silencioso.

## Nota — `import.meta.url` (6× TS2339)

`deno check` type-checa `import.meta.url` diferente do `tsc` (NodeNext + @types/node). Erra **com e
sem** meu diff → **pré-existente ao Deno**, não regressão. Pertence à **Etapa 4** (onde `deno check`
substitui o `tsc`); hoje o gate de tipo é `tsc` (Node, verde) + `deno test --no-check` (runtime).
