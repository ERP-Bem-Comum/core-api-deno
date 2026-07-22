# Feature Specification: Guarda de boot da configuração de persistência

**Feature Branch**: `037-persistence-driver-boot-guard`

**Created**: 2026-07-22

**Status**: Draft

**Input**: User description: "Ticket de composition root: extrair a resolução de driver de persistência (`X_DRIVER` / `X_DATABASE_URL`) dos 7 módulos do `src/server.ts` para uma única função compartilhada em shared, no molde de `src/shared/http/email-link-base-urls.ts`. Hoje o ternário `process.env['X_DRIVER'] === 'mysql' ? mysql : memory` está copiado em 7 pontos e faz fallback SILENCIOSO para o driver `memory` — inclusive com `NODE_ENV=production` —, o que já causou perda de dado em produção duas vezes (#374 budget-plans, #444 reports). Alvo: em produção, driver ausente/inválido ou URL faltante derruba o boot com exit 78 (EX_CONFIG) acumulando TODOS os erros de uma vez; fora de produção, cai em memory com warning explícito nomeando o módulo; `memory` explícito continua válido em qualquer ambiente. Não toca domínio nem persistência — só o composition root e testes de boot. Issue de origem: #456 (P1, débito técnico)."

## Contexto do defeito

A aplicação escolhe, no boot, se cada módulo persiste em banco real ou em um armazenamento **volátil de memória**. Hoje essa escolha tem **default inseguro**: qualquer configuração ausente, vazia ou com erro de digitação é interpretada como "rodar sem banco", **sem aviso e sem falha**, inclusive em produção.

O resultado é uma aplicação que sobe "saudável": responde requisições com sucesso, aceita cadastros, mostra telas — e **descarta tudo no próximo restart**. Não há erro, não há log, não há sinal.

**Já aconteceu duas vezes, em produção, nos dois módulos mais recentes:**

| Incidente | Módulo     | Efeito medido                                                                                                                                                  |
| --------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #374      | Orçamento  | 7 tabelas com **zero linhas** num banco com o resto cheio; migrações aplicadas, nada nunca gravado. A P.O. validou em tela e o que ela viu evaporou no restart |
| #444      | Relatórios | Os 3 relatórios sobem vazios, resposta de sucesso, sem erro                                                                                                    |

**Taxa: 2 de 7 módulos — e 100% dos que entraram depois que o padrão se consolidou.** Sem correção estrutural, o próximo módulo falha igual.

