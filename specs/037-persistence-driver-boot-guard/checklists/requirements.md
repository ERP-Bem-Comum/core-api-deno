# Specification Quality Checklist: Guarda de boot da configuração de persistência

**Purpose**: Validar completude e qualidade da especificação antes de seguir para o planejamento
**Created**: 2026-07-22
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

### Iteração 1 — 2026-07-22

**Reprovado inicialmente em "No implementation details"**: a primeira redação carregava nomes de variáveis de ambiente (`BUDGET_PLANS_DRIVER`), caminhos de arquivo (`src/server.ts`) e o valor literal do driver (`mysql`) dentro dos requisitos e critérios de aceite. Corrigido: os FR e SC passaram a falar em "configuração de driver", "endereço de conexão", "banco real" e "memória". Os nomes concretos ficam confinados ao **Contexto do defeito**, às **Assumptions** e ao **rastreio** — onde servem de evidência do incidente, não de especificação de solução.

**Reprovado inicialmente em "Success criteria are measurable"**: "melhorar o diagnóstico" virou SC-002 (100% de detecção no boot) e SC-003 (uma tentativa em vez de N).

### Iteração 2 — 2026-07-22 (`/speckit-clarify`)

Os 2 marcadores foram fechados pelo P.O. — checklist passa a **16/16**.

- **Q1 → escopo restrito ao driver de persistência.** Gerou FR-011 e a seção "Fora de escopo"; SC-001 passou a dizer "persistência" em vez de "armazenamento", que era amplo demais e prometia mais do que a fatia entrega.
- **Q2 → as 4 fontes do módulo somente-leitura seguem obrigatórias.** A investigação durante a clarificação mostrou que **já é o comportamento** (`reports/adapters/http/composition.ts:109-119` lança erro por fonte ausente) — a pergunta original partia de uma premissa errada minha, de que ele degradava. O que existe de fato é inconsistência de **forma**: esse erro sai com o código de falha genérica (`server.ts:453-456`), não com o de configuração. Virou FR-012 + FR-013 + cenário 3 da US2.

### Pendências

Nenhuma. Spec pronta para `/speckit-plan`.
