# DENO-SUBPROCESS-COMMAND — W0 (deno-runtime-expert playbook)

## Resultado: 🟡 A premissa "fecha 17 spawn-tests quebrados" era FALSA — correção

O W0 (fail-first) revelou que a justificativa que eu dei para o `Deno.Command` estava **errada**.

## Achado

Os testes que fazem `spawn(process.execPath, ['--experimental-strip-types', …])` **PASSAM** sob
`deno test` quando `--allow-run` é concedido (o `deno.json#test` task tem):

```
deno test --allow-run tests/jobs/auth/            → ok | 4 passed | 0 failed
deno test --allow-run tests/scripts/only-allow-pnpm.test.ts → ok | 1 passed | 0 failed
deno test --allow-run tests/pipeline/state-cli.test.ts     → ok | 4 passed | 0 failed
```

A "falha `-1`" que reportei no `DENO-CUTOVER-GATE` (W3) veio de eu rodar o comando manual **sem**
`--allow-run` → o spawn era negado (`NotCapable`) → exit -1. Com `--allow-run` (como no task real),
o `deno` **tolera** as flags Node (`--experimental-strip-types`/`--no-warnings`) e roda o script; os
testes checam o exit code correto e passam.

## Consequência para o valor do `Deno.Command`

O `Deno.Command` **não** fecha testes quebrados (não há testes quebrados). O ganho real é menor:

1. **Idiomático Deno** (a preferência do dono) — API nativa.
2. **Permission-gated** por `--allow-run` (integra ao manifesto).
3. **Robustez** — invocação `deno run` própria em vez de depender do `deno` tolerar flags do Node
   (`--experimental-strip-types`), que uma versão futura pode rejeitar.

Não é bug-fix; é refactor idiomático/robustez.

## Decisão do dono (informada): PROSSEGUIR — migração de tecnologia deno-like

Com a correção na mesa, o dono decidiu migrar mesmo assim: *"passar tudo que der para as APIs do
Deno que não vá quebrar o código — isso é migração de tecnologia de verdade"*. O RED se reframe:
**o código usa `node:child_process`, não a API nativa `Deno.Command`** — fail-first de estilo/estética
Deno, não de bug. W1 migra os ~20 arquivos. Roadmap completo: `.claude/.planning/DENO-NATIVE-MIGRATION.md`.