**O precedente que decide o desenho já existe no projeto.** A mesma classe de defeito foi resolvida para os links de e-mail (#331/#332): configuração ausente vazava um endereço local para produção, e a correção foi tornar a configuração **obrigatória em produção com falha de boot**. Citação literal de `src/shared/http/email-link-base-urls.ts:5-8`:

> _"base ausente vazava o default localhost das composicoes para producao (…) em producao (NODE_ENV=production) as tres sao obrigatorias — **boot falha** em vez de enviar e-mail com link quebrado."_

Trocando "localhost" por "memória", é literalmente o mesmo defeito. A inconsistência de severidade é injustificável: **hoje o sistema derruba o boot por causa de um link de e-mail errado, mas degrada em silêncio quando o banco inteiro some.** O link errado incomoda; o banco ausente **perde dado do usuário**.

## User Scenarios & Testing _(mandatory)_

O "usuário" desta feature é quem **opera o deploy** (mantenedor, pessoa de infra, quem sobe o ambiente). O valor entregue é diagnóstico no momento certo — antes de o dado se perder.

### User Story 1 - Deploy incompleto é barrado antes de servir tráfego (Priority: P1)

Quem sobe o ambiente de produção esquece de declarar a configuração de persistência de um módulo (um serviço novo no orquestrador, uma variável não copiada de um ambiente para outro). Em vez de a aplicação subir e aceitar dados que serão descartados, o boot **falha imediatamente**, com mensagem nomeando exatamente o que falta.

**Why this priority**: É o incidente que já custou dado duas vezes. Sozinha, esta história elimina a classe inteira de falha em produção — as demais são refinamento de diagnóstico e de experiência de desenvolvimento.

**Independent Test**: Subir a aplicação com o ambiente marcado como produção e a configuração de um módulo omitida; verificar que o processo termina com código de erro de configuração e não abre porta para tráfego.

**Acceptance Scenarios**:

1. **Given** ambiente de produção e a configuração de driver de um módulo ausente, **When** a aplicação inicia, **Then** o processo encerra com código de saída de erro de configuração e a saída de erro nomeia a variável faltante e o módulo afetado.
2. **Given** ambiente de produção e um módulo declarado como "banco real" mas **sem** o endereço de conexão, **When** a aplicação inicia, **Then** o boot falha nomeando o endereço faltante — nunca cai para memória.
3. **Given** ambiente de produção e um valor de driver com erro de digitação (ex.: `mysqll`), **When** a aplicação inicia, **Then** o boot falha identificando o valor inválido e os valores aceitos — hoje um typo cai em memória em silêncio.
4. **Given** ambiente de produção com **toda** a configuração correta, **When** a aplicação inicia, **Then** ela sobe normalmente, sem nenhuma mudança de comportamento.

---

### User Story 2 - Diagnóstico completo em uma única tentativa (Priority: P2)

Quem está consertando o ambiente vê, de uma vez, **todos** os módulos mal configurados — em vez de descobrir um a cada tentativa de subir, num ciclo de tentativa e erro que se arrasta por vários deploys.

**Why this priority**: Não evita perda de dado (a US1 já evita), mas transforma uma sessão de N deploys falhos em uma correção só. É o comportamento que o precedente dos links de e-mail já adota.

**Independent Test**: Subir com **três** módulos mal configurados simultaneamente e verificar que a saída de erro lista os três problemas, não apenas o primeiro.

**Acceptance Scenarios**:

1. **Given** ambiente de produção com vários módulos mal configurados, **When** a aplicação inicia, **Then** a saída de erro lista **todos** os problemas encontrados antes de encerrar, cada um identificando módulo e variável.
2. **Given** um módulo com dois problemas simultâneos (driver inválido **e** endereço ausente), **When** a aplicação inicia, **Then** ambos aparecem no relatório de erro.
3. **Given** o módulo somente-leitura com uma fonte faltante **e** outro módulo mal configurado, **When** a aplicação inicia, **Then** os dois problemas aparecem no **mesmo** relatório, com o mesmo código de saída de configuração — hoje o primeiro interrompe o boot sozinho, com código de falha genérica.

---

### User Story 3 - Trabalho local e testes seguem sem fricção (Priority: P3)

Quem desenvolve na própria máquina, ou roda a suíte de testes, continua subindo a aplicação sem banco nenhum — mas agora **vê um aviso explícito** dizendo qual módulo está degradado, em vez de descobrir tarde que estava olhando dados que não existem.

**Why this priority**: Preserva o uso legítimo da memória (é o que faz a suíte de testes e o desenvolvimento local funcionarem sem infraestrutura). Sem esta história, a correção quebraria o fluxo diário de quem desenvolve.

**Independent Test**: Subir fora de produção sem nenhuma configuração de persistência e verificar que a aplicação sobe, funcional, com aviso nomeando cada módulo degradado.

**Acceptance Scenarios**:

1. **Given** ambiente **não** de produção e configuração de driver ausente, **When** a aplicação inicia, **Then** ela sobe usando memória **e** emite aviso explícito nomeando cada módulo degradado.
2. **Given** memória pedida **explicitamente** para um módulo, **When** a aplicação inicia em qualquer ambiente, **Then** ela sobe usando memória sem falhar — a intenção declarada é respeitada.
3. **Given** a suíte de testes automatizados, **When** ela executa, **Then** nenhum teste existente quebra por causa da nova validação.

---

### Edge Cases

- **Variável presente mas vazia** (`X_DRIVER=`): tratada como ausente, não como valor inválido.
- **Ambiente não declarado** (marcação de ambiente ausente): não é produção — vale a regra permissiva com aviso.
- **Endereço de conexão presente mas vazio**: tratado como ausente; em produção, falha.
- **Módulo de relatórios**: é somente-leitura e consome os endereços de **quatro outros** módulos, com regra de "cai no endereço do módulo-fonte quando o específico falta". A validação MUST considerar o endereço **efetivo** (após essa cascata), não apenas o específico — senão acusa falta do que na prática existe. As quatro fontes são obrigatórias em modo banco real (FR-012).
- **Módulo de relatórios em ambiente correto**: como os módulos-fonte já são obrigatórios em produção (FR-002/FR-003), a cascata resolve as quatro fontes sozinha — a regra do FR-012 não dispara numa configuração correta.
- **Endereço de réplica de leitura** (dois módulos o suportam): é **opcional** por decisão registrada (ADR-0026, ausente → reusa o principal). Não pode virar obrigatório.
- **Composição de programa em contratos**: hoje degrada de propósito quando indisponível (decisão registrada, ADR-0032). Esse degradar é intencional e **permanece** — não é o fallback silencioso em questão.
- **Memória pedida explicitamente em produção**: permitido (ver Assumptions) — a diferença que importa é entre _silêncio_ e _intenção declarada_.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: O sistema MUST resolver a configuração de persistência de **todos** os módulos por uma **única** regra compartilhada — nenhuma cópia da decisão sobrevive espalhada pelo ponto de composição.
- **FR-002**: Em produção, o sistema MUST **falhar o boot** quando a configuração de driver de um módulo estiver ausente, vazia ou com valor não reconhecido.
- **FR-003**: Em produção, o sistema MUST **falhar o boot** quando um módulo estiver declarado como "banco real" sem o endereço de conexão correspondente.
- **FR-004**: Ao falhar, o sistema MUST encerrar com o código de saída convencional de erro de configuração e MUST NOT abrir porta para tráfego.
- **FR-005**: Ao falhar, o sistema MUST reportar **todos** os problemas encontrados de uma vez, cada mensagem nomeando o módulo e a variável envolvidos.
- **FR-006**: Fora de produção, o sistema MUST subir com armazenamento em memória quando a configuração estiver ausente, **e** MUST emitir aviso explícito nomeando cada módulo degradado.
- **FR-007**: O sistema MUST aceitar memória **explicitamente pedida** em qualquer ambiente, sem falhar e sem exigir configuração adicional.
- **FR-008**: O sistema MUST preservar as degradações **intencionais já decididas** (réplica de leitura opcional; composição de programa opcional) — elas não são alcançadas por esta guarda.
- **FR-009**: O sistema MUST manter inalterado o comportamento de boot de um ambiente **corretamente configurado** — nenhuma regressão para quem já está certo.
- **FR-010**: As mensagens de erro e de aviso MUST ser compreensíveis por quem opera o deploy sem ler o código: dizer o que falta, em qual módulo, e o que fazer.
- **FR-011**: A guarda MUST alcançar **somente** a escolha de driver de persistência dos módulos. Outros recursos de infraestrutura que hoje degradam em silêncio (notadamente o armazenamento de imagens) MUST permanecer com o comportamento atual — o achado é registrado como issue própria, não corrigido aqui.
- **FR-012**: Para um módulo somente-leitura que consome endereços de vários módulos-fonte, o sistema MUST exigir que **todas** as fontes resolvam para um endereço efetivo quando ele estiver em modo banco real. Uma fonte faltante MUST produzir a mesma falha diagnosticável dos demais casos — nomeando módulo e variável, com o código de saída de configuração, e **acumulada** no mesmo relatório — em vez de interromper o boot isoladamente com erro genérico de aplicação.
- **FR-013**: Toda falha de configuração de persistência MUST usar o **mesmo** código de saída, distinto do código de falha genérica da aplicação — hoje parte dessas falhas sai com o código de "aplicação quebrada", impedindo a plataforma de deploy de distinguir erro de configuração de defeito de código.

### Fora de escopo

- **Armazenamento de imagens** (`server.ts:210`): cai para memória em silêncio quando suas variáveis faltam, incluindo em produção. É o mesmo defeito desta spec aplicado a arquivo binário em vez de dado transacional, mas exige decisão própria sobre imagens já enviadas. Registrar como issue nova antes de fechar esta feature, citando esta spec como precedente de desenho.
- **Chave de assinatura do access token** (`src/modules/auth/adapters/http/composition.ts:273-285`): gera um par ES256 efêmero em silêncio quando as variáveis faltam, incluindo em produção — mesma classe de defeito desta spec, aplicada a um controle criptográfico em vez de persistência. O efeito não é perda de dado, e sim indisponibilidade silenciosa de autenticação (sessões morrem no restart; o BFF rejeita todo token novo). Registrado como **#515**, com o mesmo desenho desta feature (`EX_CONFIG` 78 em produção, aviso fora dela). Fora de escopo por FR-011 — descoberto na `handbook/inquiries/0024-cognito-vs-identidade-propria-seguranca.md`.
- **Degradações intencionais com ADR**: réplica de leitura opcional (ADR-0026) e composição de programa opcional (ADR-0032) — ver FR-008.
- **Mudança de qualquer contrato de borda, esquema de banco ou regra de domínio.**

### Key Entities

- **Configuração de persistência de um módulo**: o par "modo de armazenamento" + "endereço de conexão" de um módulo, mais o nome do módulo para diagnóstico. Modos possíveis: banco real ou memória.
- **Relatório de problemas de configuração**: coleção acumulada de mensagens de erro, cada uma ligada a um módulo e a uma variável, apresentada de uma vez no encerramento.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Zero módulos capazes de servir tráfego de produção com **persistência** volátil sem que isso tenha sido **declarado explicitamente** — hoje são 7 de 7 capazes disso por omissão. (Recursos de infraestrutura fora da persistência seguem fora desta contagem — FR-011.)
- **SC-002**: Uma configuração de produção incompleta é detectada em **100%** dos casos no boot, antes de qualquer requisição ser atendida — hoje a detecção é 0% automática e depende de alguém conferir tabelas vazias no banco.
- **SC-003**: Quem corrige um ambiente com múltiplos módulos mal configurados descobre **todos** os problemas em **uma única** tentativa de subir, não em uma tentativa por problema.
- **SC-004**: A regra de escolha de armazenamento existe em **um só lugar**; adicionar um módulo novo não exige repetir a decisão nem lembrar de copiá-la.
- **SC-005**: Nenhum fluxo de desenvolvimento local ou de execução da suíte de testes passa a exigir infraestrutura que antes não exigia (contagem de testes verdes ≥ a de hoje).

## Impacto Arquitetural (core-api)

- **Bounded Contexts afetados**: **nenhum**. A mudança vive no **ponto de composição** (`src/server.ts`) e em código compartilhado de bootstrap. Não toca domínio, aplicação nem persistência de nenhum módulo — portanto **não** ofende o isolamento do ADR-0014, ainda que o arquivo alterado seja o mesmo que monta os 7 módulos.
- **Novos agregados / Value Objects?**: nenhum de domínio. Há um tipo de configuração de bootstrap, que não é conceito de negócio e vive fora dos módulos.
- **Novos eventos de domínio (outbox)?**: nenhum.
- **Novos subcomandos de CLI?**: nenhum — CLI embutida foi retirada (ADR-0037).
- **Borda HTTP envolvida?**: apenas o bootstrap que a monta; nenhuma rota, esquema ou contrato de borda muda.
- **Possíveis violações da constituição (I–VIII)?**: nenhuma prevista. A mudança **reforça** a política de regressão zero (falha alta em vez de degradação silenciosa) e segue precedente já aceito no próprio repositório (`email-link-base-urls.ts`).

## Clarifications

### Session 2026-07-22

- Q: O escopo cobre apenas a escolha de driver de persistência dos 7 módulos (issue #456 literal), ou estende a guarda aos demais fallbacks silenciosos de infraestrutura do ponto de composição (ex.: armazenamento de imagens)? → A: **Apenas o driver de persistência dos 7 módulos.** Os demais fallbacks silenciosos viram issue própria, referenciando esta spec como precedente — scope-creep é anti-padrão declarado do projeto (AGENTS.md #15, ADR-0040).

- Q: Em produção, com relatórios em modo banco real, todas as quatro fontes (parceiros, financeiro, contratos, orçamento) precisam resolver para um endereço, ou degrada relatório a relatório? → A: **Todas as quatro seguem obrigatórias.** A investigação mostrou que esse já é o comportamento (o módulo lança erro para cada fonte ausente); a mudança é apenas de **forma** — mensagem nomeando módulo e variável, código de saída de configuração, e o erro somado aos demais no mesmo relatório, em vez de interromper o boot isoladamente.

## Assumptions

- **Memória explícita é sempre permitida**, inclusive em produção. A feature distingue _silêncio_ de _intenção declarada_; quem escreve explicitamente "usar memória" assume o risco de forma auditável. (Deriva do CA4 da #456.)
- **A marcação de ambiente de produção é o sinal existente** já usado pelo precedente dos links de e-mail — a feature não introduz uma marcação nova nem muda o significado da atual.
- **O código de saída em falha de configuração é o mesmo do precedente** (`EX_CONFIG`, 78), para que a plataforma de deploy distinga "configuração errada" de "aplicação quebrada".
- **A validação acontece no início do boot**, antes de qualquer conexão ser aberta ou porta ser exposta — falhar cedo é o ponto.
- **Ambientes existentes já corretos não precisam de mudança** de configuração. Ambientes hoje dependentes do fallback silencioso **vão** precisar declarar a configuração — esse é o efeito pretendido, e é a razão de a feature ter risco de deploy diferente de zero.
- **A degradação intencional já registrada em ADR permanece** (réplica de leitura opcional — ADR-0026; composição de programa opcional — ADR-0032). Esta feature não reabre essas decisões.
- **O aviso fora de produção não vira erro** e não polui a saída a ponto de esconder outras mensagens: um aviso por módulo degradado.

## Dependências e rastreio

- **Issue de origem**: #456 (P1, `debito-tecnico`, `agent-found`) — _"[shared/bootstrap] Fallback silencioso para driver `memory` — a fábrica dos bugs #374 e #444"_.
- **Incidentes que a motivam**: #374 (Orçamento em memória), #444 (Relatórios em memória).
- **Precedente de desenho**: `src/shared/http/email-link-base-urls.ts` (issues #331/#332) — mesma classe de defeito, já resolvida e aceita.
- **Trabalho parcial já entregue**: o aviso de degradação **do módulo de Orçamento apenas** (PR #488). Esta feature generaliza e endurece; aquele aviso pontual deve ser absorvido pela regra compartilhada, não duplicado.
- **Não depende** de nenhuma feature em andamento. **Destrava** a verificação com dado real de #441 e #502, hoje impossível porque produção serve de memória.
