# 2 decisões para portar a taxonomia (Categoria → Centro → Subcategoria) — #443

Oi Alé! Fui no código do sistema antigo (ERP-BACKEND) e **achei a taxonomia real** — está toda lá, estruturada, com os nomes de verdade. Dá para portar. Mas o jeito como o legado organiza isso tem duas particularidades que preciso que você decida antes, senão a gente semeia errado. Cada uma tem a **evidência do que encontrei** para você decidir com segurança.

> **Resumo rápido:** o legado tem ~30 centros/categorias e **158 subcategorias**, mas organizadas **por programa** (PARC e EPV têm árvores diferentes) e **só de despesa** (nenhuma de receita). As 2 decisões abaixo são sobre isso.

---

## O que encontrei (o dado real)

A árvore Centro de Custo → Categoria → Subcategoria existe, com nomes reais. Exemplos do programa **PARC**:

- **Pessoal** → _Consultoria Estratégica_ → (Especialista Estratégico 1, Coordenador de Articulação, Diretora, …)
- **Viagens** (Administrativas, Nacionais CLT, Nacionais PJ, Internacionais)
- **Avaliação Externa**, **Seminário Nacional**, **Apoio a Eventos**, **Administração**, **Comunicação**, **Produção de Material**…

Números: **34 categorias · 158 subcategorias**, distribuídas em **2 programas** (PARC e EPV, com árvores próprias) + um conjunto "padrão".

---

## Decisão 1 — a taxonomia é **por programa**. Qual vira a referência do sistema?

No sistema antigo, **cada programa (PARC, EPV, …) tem a sua própria árvore** de centros/categorias/subcategorias — e cada plano orçamentário de cada ano tem uma cópia. Mas o sistema novo precisa de **uma taxonomia única de referência** (a lista que aparece quando você categoriza um lançamento, em qualquer módulo).

**A pergunta:** qual deve ser essa lista única?

| Opção                                         | O que significa                                                                                                                                                 |
| :-------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a) Unir todos os programas** (recomendado) | Junto as árvores de PARC + EPV (+ outras), removendo repetições por nome. Vira uma taxonomia de referência abrangente que serve qualquer programa.              |
| **(b) Escolher um programa como padrão**      | Uso a árvore de **um** programa (ex.: o mais completo/atual) como a referência. Mais enxuta, mas pode faltar categoria que só existe em outro programa.         |
| **(c) Manter separado por programa**          | Cada programa mantém sua taxonomia. Isso é maior (muda a modelagem do sistema novo) e provavelmente é assunto do módulo de Orçamento, não da referência global. |

**Preciso:** unir tudo (a), um programa padrão (b — e qual?), ou você tem outra visão?

---

## Decisão 2 — o legado só tem **despesa**. De onde vêm as **receitas**?

Aqui está o achado mais importante: das **34 categorias do legado, TODAS são "A PAGAR" (despesa)** — **nenhuma é "A RECEBER" (receita)**.

Mas o sistema novo classifica cada categoria como **despesa, receita ou ajuste**. Se eu portar o legado tal como está, você teria a árvore de despesas completa, mas a lista de **receitas ficaria vazia**.

**A pergunta:** as categorias de **receita** existem em algum lugar (num programa que eu não olhei? numa planilha sua?), ou o sistema novo vai ter as receitas definidas à parte?

- Se você tiver a lista de categorias de receita, me passa junto (mesmo formato: categoria → subcategoria).
- Se não, eu porto só as despesas agora e as receitas ficam para depois (a tela funciona, só não mostra receita).

---

## Uma consequência técnica que você deve saber (não é decisão sua)

O legado guarda, na subcategoria, um campo de **"tipo de reajuste" (IPCA / CAED / …)** e um marcador **REDE/INSTITUCIONAL**. Esses dois **não vão para a taxonomia de referência** do sistema novo — pela nossa arquitetura, eles pertencem ao módulo de **Orçamento** (é o que o #413, orçamento mensal, vai usar). Ou seja: a subcategoria aparece na cascata de categorização, mas o "tipo de reajuste" mora no Orçamento, não na categorização. Isso é decisão de arquitetura já tomada — só te aviso para não estranhar.

---

## Resumo do que preciso

| #     | Decisão                | Resposta em 1 linha                                                     |
| :---- | :--------------------- | :---------------------------------------------------------------------- |
| **1** | Taxonomia por programa | **unir todos** (recomendado), **um programa padrão** (qual?), ou outra? |
| **2** | Receitas               | onde estão as categorias de receita? (ou porto só despesa por agora)    |

Com essas 2, eu porto a taxonomia de vez. O dado já está mapeado — é só decidir o recorte. Qualquer coisa, me chama! 🙌
