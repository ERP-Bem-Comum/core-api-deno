# DENO-CUTOVER-TOOLING — W1 (deno-runtime-expert playbook)

## Resultado: 🟢 GREEN — `deno.json` assume `#src/`/`#scripts/`, independente do `package.json`

## Mudança (mínima)

`deno.json` — adicionada a chave `imports` (trailing-slash), logo após `workspace`:

```jsonc
"imports": {
  "#src/": "./src/",
  "#scripts/": "./scripts/"
}
```

Nada em `src/` tocado. Único outro arquivo: o probe do W0 (`tests/migration/deno-import-map.probe.test.ts`).

## Provas GREEN

**1. Gate isolado (era RED no W0):**
```
$ DENO_NO_PACKAGE_JSON=1 deno check tests/migration/deno-import-map.probe.test.ts
Check ...   # rc=0  ← GREEN (era rc=1)
```

**2. Probe sob `deno test` (node:test nativo), isolado do package.json:**
```
$ DENO_NO_PACKAGE_JSON=1 deno test --no-check tests/migration/deno-import-map.probe.test.ts
ok | 1 passed (1 step) | 0 failed   # rc=0
```

**3. Código de módulo REAL resolve puro via deno.json (não só o probe):**
```
$ DENO_NO_PACKAGE_JSON=1 deno test tests/modules/financial/domain/document-create-payment-detail.test.ts
ok | 1 passed (2 steps) | 0 failed   # rc=0
```

## Critérios de aceite

- **CA1** ✅ — só trailing-slash no `imports` (`deno.json:7-8`). O `#src/*` que aparece no `grep` é
  o **comentário** explicativo (`deno.json:4`), não um mapeamento.
- **CA2** ✅ — gate isolado passou (prova 1).
- **CA3** ⏭️ — suíte completa + assinatura: validado por amostragem (provas 2-3); gate cheio no W3.
- **CA4** ⏭️ — regressão zero no mundo Node: no W3.
- **CA5** ✅ — nada em `src/` alterado.

## Observações para W2/W3

- Precedência: com `deno.json#imports` presente, o Deno usa o próprio import map (o
  `package.json#imports` vira redundante até a Etapa 4). Sem conflito — o trailing-slash `#src/`
  mapeia idêntico ao glob antigo.
- O comentário no `deno.json:4` cita `#src/*` de propósito (documenta por que NÃO usar o glob).
