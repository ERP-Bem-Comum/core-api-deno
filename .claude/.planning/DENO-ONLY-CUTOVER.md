# Épico: Cutover Deno-only

> **Status:** planejado (aguardando execução) · **Decisão:** [ADR-0054](../../handbook/architecture/adr/0054-deno-runtime-supersedes-node.md) + [ADR-0056](../../handbook/architecture/adr/0056-deno-only-cutover-amends-0054.md) · **Frente paralela:** [ADR-0055](../../handbook/architecture/adr/0055-postgresql-supersedes-mysql.md) (Postgres)

## Objetivo

Runtime único = **Deno**. **Node e pnpm saem totalmente.** Sobrevive só **pacote npm sem boa
alternativa no JSR**, via `npm:PACOTE` consumido pelo Deno. O código **já roda em Deno** (spike
`spike/0023`: 4335/0, integração em paridade, binário bootando) — então isto é **tooling/config**,
não port.

## Gate de regressão (muda com o cutover)

O harness era Node×Deno. Conforme o Node sai, o gate vira **assinatura Deno vs último-Deno-bom**.
Baseline Deno já capturado (`scripts/migration/runtime-signature.ts`, lanes `domain`/`all-unit`/`int-*`).
Cada etapa: `deno test` verde + assinatura ≥ baseline antes de avançar.

## As 4 etapas (sequenciadas, cada uma um ticket W0→W3 sob Deno)

### Etapa 1 — Tooling (destrava tudo)
- `deno.json` assume `#src/*` e `#scripts/*` (hoje em `package.json#imports`) via `imports` map.
- `deno.json` `tasks` cobrem serve/workers/jobs/test (já esboçado no manifesto least-privilege).
- Remove a dependência do `--experimental-strip-types` (Deno roda `.ts` nativo).
- **Verifica:** `deno test` verde sem `package.json` no path de resolução.
- **Destrava:** as etapas 2–4.

### Etapa 2 — Dependências (JSR onde bom, `npm:` no resto)
| Camada | Alvo | Flag |
| --- | --- | --- |
| JWT | `jsr:@panva/jose` | 🟢 oficial |
| Validação | `jsr:@zod/zod` (ver nota OpenAPI) | 🟢 |
| Std lib | `jsr:@std/*` (substitui `node:*` onde houver) | 🟢 diretriz: `@std` sempre |
| Cripto | Web Crypto nativo (`crypto.subtle`) | 🟢 |
| ORM | `npm:drizzle-orm` (`/postgres-js` ou `/mysql2`) | ⚪ |
| DB driver | `npm:postgres` (postgres.js) | ⚠️ **não** o JSR `@db/postgres` (imaturo) |
| Hash senha | `npm:hash-wasm` ou `jsr:@stdext/crypto` — **WASM, nunca FFI** | ⚠️ |
| S3 | `npm:@aws-sdk` **se** IAM Role resolver no Deno (verificar); senão `aws4fetch` | ⚠️ testar |
| Email | `npm:nodemailer` + SES (soberania de dado) | ⚠️ segurança vence |
| XML/PDF | `npm:fast-xml-parser`, `npm:unpdf` | ⚪ JS-puro |
- **Verifica:** `deno test` verde com os specifiers novos; `deno lock` gerado.

### Etapa 3 — Enforce (ticket `DENO-WS-HYBRID` reescopado)
- 46 imports cross-módulo `#src/modules/X/public-api/...` → `@core/X/...` (Deno-only).
- `deno.json` dos membros já existe (fatia 1, `72448d6e`).
- **Verifica:** `@core/X/domain/...` → `Unknown export` (enforce ativo); suíte verde.

### Etapa 4 — Remoção (Node/pnpm saem)
- CI: `deno fmt/lint/check/test` no lugar de tsc/prettier/eslint/node-test.
- Docker: imagem `denoland/deno` + `deno cache`; remove corepack/pnpm/node_modules/tini-Node.
- **Delete:** `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, os `#experimental-strip-types`.
- Supply-chain: `deno approve-scripts` + `minimumDependencyAge` + `deno audit` substituem o
  hardening pnpm (ADR-0011).
- **Verifica:** build da imagem Deno sobe o app; deploy no x99.

## Dependências

```
Etapa 1 (tooling) ──> Etapa 2 (deps) ──> Etapa 3 (enforce) ──> Etapa 4 (remoção)
                                    └────────────────────────────┘
Postgres (ADR-0055) — frente PARALELA, independente do runtime
```

## Incógnitas a validar (spikes isolados, antes das etapas 2/4)
1. `@aws-sdk` resolve credencial **IAM Role** no Deno de 2026? (issue #4405) — senão `aws4fetch`.
2. argon2 WASM **bloqueia o event loop**? (DoS no login) — rodar sob Worker se sim.
3. Worker-permissions é **unstable** (`--unstable-worker-options`) — decidir uso na isolação da VAN.

## Isolamento (já desenhado, sem mudar de plataforma)
- **VAN-Bancária:** ECS service dedicado + IAM/SG (egress whitelist) + segredos escopados +
  Worker Deno (Level 2) para o parse não-confiável. Ver panorama de segurança da sessão.
- **npm de risco:** rodar em Worker com permissões reduzidas (`--unstable-worker-options`).

## Notas
- **OpenAPI (ADR-0027):** hoje acoplado ao Fastify (`fastify-zod-openapi`). Com **Hono** (o HTTP
  recomendado pelo Deno), muda para o stack Hono (`@hono/zod-validator` + zod-openapi do Hono) —
  **peça estrutural grande, ADR próprio**, fora deste épico.
- **Bun** fica como opção futura se o bun#5090 (test runner) for corrigido — hoje inviável
  (12k asserções para migrar). Node 26 + tsgo = fallback estratégico se o cutover falhar.
