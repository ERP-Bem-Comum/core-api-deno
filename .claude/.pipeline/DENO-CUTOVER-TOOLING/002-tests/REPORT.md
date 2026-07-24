# DENO-CUTOVER-TOOLING — W0 (deno-runtime-expert playbook)

## Resultado: 🔴 RED — o `deno.json` sozinho não resolve `#src/`/`#scripts/` hoje

Fail-first provado: sem o `imports` map no `deno.json`, a resolução dos subpath imports internos
sob Deno **depende do `package.json`**. Isolando com `DENO_NO_PACKAGE_JSON=1`, quebra.

## Estado atual (citado)

`deno.json` **não** tem chave `"imports"` (só `workspace` + `tasks`) — confirmado:
`grep -n '"imports"' deno.json` → vazio. A suíte Deno passa hoje (4335/0) **só** via compat de
Node lendo `package.json#imports` (`package.json:19-22`: `"#src/*": "./src/*"`, `"#scripts/*": "./scripts/*"`).

## Canário (probe durável)

`tests/migration/deno-import-map.probe.test.ts` — `node:test` que importa **alvos puros** (sem bare
specifier npm, para a resolução ser o único sinal):
- `#src/` → `src/shared/primitives/result.ts` (`ok`, `isOk`)
- `#scripts/` → `scripts/etl/quarantine/reason.ts` (`describeReason`) — módulo sem imports.

## Gate RED (comando + saída)

```
$ DENO_NO_PACKAGE_JSON=1 deno check tests/migration/deno-import-map.probe.test.ts
TS2307 [ERROR]: Import "#src/shared/primitives/result.ts" not a dependency and not in import map ... :4:26
TS2307 [ERROR]: Import "#scripts/etl/quarantine/reason.ts" not a dependency and not in import map ... :5:32
Found 2 errors.
error: Type checking failed.        # rc=1  ← RED
```

## Contraste (o gate discrimina)

```
$ deno check tests/migration/deno-import-map.probe.test.ts
Check tests/migration/deno-import-map.probe.test.ts   # rc=0  ← resolve via package.json (compat Node)
```

Reconfirmado do spike: o import map do Deno usa **trailing-slash** (`"#src/": "./src/"`); o glob
estilo Node `"#src/*": "./src/*"` é **ignorado** pelo resolver (`Import ... not in import map`).

## Especificação do W1 (mudança mínima)

Adicionar ao `deno.json` a chave `imports` (trailing-slash):

```jsonc
"imports": {
  "#src/": "./src/",
  "#scripts/": "./scripts/"
}
```

Depois: `DENO_NO_PACKAGE_JSON=1 deno check <probe>` deve virar **rc=0** (GREEN) — provando que o
`deno.json` é autossuficiente, independente do `package.json`.
