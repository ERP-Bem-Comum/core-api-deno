[← Voltar para ADRs](./README.md)

# ADR-0054: Deno como Runtime (supersedes ADR-0002, ADR-0009)

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** Arquiteto técnico + Gabriel Aderaldo
- **Supersedes:** [ADR-0002](./0002-keep-nodejs-runtime.md) (Node.js como runtime único) · [ADR-0009](./0009-node-24-typescript-6-with-7-roadmap.md) (Node 24 LTS + TS 6)
- **Relacionado:** [ADR-0055](./0055-postgresql-supersedes-mysql.md) (PostgreSQL) — decidido no mesmo movimento de re-plataforma.

---

## Contexto

A [inquiry 0023](../../inquiries/0023-language-runtime-reevaluation.md) reabriu a escolha de runtime. O ADR-0002 já listava "Migrar para Deno" como alternativa rejeitada, com o critério de re-avaliação nº 1 sendo o suporte a libs bancárias (CNAB/OFX). Esse critério **não se materializou** (OFX é regex puro; XML via `fast-xml-parser` JS puro; sem remessa CNAB). O ADR-0009 previa re-avaliação "quando Node 26 LTS for lançado e TS 7 estável" — ambos ocorreram até jul/2026.

A decisão foi **medida, não suposta**, num spike (`spike/0023`) que portou a suíte de testes real (4335 testes / 708 arquivos) para cada candidato e comparou lado a lado. Evidência versionada: harness `scripts/migration/runtime-signature.ts` (commits `190e674f`, `c484a290`).

## Decisão

**Adotar o Deno como runtime único** do `core-api` (borda HTTP, workers, jobs), substituindo o Node.js.

Bases da decisão, todas medidas:

1. **Correção — zero incompatibilidade.** O `node:test` roda nativo no Deno: `domain` 983=983, as 6 suítes de integração (MySQL real) em paridade com o Node, e `all-unit` **4335/0** com as permissões corretas. **O `node:test` é mantido** — não há migração de teste (ver §"Consequências").
2. **Modelo de permissões least-privilege.** Manifesto derivado do uso real de `src/` e validado (`deno.json`): produção **sem** `--allow-run` (zero `child_process` em `src/`) nem `--allow-write` (só workers, escopado); `--allow-sys` obrigatório (mysql2/driver lê hostname). É um ganho de segurança que o Node não oferece nativamente.
3. **Toolchain unificado.** `deno fmt`/`lint`/`check`/`test`/`bench` num binário só, versionado no `deno.json`.

**O que continua igual:** o Drizzle, os drivers de banco (via `npm:`), o `node:test`, a arquitetura ports/adapters, o domínio puro. O Deno é um **port de runtime**, não um rewrite — ~90% de reaproveitamento (inquiry 0023 §4.2).

## Consequências

### Positivas
- Zero migração de teste — os ~12.271 `assert.*` e 4.425 `it()` ficam como estão (`node:test` nativo).
- Segurança por permissões explícitas (manifesto pronto).
- TS nativo sem flag; toolchain colapsado.
- Deploy de binário único viável (`deno compile`) — provado bootando o `server.ts` inteiro contra MySQL real no x99, escutando na :3000.

### Negativas
- **Execução de teste ~2× mais lenta** que o Node 26 (all-unit 202s vs 88s) — overhead da camada `node:test`.
- **`deno lint` é mais raso que o `typescript-eslint` type-aware** (perde regras). Mitigação: manter o `eslint` type-checked no gate W3 durante a transição, `deno lint` como complemento.
- Binário `deno compile` grande (~459 MB) — usar imagem com `deno cache` em vez de compile enquanto o tamanho não for endereçado.
- **Lock-in de runtime** — primitivas Deno-específicas (`Deno.Kv`, `Deno.cron`) são porta de mão única; evitá-las mantém a reversibilidade.

### Neutras
- O port é gradual (strangler-fig, §abaixo); Node e Deno coexistem por módulo durante a transição, com o harness travando cada avanço.

## Alternativas consideradas

- **Bun** — o mais rápido e o melhor deploy (binário 98 MB), mas o `bun test` **não roda a suíte** (130/4335; bun#5090, `describe` aninhado no compat `node:test`). Sair do Node exigiria migrar **~12.271 asserções** de `assert` para `expect` (`bun:test`, mudança de paradigma) ou manter os testes no Node (híbrido — não sai do Node). **Rejeitado por ora**; reabrir se o bun#5090 for corrigido (aí a migração vira zero, como no Deno).
- **Manter Node (26) + tsgo** — a opção de **menor risco e zero lock-in** (Node 26: 4335/0, 1,6× mais rápido; tsgo 5,7× no typecheck). Rejeitada porque o objetivo declarado inclui o modelo de permissões e o toolchain do Deno, não só velocidade. **Registrada como o fallback** se a migração ao Deno se mostrar cara demais na prática.

## Estratégia de migração (strangler-fig)

1. **Gate de regressão:** o harness de assinatura diferencial (Node × Deno) trava cada passo — a assinatura Deno não pode introduzir falha/erro que o Node não tinha, nem rodar menos testes (arquivo que não carrega).
2. **Por módulo**, certificar sob Deno mantendo o Node autoritativo até a paridade; virar a chave quando verde.
3. **CI shadow lane:** job Deno report-only até igualar a assinatura do Node em N execuções; então promover a gate.
4. **Permissões:** aplicar o manifesto least-privilege do `deno.json` no deploy.

## Quando re-avaliar

- Se a lentidão de teste (~2×) inviabilizar o CI na prática → reconsiderar Node 26 + tsgo (o fallback registrado).
- Se o bun#5090 for resolvido e o deploy enxuto do Bun se tornar prioritário → reabrir Bun.

## Referências

- [Inquiry 0023](../../inquiries/0023-language-runtime-reevaluation.md) · harness `scripts/migration/runtime-signature.ts` · manifesto `deno.json`.
- Relatório executivo do estudo (medições): artifact publicado em 2026-07-23.
