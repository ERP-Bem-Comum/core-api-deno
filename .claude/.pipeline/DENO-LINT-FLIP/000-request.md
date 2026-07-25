# DENO-LINT-FLIP — escopo

> Size M. Fatia do épico DENO-ONLY-CUTOVER (habilita o gate de lint p/ código Deno-native).
> O eslint roda com @types/node e NÃO tipa `Deno.*` → dispara `no-unsafe-*` em todo código Deno.
> O `deno lint` conhece `Deno.*`. Flip: `lint` task `eslint` → `deno lint`.

## CAs
- CA1: `deno.json#lint` configurado (rules alinhadas ao eslint do projeto).
- CA2: `deno lint` no repo inteiro → 0 problemas.
- CA3: task `lint` = `deno lint` (não mais `npm:eslint`).
- CA4: os arquivos Deno-native migrados (fatia 1) passam.
