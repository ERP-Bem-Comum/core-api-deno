# Contrato: matriz de variáveis de ambiente

**Feature**: [../spec.md](../spec.md) · **Plan**: [../plan.md](../plan.md) · **Date**: 2026-07-22

Esta feature não cria endpoint. **O contrato dela é a matriz abaixo** — é o que quebra (ou salva) um deploy, e o que a plataforma de deploy precisa satisfazer. Levantada de `src/server.ts` na `dev` em 2026-07-22.

## Legenda de obrigatoriedade

| Marca     | Significado                                                                   |
| --------- | ----------------------------------------------------------------------------- |
| **OBR-P** | Obrigatória em produção. Ausente/vazia/inválida ⇒ boot falha (exit 78)        |
| **OBR-M** | Obrigatória **se** o driver do módulo for `mysql`, em qualquer ambiente       |
| **OPC**   | Opcional por decisão registrada em ADR — **nunca** pode virar obrigatória     |
| **CASC**  | Resolvida por cascata: usa o endereço do módulo-fonte quando o override falta |

## Matriz

| Módulo       | Variável de driver    | Endereço de conexão                                                      | Obrigatoriedade                             | Origem no código    |
| ------------ | --------------------- | ------------------------------------------------------------------------ | ------------------------------------------- | ------------------- |
| auth         | `AUTH_DRIVER`         | `AUTH_DATABASE_URL`                                                      | OBR-P · OBR-M                               | `server.ts:110-111` |
| contracts    | `CONTRACTS_DRIVER`    | `CONTRACTS_DATABASE_URL`                                                 | OBR-P · OBR-M                               | `server.ts:167,170` |
| contracts    | —                     | `CONTRACTS_READER_URL`                                                   | **OPC** (ADR-0026 — ausente reusa o writer) | `server.ts:168`     |
| partners     | `PARTNERS_DRIVER`     | `PARTNERS_DATABASE_URL`                                                  | OBR-P · OBR-M                               | `server.ts:185,188` |
| partners     | —                     | `PARTNERS_READER_URL`                                                    | **OPC** (ADR-0026)                          | `server.ts:186`     |
| programs     | `PROGRAMS_DRIVER`     | `PROGRAMS_DATABASE_URL`                                                  | OBR-P · OBR-M                               | `server.ts:150,212` |
| financial    | `FINANCIAL_DRIVER`    | `FINANCIAL_DATABASE_URL`                                                 | OBR-P · OBR-M                               | `server.ts:226,228` |
| budget-plans | `BUDGET_PLANS_DRIVER` | `BUDGET_PLANS_DATABASE_URL`                                              | OBR-P · OBR-M                               | `server.ts:239,245` |
| reports      | `REPORTS_DRIVER`      | `REPORTS_DATABASE_URL` **CASC** `PARTNERS_DATABASE_URL`                  | OBR-P · OBR-M                               | `server.ts:267,275` |
| reports      | —                     | `REPORTS_FINANCIAL_DATABASE_URL` **CASC** `FINANCIAL_DATABASE_URL`       | OBR-M                                       | `server.ts:268`     |
| reports      | —                     | `REPORTS_CONTRACTS_DATABASE_URL` **CASC** `CONTRACTS_DATABASE_URL`       | OBR-M                                       | `server.ts:269`     |
| reports      | —                     | `REPORTS_BUDGET_PLANS_DATABASE_URL` **CASC** `BUDGET_PLANS_DATABASE_URL` | OBR-M                                       | `server.ts:272-273` |

## Valores aceitos no campo de driver

| Valor           | Efeito                                                                                |
| --------------- | ------------------------------------------------------------------------------------- |
| `mysql`         | Persistência real. Exige o endereço de conexão correspondente (OBR-M)                 |
| `memory`        | Armazenamento volátil **declarado**. Aceito em qualquer ambiente (FR-007)             |
| ausente / vazio | Fora de produção: `memory` + aviso. Em produção: **falha** (FR-002)                   |
| qualquer outro  | **Falha** em produção, citando o valor recebido (FR-002). Hoje cai em `memory` calado |

> **Mudança de contrato**: hoje `memory` não é um valor reconhecido — é só "qualquer coisa que não seja `mysql`". Esta feature o promove a valor de primeira classe, para que a intenção seja declarável e auditável.

## Fora desta matriz (não tocar)

| Recurso                               | Variáveis                                                                                | Por quê                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Armazenamento de imagens de programas | `PROGRAMS_LOGO_S3_*`                                                                     | Fora de escopo por decisão do P.O. (Q1) — issue própria. `server.ts:210` |
| Composição de programa em contratos   | —                                                                                        | Degradação intencional, ADR-0032. `server.ts:152-163`                    |
| Base URLs de link de e-mail           | `AUTH_RESET_BASE_URL`, `AUTH_ACTIVATION_BASE_URL`, `PARTNERS_SELF_REGISTRATION_BASE_URL` | Já protegidas pelo precedente. `server.ts:125-129`                       |
| Modo do RBAC                          | `AUTH_RBAC_MODE`                                                                         | Já não é silencioso — banner no boot (ADR-0052). `server.ts:133-136`     |
| Seeds de E2E                          | `AUTH_SEED_JSON`, `BUDGET_PLANS_SEED_JSON`, `CORE_API_E2E`                               | Guarda dupla própria; inerte fora de E2E/dev                             |

## Antes de fazer deploy

Conferir esta matriz contra a configuração real de cada ambiente **antes** de subir a versão com a guarda ativa — é o risco R3 do `research.md`. Um ambiente que hoje depende do fallback silencioso vai parar de subir, que é o efeito pretendido, mas precisa ser descoberto na conferência e não no deploy.
