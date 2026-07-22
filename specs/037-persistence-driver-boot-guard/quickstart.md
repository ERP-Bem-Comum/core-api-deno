# Phase 1 — Quickstart: verificação manual dos critérios

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-07-22

Roteiro para provar os CAs à mão, depois do W1. A suíte automatizada (`tests/shared/persistence/module-driver-config.test.ts`, 14 casos) é a prova primária; isto aqui é a conferência de que o comportamento **do processo** casa com o da função.

> Nenhum passo exige banco, Docker ou rede. Todos rodam contra um processo que deve **falhar antes** de abrir conexão.

## Pré-condição

```bash
pnpm install
pnpm run typecheck
```

## CA1 — Produção com driver ausente derruba o boot

```bash
NODE_ENV=production node src/server.ts; echo "exit=$?"
```

**Esperado**: `exit=78`. A saída de erro nomeia cada módulo sem configuração e a variável correspondente. Nenhuma linha de "listening".

**Hoje (antes do W1)**: sobe normalmente, com todos os módulos em memória. É o defeito.

## CA2 — Produção com `mysql` sem endereço

```bash
NODE_ENV=production AUTH_DRIVER=mysql node src/server.ts; echo "exit=$?"
```

**Esperado**: `exit=78`, mensagem citando `AUTH_DATABASE_URL` como ausente — e **também** os demais módulos não configurados, no mesmo relatório.

## CA3 — Erro de digitação no driver

```bash
NODE_ENV=production AUTH_DRIVER=mysqll node src/server.ts; echo "exit=$?"
```

**Esperado**: `exit=78`, mensagem citando o valor inválido (`mysqll`) e os valores aceitos.

**Hoje**: cai em memória, calado — é o CA6 da issue #456.

## CA4 — Relatório completo numa tentativa só

```bash
NODE_ENV=production AUTH_DRIVER=mysqll FINANCIAL_DRIVER=mysql node src/server.ts 2>&1 | grep -c .
```

**Esperado**: a saída lista **todos** os problemas (driver inválido do auth, endereço ausente do financial, e os demais módulos sem configuração) antes de encerrar. Não pode parar no primeiro.

## CA5 — Memória explícita é respeitada

```bash
NODE_ENV=production \
  AUTH_DRIVER=memory CONTRACTS_DRIVER=memory PARTNERS_DRIVER=memory \
  PROGRAMS_DRIVER=memory FINANCIAL_DRIVER=memory BUDGET_PLANS_DRIVER=memory \
  REPORTS_DRIVER=memory \
  node src/server.ts
```

**Esperado**: sobe normalmente. Intenção declarada é respeitada, mesmo em produção (FR-007).

## CA6 — Fora de produção segue sem fricção, com aviso

```bash
node src/server.ts
```

**Esperado**: sobe, com um aviso por módulo degradado nomeando qual é. Nenhuma falha.

## CA7 — Ambiente correto não muda

Com a configuração completa de um ambiente real (ver `contracts/env-matrix.md`), o boot deve ser **indistinguível** do atual: mesmos logs de inicialização, mesma porta, nenhum aviso novo. É a prova do FR-009.

## CA8 — As degradações com ADR continuam degradando

Este é o passo que protege decisão registrada — não pular.

```bash
# Réplica de leitura ausente (ADR-0026): NÃO pode falhar
NODE_ENV=production <config completa, sem CONTRACTS_READER_URL> node src/server.ts
```

**Esperado**: sobe normalmente, reusando o endereço principal para leitura. Se falhar, o W1 atropelou o ADR-0026 e a implementação está errada.

## Gate final (W3)

```bash
pnpm run typecheck && pnpm run format:check && pnpm run lint && pnpm test
```

**Esperado**: tudo verde, contagem de testes ≥ baseline + 14 (SC-005). Atenção especial a testes existentes que sobem módulos sem env — se algum passar a falhar, a regra fora de produção está rígida demais (risco R2 do `research.md`).
