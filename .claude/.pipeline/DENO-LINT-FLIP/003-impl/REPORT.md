# DENO-LINT-FLIP — W1+W3 (consolidado)

## 🟢 GREEN — gate de lint flipado eslint → deno lint

## Mudança

- `deno.json#lint.rules.exclude`: `require-await` (o eslint do projeto já tem 'off'), `no-slow-types`
  (regra de publicação JSR — irrelevante p/ workspace interno), `no-control-regex` (o eslint não
  enforça; os usos são sanitização de input legítima com control chars intencionais).
- 2× `// eslint-disable-next-line @typescript-eslint/no-explicit-any` → `// deno-lint-ignore
  no-explicit-any` (document.mapper.ts:574, driver-pool-delegation.test.ts:26) — exceções documentadas.
- task `lint`: `deno run -A npm:eslint@10.3.0 .` → `deno lint`.
- Removido `isolatedModules` do `deno.json#compilerOptions` (o Deno o ignorava → aviso cosmético em
  todo comando; o tsc o lê do tsconfig.json, não daqui).

## Verificação

- `deno task lint` → **Checked 1698 files, rc=0** (era 544 problemas: 526 require-await + 11
  no-slow-types + 5 no-control-regex + 2 no-explicit-any).
- `deno task check` → verde.
- Cobre o código Deno-native da fatia 1 (o eslint quebrava nele com `no-unsafe-*` por não tipar `Deno`).

## Impacto

O gate de lint agora conhece `Deno.*` — **destrava as fatias 2-8** (cada uma gera mais `Deno.*`, que
o eslint rejeitaria). O eslint sai de cena (será removido junto com o pnpm na Etapa 4 core).
