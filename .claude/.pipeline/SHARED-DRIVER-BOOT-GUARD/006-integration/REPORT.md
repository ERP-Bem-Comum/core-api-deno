# Integração em MySQL real (x99) — complemento ao W3

**Ticket**: SHARED-DRIVER-BOOT-GUARD · **Data**: 2026-07-22
**Ambiente**: MySQL 8.4.10 em contêiner no homelab x99, acessado por túnel SSH (os testes têm `127.0.0.1:3306` hardcoded).

O gate W3 roda `pnpm test` **sem** o opt-in `MYSQL_INTEGRATION`, então a suíte de integração fica fora dele. Esta é a corrida que falta.

## Resultado — por suite, com o banco recriado entre elas

| Suite | pass | fail |
| --- | --- | --- |
| contracts | 90 | **0** |
| auth | 46 | **0** |
| partners | 49 | 0 (1 cancelled) |
| programs | 10 | **0** |
| budget-plans | 103 | **6** |
| financial | 115 | **2** |
| **total** | **413** | **8** |

## As 8 falhas são PRÉ-EXISTENTES — provado por experimento controlado

Rodei as mesmas 3 suites num worktree da `dev` pura (`6b101b8e`, sem o diff deste ticket), no mesmo banco e com o mesmo procedimento:

| Suite | branch do ticket | `dev` baseline |
| --- | --- | --- |
| partners | 49 pass · 1 cancelled | 49 pass · 1 cancelled |
| budget-plans | 103 pass · **6 fail** | 103 pass · **6 fail** |
| financial | 115 pass · **2 fail** | 115 pass · **2 fail** |

**Idêntico.** Nenhuma das 8 toca `module-driver-config.ts`, `server.ts` ou `reports/composition.ts` — os arquivos do ticket.

## O que são as 8

- **budget-plans (6)** — `legacy-id.drizzle-mysql.test.ts`, CA3: `legacy_id` duplicado **deveria** violar o UNIQUE e não viola, nas 6 tabelas `bgp_*`. O UNIQUE existe na migration `0009_futuristic_eternity.sql`. Se confirmado, é garantia de idempotência do ETL ausente em runtime.
- **financial (2)** — `realized-provisioned.drizzle-mysql.test.ts`, CA2 e CA4: realizado de título **parcialmente conciliado**. Área tocada pelo épico #502, mergeado hoje.
- **partners (1 cancelled)** — `suppliers-batch-reader`: `Duplicate entry` de CNPJ, aparentando dependência de ordem dentro da própria suite.

## ⚠️ Ressalva de método (importante para quem for investigar)

Não reproduzi o setup exato do runner oficial (`scripts/ci/test-integration.ts`), que sobe o MySQL do `compose.yaml` — imagem pinada por digest e configuração própria. Usei um contêiner `mysql:8.4` avulso. **Não descartei** que parte das 8 seja artefato dessa diferença de ambiente, e não defeito de produto. Quem for tratar deve primeiro reproduzir pelo runner oficial.

O que a comparação com a `dev` prova é mais estreito, e é o que basta aqui: **seja qual for a causa, ela não veio deste ticket.**

## Caminho errado que percorri antes (registro para não se repetir)

1. Rodar `pnpm test` inteiro com `MYSQL_INTEGRATION=1` de uma vez: **44 falhas**, 265 cancelados. As suites se contaminam mutuamente — o runner oficial roda **uma por vez**.
2. Rodar contra um banco com estado prévio: 27 × `ER_ROW_IS_REFERENCED_2`. O contrato dos testes assume banco limpo.
3. Só com **isolamento por suite + banco recriado entre elas** o número caiu para 8 — e aí bateu com a `dev`.
