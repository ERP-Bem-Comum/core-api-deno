# SHARED-DRIVER-BOOT-GUARD — escopo

> Size **M**. Issue de origem: **#456** (P1, `debito-tecnico`). Spec completa em
> `specs/037-persistence-driver-boot-guard/` (spec + plan + research + data-model + contracts + tasks).
> Este arquivo é o resumo executável; a spec é a fonte.

## Problema

`src/server.ts` decide o driver de persistência de cada módulo com o ternário
`env['X_DRIVER'] === 'mysql' ? mysql : memory`, **copiado em 7 pontos**. O default é o inseguro:
config ausente, vazia ou com typo vira "rodar sem banco" — **sem aviso e sem falha**, inclusive com
`NODE_ENV=production`. A API sobe respondendo 200 com dado vazio e **descarta tudo no restart**.

Já custou dado duas vezes, nos dois módulos mais recentes:

- **#374** — budget-plans em `memory`: 7 tabelas `bgp_*` com zero linhas num banco com o resto cheio
  (`auth_permission`=42, `fin_documents`=9) e `__drizzle_migrations_budget_plans`=6 (schema aplicado,
  nada gravado). A P.O. validou em tela e o que viu evaporou no restart.
- **#444** — reports em `memory` em produção: os 3 relatórios sobem vazios, HTTP 200, sem erro.

**2 de 7 módulos — 100% dos adicionados depois que o padrão se consolidou.**

## Precedente que decide o desenho

`src/shared/http/email-link-base-urls.ts:5-8` já resolveu esta classe para links de e-mail (#331/#332):

> _"base ausente vazava o default localhost das composicoes para producao (…) em producao
> (NODE_ENV=production) as tres sao obrigatorias — **boot falha** em vez de enviar e-mail com link
> quebrado."_

Hoje o core-api derruba o boot por um link de e-mail errado, mas degrada calado quando o **banco
inteiro some**. A correção é aplicar o mesmo padrão à persistência.

## Alvo

Uma função em `src/shared/persistence/module-driver-config.ts`:

- `readModuleDriverConfigs(env): Result<ModuleDriverConfigs, readonly string[]>` — acumula **todos**
  os erros antes de retornar (molde do `readEmailLinkBaseUrls`).
- Em produção: driver ausente/inválido ou URL faltante ⇒ `process.exit(78)` (`EX_CONFIG`) no
  `server.ts`, com mensagem nomeando módulo + variável. A função **não** chama `exit` (fica pura).
- Fora de produção: `memory` + aviso explícito por módulo degradado.
- `memory` **explícito**: válido em qualquer ambiente.

## Critérios de aceite

CA1–CA8 e FR-001..FR-013 estão em `specs/037-persistence-driver-boot-guard/spec.md`.
Roteiro de verificação manual em `quickstart.md`. Matriz de env em `contracts/env-matrix.md`.

## Decisões da P.O. (clarify 2026-07-22)

- **Escopo restrito** ao driver de persistência dos 7 módulos. O storage de logo de programs
  (`server.ts:210`), que tem o mesmo defeito, vira **issue própria** — não se conserta aqui
  (anti-padrão #15 / ADR-0040).
- **As 4 fontes do `reports` seguem obrigatórias.** Já são hoje
  (`reports/adapters/http/composition.ts:109-119` lança por fonte ausente); muda só a **forma** —
  hoje sai `exit 1` ("app quebrada"), passa a sair `78` ("config errada"), acumulado com os demais.

## ⚠️ Risco nº 1 — não atropelar ADR

Duas degradações do `server.ts` **parecem** o mesmo fallback e não são:

| O quê                              | Onde                             | Decisão   |
| ---------------------------------- | -------------------------------- | --------- |
| Réplica de leitura opcional        | `server.ts:167-168`, `:185-186`  | ADR-0026  |
| Composição de programa degradável  | `server.ts:152-163`              | ADR-0032  |

Endurecer qualquer uma contradiz ADR aceito. Travadas nos casos **13 e 14** do W0 — os testes mais
importantes desta suíte.

## Fora de escopo

Storage de logo (issue nova) · qualquer schema/migration · qualquer rota ou contrato de borda ·
qualquer regra de domínio.
