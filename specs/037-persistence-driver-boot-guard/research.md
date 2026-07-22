# Phase 0 — Research: Guarda de boot da configuração de persistência

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-07-22

Cinco decisões técnicas. Nenhum `NEEDS CLARIFICATION` remanescente — as duas questões de escopo foram fechadas em `/speckit-clarify` (Session 2026-07-22 na spec).

---

## D1 — Formato do retorno da função compartilhada

**Decision**: `readModuleDriverConfigs(env): Result<ModuleDriverConfigs, readonly string[]>` — sucesso traz a configuração dos 7 módulos já resolvida; falha traz a **lista** de mensagens.

**Rationale**: é literalmente a assinatura do precedente aceito no repositório. Citação literal de `src/shared/http/email-link-base-urls.ts:32-34`:

```ts
export const readEmailLinkBaseUrls = (
  env: Readonly<Record<string, string | undefined>>,
): Result<EmailLinkBaseUrls, readonly string[]> => {
```

O `readonly string[]` no canal de erro **é** o mecanismo de acumulação exigido por FR-005: o molde já faz `const errors: string[] = []` e só retorna `err(errors)` no fim, depois de varrer todos os campos. Copiar a forma dá o CA de acumulação de graça e mantém a coerência de leitura entre os dois arquivos.

**Alternatives considered**:

- **Lançar exceção na primeira falha** — rejeitado: viola FR-005 (relatório completo) e é exatamente o defeito que o módulo somente-leitura tem hoje (`composition.ts:109-119` lança na primeira fonte ausente, então quem conserta descobre um problema por deploy).
- **Retornar `{ configs, errors }` sem `Result`** — rejeitado: o projeto tem `Result<T,E>` canônico; um segundo formato de erro em `shared` é a divergência que o FR-001 quer eliminar.

---

## D2 — Quem encerra o processo

**Decision**: a função **não** chama `process.exit`. Ela devolve o `Result`; quem encerra é o `server.ts`, no mesmo formato que já usa para os links de e-mail (`server.ts:126-129`).

**Rationale**: mantém a função pura e testável sem subir processo — condição para o plano de teste do D5. Além disso preserva a simetria do composition root: **um** lugar decide encerrar, e é o que já decide hoje.

**Alternatives considered**:

- **A função chama `process.exit(78)`** — rejeitado: testar exigiria subprocesso ou mock de `process`, transformando 14 testes de unidade instantâneos em testes de integração lentos. Também esconderia do leitor do `server.ts` que ali existe um ponto de saída.

---

## D3 — Uma chamada para os sete módulos, não sete chamadas

**Decision**: uma função que recebe o `env` inteiro e devolve a configuração dos 7 módulos de uma vez.

**Rationale**: FR-005 exige que **todos** os erros saiam juntos. Sete chamadas independentes retornando sete `Result` empurrariam a responsabilidade de acumular para o `server.ts` — que é justamente onde a lógica não deve morar (FR-001, e a razão de o bug ter se replicado 7 vezes).

Ancoragem canônica da regra de mensagem — **Robert C. Martin, _Código Limpo_, p. 107 (linha 3443)**:

> ## Forneça exceções com contexto
>
> Cada exceção lançada deve fornecer contexto o suficiente para determinar a fonte e a localização de um erro. Em Java, você pode pegar um stack trace de qualquer exceção; entretanto, ele não consegue lhe dizer o objetivo da operação que falhou.
>
> Crie mensagens de erro informativas e as passe juntamente com as exceções. Mencione a operação que falhou e o tipo da falha. Se estiver registrando as ações de seu aplicativo, passe informações suficientes para registrar o erro de seu catch.

É a justificativa direta de FR-010: a mensagem tem de nomear **o módulo** (a fonte) e **a variável** (a operação que falhou). Um `throw new Error('driver mysql exige partnersUrl')` — o que existe hoje — falha esse teste: não diz de qual módulo é o `partnersUrl`, nem qual variável de ambiente o operador deve declarar.

**Alternatives considered**:

- **Uma chamada por módulo, acumulando no `server.ts`** — rejeitado: replica no composition root a lógica que a feature quer centralizar.

---

