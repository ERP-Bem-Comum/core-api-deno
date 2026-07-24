# Mapa — migração `node:*` → Deno std (`@std`/Web/`Deno.*`)

> Fase do épico [`DENO-ONLY-CUTOVER`](./DENO-ONLY-CUTOVER.md). Mapeamento por 2 agentes:
> `nodejs-runtime-expert` (lado Node, call-sites reais) + playbook `deno-runtime-expert`
> (cross-validação contra `handbook/reference/deno/llms-full.txt`). **Read-only — nada editado.**

## Veredito: 🟡 MANTER `node:*` — a migração é majoritariamente **desaconselhada**

Não por inércia: o **próprio `deno lint` endossa `node:`**. A regra oficial `no-process-global`
(`handbook/reference/deno/llms-full.txt:34257-34260`) diz literalmente:

> *"NodeJS and Deno expose `process` global but they are hard to statically analyze (…) code should
> not assume they are available. Instead, `import process from "node:process"`."*

E `:43478` — *"Prefer the explicit `node:` form anyway"*; `:48750` — *"`node:fs` also works if you
prefer"*. Ou seja, `import ... from 'node:*'` **é** o idiomático Deno para essas built-ins. Migrar
para `@std` seria churn sem ganho (e, em 3 casos, perda técnica).

## Tabela (`src/` produção — 9 módulos)

| Módulo | APIs usadas | Alvo | Veredito | Razão |
| --- | --- | --- | --- | --- |
| `node:process` (100) | `env['X']`, `exitCode`, `exit()`, `std{out,err}.write`, signals | `node:process` | **MANTER** | `deno lint` prescreve o import explícito; `process.exitCode`↔`Deno.exitCode` 1:1 |
| `node:crypto` (23) | `randomUUID`, `createHash().digest`, `randomBytes`, `timingSafeEqual`, tipo `CryptoKey` | mix | **MANTER** (polish: `randomUUID`) | `createHash`→`subtle.digest` forçaria sync→async em ~9 helpers (churn alto, contra ADR-0056); `timingSafeEqual` **sem** equivalente Web |
| `node:url` (8) | `fileURLToPath(new URL('.', import.meta.url))` | `node:url` | **MANTER** | centralizado em `src/shared/module-dir.ts`; superior a `.pathname` cru (percent-decode) |
| `node:path` (7) | `resolve()` | `node:path` | **MANTER** | `@std/path` seria swap 1:1 sem ganho |
| `node:fs/promises` (2) | `writeFile`, `appendFile` | `node:fs/promises` | **MANTER** | `@std/fs` é só p/ helpers de alto nível (copy/walk); write/append fica em `node:fs` |
| `node:fs` (1) | `readFileSync` (Docker secret no boot) | `node:fs` | **MANTER** | idem |
| `node:zlib` (1) | `inflateSync`, `inflateRawSync`, `Z_SYNC_FLUSH` | `node:zlib` | **MANTER (obrigatório)** | `DecompressionStream` **não** expõe recovery de stream truncado (usado no parser PDF) |
| `node:buffer` (1) | `Buffer.from().toString('base64url')` | `node:buffer` | **MANTER** | import explícito já é a prática correta nos 2 runtimes |
| `node:async_hooks` (1) | `AsyncLocalStorage` | `node:async_hooks` | **MANTER (obrigatório)** | **sem** equivalente Web/`Deno.*` para correlação assíncrona |

## `tests/`+`scripts/`

- **`node:test` (717) + `node:assert` (713) — FICAM.** Pilar "zero migração de teste" (rodam nativos
  sob `deno test`). Trocar por `Deno.test`/`@std/assert` = a reescrita de 12k asserções rejeitada.
- As demais built-ins em testes seguem o mesmo veredito da tabela (manter `node:`).

## Único item acionável

**`randomUUID()` → `crypto.randomUUID()` global** (Web Crypto, `llms-full.txt:6167`): ~8 call-sites,
remove o import de `node:crypto` onde só o UUID é usado, comportamento idêntico, risco trivial.
**Polish opcional** — não é requisito do cutover.

## Recomendação

Esta fase, como "migrar tudo", **não deve prosseguir** — `node:` é o alvo correto e idiomático no
Deno. O tempo rende mais nas fatias que **de fato completam o cutover**: adaptar os 17 spawn-tests,
remover `package.json`/pnpm (81 scripts→task), Dockerfile `denoland/deno`, CI, git-hooks.
