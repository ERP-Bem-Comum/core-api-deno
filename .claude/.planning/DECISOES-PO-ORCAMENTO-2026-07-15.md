# 3 decisões para destravar o Plano Orçamentário 100%

Oi Alé! Fechamos a Conciliação (Resgate/Aplicação — #428) e olhamos a fundo o que falta no **Plano Orçamentário**. Três pontos dependem de uma definição sua — não de código. Cada um abaixo tem o que está acontecendo na tela, a nossa recomendação, e o que destrava quando você responder. São decisões objetivas: um "ok" ou uma escolha entre opções resolve.

> **Como isso vira entrega:** assim que você responder as 3, elas viram trabalho de código imediato. Enquanto isso, já estou tocando o que não depende de você (a lista de Planejamento aninhando cenários, #423).

---

## Decisão 1 — Grid de Orçamento: **por mês** ou **anual**? (#413)

**O que acontece na tela:** em *Planejamento > Detalhes > Orçamento*, o grid mostra **Categorias × 12 meses**. Você consegue digitar valor mês a mês, mas ao recarregar a página **os valores somem** — porque o sistema, hoje, guarda **um único valor anual** por rede/subcategoria. Não existe "mês" no banco; os 12 campos são só visuais.

**Contexto:** o "Por Rede" que você já vê preenchido e correto é exatamente esse valor anual. O mensal nunca teve onde ser guardado.

**A pergunta:** o Orçamento precisa ser editado **mês a mês**, ou o **anual** já atende?

| Opção | O que muda | Custo |
| :- | :- | :- |
| **✅ (a) Grid anual** *(recomendado)* | O grid passa a mostrar **1 valor por categoria/rede** (tira as 12 colunas de mês). É o que o sistema já faz — vira dado real na hora, sem placeholder. | Praticamente zero |
| (b) Mensal de verdade | Exige **criar a estrutura mensal do zero** no sistema **e** você definir **a regra de como distribuir** o valor anual nos 12 meses (dividir igual? por sazonalidade? essa regra hoje não existe). | Alto — só vale se editar por mês for requisito real do negócio |

**O que destrava:** a tela de Orçamento deixa de ser placeholder e passa a mostrar/salvar dado real.

**Preciso de você:** grid anual (recomendado) ou mensal de verdade?

---

## Decisão 2 — O "Realizado" do Plano Insight (#416)

**Preciso ser transparente com você aqui:** o **"Realizado: R$ 11.450.000"** e a **"Média de N Estados"** que aparecem no card do Plano Insight **são valores de exemplo do front (mock)** — o sistema **ainda não calcula** esses números. Hoje o Insight só devolve de verdade o **Planejado** (ano a ano). Por isso a "Média de 0 Estados" veio zerada: não há cálculo por trás.

**A boa notícia:** o que o Realizado *deve* ser já está definido no nosso material — a **soma dos títulos conciliados/pagos** que pertencem àquele plano — e o vínculo entre o documento e o plano orçamentário **já existe** no sistema. Falta só construir o cálculo.

**As perguntas (3 rápidas):**
1. **Confirma** que "Realizado" = **soma dos títulos daquele plano que já foram conciliados/pagos**? (é o que o handbook indica)
2. O corte é **"Pago"** ou **"Conciliado"**? — nosso material tem os dois termos em pontos diferentes, e preciso de **um** para não contar errado. (Conciliado = título pago **e** já batido com o extrato do banco; Pago = marcado como pago, mesmo sem a conciliação bancária.)
3. Esse mesmo número vai alimentar também o relatório **"Realizado × Planejado"** (que está pausado). Confirma que **a fonte é a mesma** nos dois lugares? (importante para não divergir em tela depois)

**O que destrava:** o card de Insight passa a mostrar número real em vez de exemplo — e deixa o relatório "Realizado × Planejado" pronto para construir com a mesma regra.

---

## Decisão 3 — De onde vem a **taxonomia** de categorias? (#443)

**O que acontece na tela:** nas telas que categorizam (*Lançar Documento* e *Nova transação da Conciliação*), a cascata **Centro de Custo → Categoria → Subcategoria** está pronta e funcionando — mas a **Subcategoria fica sempre vazia**, e escolher um Centro **não filtra** as categorias.

**Por quê:** nós entregamos a *capacidade* de ligar categoria a centro e criar subcategorias (#341), mas **os dados dessa estrutura não existem ainda**. Hoje temos 11 categorias soltas, **nenhuma** ligada a um centro de custo e **nenhuma** com subcategoria. Ou seja: a máquina está pronta, falta o **conteúdo**.

**A pergunta:** de onde vem essa taxonomia?

| Opção | O que significa | O que preciso de você |
| :- | :- | :- |
| **(a) Portar do sistema antigo** | Se o legado já tem "qual categoria pertence a qual centro" e as subcategorias, eu **importo** isso para o sistema novo. | Você confirmar que essa estrutura existe no legado e está correta/atual. |
| **(b) Definir do zero** | Você (ou quem cuida do plano de contas) me entrega o mapa: **quais categorias ficam em qual centro** e **quais são subcategorias de quais**. | Uma lista/planilha com essa organização. |

**Importante:** essa é uma decisão de **negócio/contabilidade**, não de engenharia — a estrutura de categorias precisa vir de vocês (do legado ou nova). Sem esse conteúdo, a hierarquia existe no código mas continua vazia na tela.

**O que destrava:** a Subcategoria passa a aparecer e o filtro por Centro passa a afunilar — o front já está pronto e liga sozinho quando o dado chegar, sem retrabalho.

---

## Resumo do que preciso

| # | Decisão | Resposta em 1 linha |
| :- | :- | :- |
| **#413** | Grid de Orçamento | **anual** (recomendado) ou **mensal**? |
| **#416** | Fonte do "Realizado" | confirma "soma dos títulos do plano"? corte **Pago** ou **Conciliado**? mesma fonte do relatório? |
| **#443** | Taxonomia | **portar do legado** ou **você define**? (e me passar o conteúdo) |

Com essas 3, o Plano Orçamentário destrava por completo. Qualquer dúvida, me chama! 🙌