## D4 — Endereço efetivo do módulo somente-leitura

**Decision**: a cascata `override ?? endereço-do-módulo-fonte` é resolvida **antes** da validação; valida-se o endereço **efetivo**.

**Rationale**: o módulo de relatórios não tem endereço próprio — consome os dos módulos-fonte com fallback explícito (`server.ts:267-273`). Validar o override específico acusaria falta do que na prática existe, gerando falso-positivo que derruba deploy correto — o oposto do objetivo.

Consequência favorável, já registrada na spec: como FR-002/FR-003 tornam os módulos-fonte obrigatórios em produção, as quatro fontes do relatório resolvem sozinhas num ambiente correto. **FR-012 não dispara em produção bem configurada** — custo de rollout zero.

**Alternatives considered**:

- **Validar só os overrides específicos** — rejeitado: falso-positivo garantido, porque a configuração real de QA/produção usa a cascata e não declara os overrides.
- **Afrouxar para degradação por relatório** — rejeitado pelo P.O. na clarificação (Q2): mudaria comportamento hoje correto e reintroduziria "relatório vazio sem erro", que é o sintoma da #444.

---

## D5 — Estratégia de teste do W0

**Decision**: teste de **unidade puro** sobre a função, com `env` injetado como objeto literal. Sem subir servidor, sem processo filho, sem banco. Molde: `tests/shared/http/email-link-base-urls.test.ts` (8 casos, zero I/O).

**Rationale**: a função recebe o ambiente por parâmetro em vez de ler `process.env` diretamente — é o que torna cada um dos 14 casos do W0 uma chamada de função e uma asserção. O ganho é o do ciclo curto, ancorado em **Kent Beck, _TDD: Desenvolvimento Guiado por Testes_, p. 139 (linha 6002)**:

> \section\*{Por que TDD funciona?}
>
> Prepare-se para deixar a galáxia. Vamos assumir por um momento que TDD ajuda as equipes a construir produtivamente sistemas fracamente acoplados e altamente coesos com baixas taxas de defeito e baixo custo de perfil de manutenção. (Eu não estou afirmando isso no geral, mas confio em você para imaginar coisas impossíveis.) Como tal coisa poderia acontecer?
>
> Parte do efeito certamente vem de reduzir defeitos. Quanto mais cedo encontrar e corrigir um defeito, mais barato é, e, frequentemente, mais comovente (basta perguntar a Mars Lander).

A citação vale duas vezes aqui, e é por isso que foi escolhida: descreve **o método** (defeito achado cedo é mais barato) e **o próprio defeito que a feature corrige** — a configuração errada hoje é descoberta no ponto mais caro possível, com o usuário já tendo perdido o trabalho dele, exatamente como a #374 e a #444 mostraram.

**Alternatives considered**:

- **Teste de integração subindo o servidor com env manipulado** — rejeitado como cobertura primária: lento, exige porta e banco, e não consegue cobrir com precisão os 14 casos. Pode entrar depois como 1 caso de fumaça, fora do escopo desta fatia.
- **Ler `process.env` dentro da função** — rejeitado: tornaria o teste dependente de estado global mutável, com risco de vazar entre casos executados em paralelo (`--test-concurrency`).

---

## Riscos de execução mapeados

| #   | Risco                                                                                                 | Mitigação                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| R1  | Endurecer, sem querer, uma degradação que tem ADR (réplica ADR-0026, composição de programa ADR-0032) | Casos 13 e 14 do W0 existem só para travar isso; FR-008 é explícito                                                   |
| R2  | Quebrar `pnpm test`, que sobe módulos sem env nenhuma                                                 | Caso 7 do W0 cobre; a regra fora de produção é permissiva por desenho                                                 |
| R3  | Derrubar o boot de um ambiente que hoje depende do fallback silencioso                                | É o efeito **pretendido**. Antes do deploy, conferir a configuração de QA e produção contra `contracts/env-matrix.md` |
| R4  | Aviso do módulo de orçamento (PR #488) sobreviver duplicado ao lado da regra nova                     | O W1 remove o bloco de `server.ts:246-254`; a regra compartilhada passa a cobri-lo                                    |
