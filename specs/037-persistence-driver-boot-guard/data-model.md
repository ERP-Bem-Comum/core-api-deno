# Phase 1 — Data Model: configuração de bootstrap

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-07-22

> **Não há entidade de domínio nesta feature.** Nenhum agregado, Value Object, evento ou tabela. O que segue é a forma do **dado de composição** que a função compartilhada produz — vive em `shared`, fora de qualquer bounded context, e nunca cruza a fronteira de um módulo.

## Forma do dado

### `ModuleDriverConfig` — a decisão para **um** módulo

| Campo              | Tipo                                            | Descrição                                                                          |
| ------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `module`           | identificador do módulo                         | Nome usado nas mensagens ao operador (FR-010)                                      |
| `driver`           | `'mysql' \| 'memory'`                           | O modo resolvido. União fechada — o valor inválido não chega aqui, vira erro antes |
| `connectionString` | endereço, presente só quando `driver = 'mysql'` | Ausente no modo memória, por construção                                            |

A relação "`mysql` ⇒ tem endereço" deve ser expressa como **união discriminada** pelo campo `driver`, não como campo opcional solto. É a forma que impede o estado impossível (`mysql` sem endereço) de ser representável — e portanto de precisar ser checado de novo lá na frente.

### `ModuleDriverConfigs` — o conjunto dos 7

Mapa de módulo → `ModuleDriverConfig`, com **todos** os módulos presentes. O `server.ts` deixa de perguntar "qual driver?" e passa a só ler a decisão já tomada.

O módulo somente-leitura (relatórios) é o único com forma diferente: no modo `mysql` carrega **quatro** endereços já resolvidos pela cascata (parceiros, financeiro, contratos, orçamento) — ver `contracts/env-matrix.md`.

### Canal de erro

`readonly string[]` — lista de mensagens, cada uma nomeando módulo e variável. Ordem estável (a dos módulos), para que a saída seja previsível e testável por igualdade.

## Regras de validação

| Regra                                                                 | Origem                      |
| --------------------------------------------------------------------- | --------------------------- |
| Valor de driver ∈ {`mysql`, `memory`}; vazio conta como ausente       | FR-002, Edge Case           |
| Ausente em produção ⇒ erro; fora de produção ⇒ `memory` + aviso       | FR-002, FR-006              |
| `mysql` sem endereço ⇒ erro (endereço vazio conta como ausente)       | FR-003, Edge Case           |
| `memory` explícito ⇒ válido em qualquer ambiente                      | FR-007                      |
| Módulo somente-leitura em `mysql`: as 4 fontes efetivas obrigatórias  | FR-012                      |
| Réplica de leitura e composição de programa: **fora** desta validação | FR-008 (ADR-0026, ADR-0032) |

## Transições de estado

Nenhuma. A configuração é resolvida **uma vez** no boot e é imutável pelo resto da vida do processo. Não há releitura em runtime, não há recarga a quente — deliberadamente: mudança de configuração exige novo deploy, e é isso que torna a validação de boot suficiente.

## O que NÃO entra aqui

- **Parâmetros de pool** (tamanho, timeout, `maxIdle`): já têm dono em `shared/persistence/mysql-pool-config.ts` e `pool-registry.ts`. Esta feature decide **se** há banco, não **como** o pool se comporta.
- **Credenciais**: viajam dentro do endereço de conexão e não são inspecionadas, decompostas nem registradas em log. Nenhuma mensagem de erro desta feature pode ecoar o valor de um endereço de conexão — só o **nome** da variável ausente.
