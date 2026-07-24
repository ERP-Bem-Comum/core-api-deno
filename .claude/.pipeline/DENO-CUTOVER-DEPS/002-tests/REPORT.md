# DENO-CUTOVER-DEPS — W0 (deno-runtime-expert playbook)

## Resultado: 🔴 RED — as ~15 deps externas não resolvem sob Deno sem import map

Fail-first: hoje a resolução dos bare specifiers de npm sob Deno depende do `package.json`. Isolando
com `DENO_NO_PACKAGE_JSON=1`, quebram.

## Gate RED

```
$ DENO_NO_PACKAGE_JSON=1 deno check src/server.ts
TS2307 [ERROR]: Import "fastify" not a dependency and not in import map ...
TS2307 [ERROR]: Import "@fastify/helmet" ... / "@fastify/cors" / "@fastify/rate-limit" / "@fastify/swagger" / "@fastify/swagger-ui"
TS2307 [ERROR]: Import "fastify-zod-openapi" ...
TS2307 [ERROR]: Import "@aws-sdk/client-s3" ...
TS2307 [ERROR]: Import "zod/v4" ...
(... 169 imports externos não-resolvidos)
```

## Sinal limpo (separação de etapas)

| categoria | não-resolvidos sob isolamento |
| --- | --- |
| bares externos (fastify, mysql2, drizzle-orm, zod, @fastify/*, @aws-sdk/*, jose, …) | **169** |
| `#src/` | **0** ← Etapa 1 (DENO-CUTOVER-TOOLING) já cobriu |

Confirma que este ticket é **exatamente** a superfície externa — o `#src/` já resolve via `deno.json`.

## Superfície a mapear (enumerada)

Contagem de uso em `src/`+`scripts/`+`tests/`: drizzle-orm (148), fastify (81), mysql2 (21),
fastify-zod-openapi (19), zod (17, como `zod/v4`), @aws-sdk/client-s3 (7), nodemailer (5), jose (3),
+ unpdf, resend, hash-wasm, fast-xml-parser, @fastify/{cors,helmet,rate-limit,swagger,swagger-ui},
@aws-sdk/s3-request-presigner (1 cada). Subpaths: `drizzle-orm/{mysql-core,mysql2,mysql2/migrator}`,
`mysql2/promise`, `zod/v4`.

## Especificação do W1

Adicionar ao `deno.json#imports` os mapeamentos externos (bare + trailing-slash onde há subpath),
`jsr:@panva/jose` para jose, `npm:` para o resto (zod fica `npm:`). Gerar `deno.lock`. Depois:
`DENO_NO_PACKAGE_JSON=1 deno check src/server.ts` → GREEN.
