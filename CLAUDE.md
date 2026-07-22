# CLAUDE.md

> Este arquivo é um **stub**. O contexto canônico deste repo vive em `AGENTS.md`
> (padrão aberto, multi-ferramenta). O Claude Code carrega o conteúdo via import abaixo.

@AGENTS.md

<!-- SPECKIT START -->

Plano corrente: `specs/037-persistence-driver-boot-guard/plan.md` (**Guarda de boot da configuração de persistência** — issue #456, P1). O defeito: `env['X_DRIVER'] === 'mysql' ? mysql : memory` copiado em **7 pontos** do `src/server.ts` faz fallback **silencioso** para `memory` — inclusive com `NODE_ENV=production` —, então a API sobe respondendo 200 com dado vazio e **descarta tudo no restart**. Já custou dado 2×: **#374** (budget-plans, 7 tabelas `bgp_*` zeradas num banco cheio) e **#444** (reports vazios em prod) — 2 de 7 módulos, e 100% dos adicionados depois que o padrão se consolidou. O argumento que decide é **precedente do próprio repo**: `src/shared/http/email-link-base-urls.ts` já resolveu essa classe para links de e-mail (#331/#332) com **boot falhando** em produção — hoje o core-api derruba o boot por link de e-mail errado mas degrada calado quando o **banco inteiro some**. Alvo: **uma** função em `src/shared/persistence/module-driver-config.ts` devolvendo `Result<configs, readonly string[]>` (erros **acumulados**, exit **78** = `EX_CONFIG`); fora de produção `memory` + aviso por módulo; `memory` **explícito** válido sempre. Decisões da P.O. (clarify): escopo **só** driver dos 7 módulos (storage de logo → issue nova, anti-padrão #15/ADR-0040); as **4 fontes** do `reports` seguem obrigatórias — já são (`reports/.../composition.ts:109-119` lança), muda só a **forma** (hoje sai exit 1 "app quebrada", não 78 "config errada"). ⚠️ Risco #1: **não** endurecer as 2 degradações com ADR — réplica de leitura (**ADR-0026**) e composição de programa (**ADR-0032**) — travadas nos casos 13/14 do W0. Tamanho **M**, 1 arquivo novo + composition root + 1 suíte (14 casos, unidade pura). Próximo: `/speckit-tasks`.
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan.

<!-- SPECKIT END -->
