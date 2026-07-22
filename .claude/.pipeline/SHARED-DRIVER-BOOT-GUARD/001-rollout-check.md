# T005/T006 — Conferência de contrato de ambiente e impacto de rollout

**Ticket**: SHARED-DRIVER-BOOT-GUARD · **Data**: 2026-07-22 · **Base**: `dev` @ `6b101b8e`

Executado **antes** do W0, conforme a Phase 2 do `tasks.md`. É a tarefa que decide se este deploy é tranquilo ou traumático.

## T005 — A matriz bate com o código?

**Sim.** `contracts/env-matrix.md` conferida contra `src/server.ts`: 8 leituras de `*_DRIVER` para 7 módulos, todas as variáveis e linhas corretas.

Um ajuste: `PROGRAMS_DRIVER` tem **3** leituras (`:153` no read port de contracts, `:212` no módulo), não 2 como a matriz sugeria. Sem impacto no contrato — a variável é a mesma; o W1 foi avisado para não esquecer a `:153`.

## T006 — Os ambientes vão continuar subindo?

### PRODUÇÃO — sem impacto esperado

O `compose.yaml` declara os **7** drivers e as 6 connection strings (`:284-305`). O `reports` não precisa de secret novo: as 4 fontes resolvem por cascata a partir dos `*_DATABASE_URL` dos módulos-fonte, todos presentes.

Conclusão: **produção corretamente configurada sobe idêntico** (FR-009). A guarda não dispara.

O próprio compose já documentava o defeito que este ticket corrige, em `compose.yaml:279-281`:

> ⚠️ TODO módulo registrado no server.ts precisa do seu `*_DRIVER` AQUI. O server degrada para
> in-memory EM SILÊNCIO quando o driver falta (HTTP 200 com lista vazia, sem log) — foi o que
> deixou budget-plans (#374) e reports (#444) mudos em produção. Ver #456 (fail-fast no boot).

Ou seja: a correção estrutural que este ticket entrega substitui um aviso em comentário — que depende de alguém ler — por uma garantia mecânica.

### O susto do `NODE_ENV` — investigado e descartado

`NODE_ENV: development` é a **única** ocorrência de `NODE_ENV` no `compose.yaml` (`:283`). Se esse valor valesse em produção, a guarda nunca dispararia lá, e a feature nasceria morta — junto com o aviso do PR #488 (`server.ts:249`, condicionado a `production`) e a obrigatoriedade das base URLs de e-mail (#331/#332).

**Não é o caso.** Duas evidências literais:

- `compose.yaml:2-11` — _"Docker Compose — ambiente de DESENVOLVIMENTO/HOMOLOGAÇÃO local (…) Em produção este compose NÃO sobe — endpoints viram managed services (AWS S3, AWS RDS/Cloud SQL) com secrets vindo do Secrets Manager."_
- `Dockerfile:96` — `ENV NODE_ENV=production`, na imagem que roda em produção.

O `development` do compose é deliberado para o ambiente local. A imagem carrega `production`.

### ⚠️ QA — ponto de atenção real que sobrou

O QA roda com um compose **não-versionado, editado à mão no host** (drift conhecido). Duas consequências, nenhuma bloqueante:

1. **Se o QA rodar com `NODE_ENV` diferente de `production`**, a guarda **não** falha o boot lá — só emite os avisos. O QA seguiria podendo servir de memória silenciosamente, que é exatamente o cenário do #374. A proteção forte fica só em produção.
2. **Se o QA rodar com `NODE_ENV=production`** e o compose do host não declarar os 7 drivers, o próximo deploy **para de subir**. É o efeito pretendido, mas precisa ser sabido antes.

**Ação para o humano antes do merge**: conferir, no host do QA, o `NODE_ENV` efetivo e a lista de `*_DRIVER` declarados (`tr '\0' '\n' < /proc/1/environ` — `docker exec env` **não** mostra as `*_DATABASE_URL`, que são injetadas em runtime). Não foi feito aqui: exige acesso ao ambiente, que não é ação de pipeline.

## Resumo do risco R3

| Ambiente | Config completa? | Guarda dispara? | Risco |
| --- | --- | --- | --- |
| Produção (ECS + imagem) | Sim (compose declara os 7) | Não | **Nenhum esperado** |
| QA (VPS, compose à mão) | **Desconhecido** | Depende do `NODE_ENV` efetivo | **Conferir antes do merge** |
| Dev local | Não (e tudo bem) | Não — ramo permissivo + avisos | Nenhum |
| `pnpm test` | Não (e tudo bem) | Não — ramo permissivo | Nenhum (caso 7 do W0 cobre) |

---

# VERIFICADO — 2026-07-22 (fecha o Blocker B1 e o S7)

A conferência que faltava foi executada nos dois ambientes. **Resultado: a guarda não derruba nenhum dos dois, e protege os dois.**

## PRODUÇÃO — taskdef ECS (`ERP-INFRA/platform/aws-ecs-prod/taskdefs/api.taskdef.json`)

| Item | Valor efetivo |
| --- | --- |
| `NODE_ENV` | **`production`** ✅ |
| 7 drivers (`AUTH`, `PROGRAMS`, `CONTRACTS`, `PARTNERS`, `FINANCIAL`, `BUDGET_PLANS`, `REPORTS`) | todos `mysql` ✅ |
| Connection strings | 6 declaradas via `secrets` (auth, programs, contracts, partners, financial, budget-plans) ✅ |
| `reports` | sem URL própria — resolve por **cascata** a partir das 6 acima ✅ |

## QA — env efetivo do PID 1 do container `core-api`

Lido com `tr '\0' '\n' < /proc/1/environ` (o `docker exec env` não mostra as `*_DATABASE_URL`, injetadas em runtime).

| Item | Valor efetivo |
| --- | --- |
| `NODE_ENV` | **`production`** ✅ |
| 7 drivers | todos `mysql` ✅ |
| Connection strings | as mesmas 6, presentes ✅ |
| `*_READER_URL` | nenhuma — correto e esperado (opcional por ADR-0026) ✅ |

## Conclusões

1. **Blocker B1 resolvido.** A hipótese de que a guarda subiria inerte era infundada: o `NODE_ENV: development` do `compose.yaml` é do ambiente local, como o cabeçalho do arquivo declara. PROD e QA rodam com `production`.
2. **Risco R3 zerado.** Nenhum ambiente depende hoje do fallback silencioso — os dois já declaram tudo. O deploy da guarda é não-disruptivo.
3. **A guarda protege o QA também**, e não só produção. Isso é melhor do que o previsto na análise inicial, que supunha o QA fora do alcance por rodar em modo não-produtivo.
4. **Confirma o drift do QA**, mas em direção segura: o compose do host difere do `compose.yaml` versionado justamente no `NODE_ENV` (`production` lá, `development` aqui).

## Ressalva de método

O taskdef lido é o versionado no ERP-INFRA. Ele **bate** com o `compose.yaml` do core-api nos 7 drivers, o que é a evidência cruzada esperada; ainda assim, o que roda em produção é o taskdef **registrado no ECS**, não este arquivo. Divergência entre os dois seria um problema de processo (fora do escopo deste ticket) — e a leitura do QA, essa sim feita no processo vivo, confirma o padrão.
