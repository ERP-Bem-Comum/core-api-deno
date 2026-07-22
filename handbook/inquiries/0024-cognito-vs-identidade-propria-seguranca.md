# Inquiry-0024: Amazon Cognito vs. identidade própria — comparação de superfície de segurança

- **Status:** Open
- **Opened:** 2026-07-22
- **Closed/Decided:** —
- **Opened by:** Gabriel Aderaldo
- **Asked to:** Investigação interna (fontes normativas: OWASP Cheat Sheet Series, OAuth 2.0 Security BCP/IETF, AWS Cognito Developer Guide)
- **Impact:** potencial ADR de federação — supersede parcial do [ADR-0024](../architecture/adr/0024-identity-and-rbac-auth-module.md) (seções 1 e 3)

---

## 1. Contexto

O [ADR-0024](../architecture/adr/0024-identity-and-rbac-auth-module.md) decidiu **identidade própria** no core-api e rejeitou OIDC federado explicitamente por custo de infra:

> **Rejeitada nesta fase porque:** conflita com a restrição de **infra reduzida** — self-hosted é mais um serviço stateful com banco próprio; SaaS adiciona custo recorrente + vendor lock-in. Mantida como evolução (port `Authenticator`).
> — `handbook/architecture/adr/0024-identity-and-rbac-auth-module.md:103`

E deixou o gatilho de reabertura registrado:

> Se um **IdP corporativo** entrar em cena → ativar o `OidcAuthenticator` (gera ADR de federação).
> — `handbook/architecture/adr/0024-identity-and-rbac-auth-module.md:117`

Dois fatos mudaram desde 2026-05-27:

1. **Produção roda em AWS ECS.** O argumento "SaaS adiciona vendor lock-in" perdeu força — o lock-in de plataforma já foi pago.
2. **O módulo `auth` cresceu muito além do previsto no ADR.** São hoje ~25 use cases, 4 sub-domínios (`identity`, `credential`, `session`, `authorization`), lockout, blocklist de senhas, anti-timing, reuse detection, reset de senha, foto de perfil, provisionamento de usuário legado. Cada linha disso é superfície de segurança que o time mantém e audita.

A pergunta que motivou esta inquiry **não é de custo** — é: *terceirizar a autenticação para o Cognito nos deixaria mais seguros?*

⚠️ **Delimitação:** esta inquiry compara **apenas a superfície de segurança**. Custo (MAU, planos Lite/Essentials/Plus), esforço de migração e impacto no front estão fora do escopo e precisam de análise própria antes de qualquer ADR.

---

## 2. Pergunta(s) feita(s)

```
Abre a inquiry comparando Cognito e o nosso login atual, principalmente em
relação a segurança.
```

Desdobrada em:

- **Q1.** Em quais eixos de segurança o login atual está **abaixo** da norma (OWASP/IETF)?
- **Q2.** Em quais eixos o Cognito seria **comprovadamente** melhor — e não apenas "é da AWS, então é seguro"?
- **Q3.** Que riscos **novos** o Cognito introduziria que hoje não existem?
- **Q4.** Os ganhos de segurança do Cognito são obteníveis **sem** Cognito?

---

## 3. Respostas / Investigação

### 2026-07-22 — Leitura do código de produção

Auditado o estado real do módulo `auth` (não o que o ADR diz que ele é):

| Controle | Implementação | Arquivo |
| :--- | :--- | :--- |
| Hash de senha | argon2id `m=19456, t=2, p=1, hashLength=32`, salt 16B, saída PHC | `src/modules/auth/adapters/crypto/password-hasher.argon2.ts:15-20` |
| Política de senha | `[12, 128]` + blocklist de senhas comuns, **sem** regra de composição | `src/modules/auth/domain/credential/password-policy.ts:30-40` |
| Lockout | Cooldown **progressivo e sempre temporário** (anti-DoS), por conta | `src/modules/auth/domain/session/account-lockout.ts:33-52` |
| Anti-enumeração | Ordem que só revela `user-disabled` após senha correta | `src/modules/auth/application/use-cases/authenticate-user.ts:92-125` |
| Anti-timing | `verify` dummy no ramo usuário-inexistente | `src/modules/auth/application/use-cases/authenticate-user.ts:93-97` |
| Rate limit | Limite dedicado de login/refresh por env, default declarado 5/min | `src/server.ts:114-123` |
| Rotação de refresh | Rotaciona a cada renovação; refresh só persistido como hash | `src/modules/auth/application/use-cases/refresh-access-token.ts:126-141` |
| Reuse detection | Refresh já rotacionado reapresentado → **revoga a cadeia inteira** | `src/modules/auth/application/use-cases/refresh-access-token.ts:98-102` |
| Assinatura JWT | ES256, `alg` fixo na emissão **e** na verificação, `iss` validado | `src/modules/auth/adapters/crypto/token-issuer.es256.ts:27-55` |
| MFA | **Não existe** | — |

### 2026-07-22 — Fontes normativas (MCP `security`)

**Argon2id — parâmetros.** O OWASP recomenda literalmente:

> - m=47104 (46 MiB), t=1, p=1 (Do not use with Argon2i)
> - **m=19456 (19 MiB), t=2, p=1** (Do not use with Argon2i)
> — [Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

Os parâmetros do repo são **exatamente** a segunda linha recomendada. Nenhum desvio.

**Política de senha sem composição.** Alinhada ao NIST 800-63B (comprimento + lista de conhecidas > regras de complexidade), como o próprio código documenta em `password-policy.ts:9-15`.

**MFA.** A norma é inequívoca:

> Multi-factor authentication (MFA) is **by far the best defense** against the majority of password-related attacks, including brute-force attacks, with analysis by Microsoft suggesting that it would have stopped 99.9% of account compromises. As such, it should be implemented wherever possible.
> — [Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)

> MFA is a critical security control, and is recommended for **all applications**. […] The most important place to require MFA on an application is when the user logs in.
> — [Multifactor Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)

**Rotação de refresh token.** O IETF descreve exatamente o mecanismo implementado no repo:

> **Refresh token rotation:** the authorization server issues a new refresh token with every access token refresh response. The previous refresh token is invalidated but information about the relationship is retained […]. If a refresh token is compromised and subsequently used by both the attacker and the legitimate client, one of them will present an invalidated refresh token, which will inform the authorization server of the breach. […] This stops the attack at the cost of forcing the legitimate client to obtain a fresh authorization grant.
> — [OAuth 2.0 Security BCP](https://github.com/oauthstuff/draft-ietf-oauth-security-topics/blob/HEAD/A04_attacks-and-mitigations.md)

**Validação de claims em JWT.** O OWASP exige verificar `iss`, `aud`, `exp`, `nbf`:

> - `iss` or issuer - is this a trusted issuer? […]
> - `aud` or audience - is the relying party in the target audience for this JWT?
> — [REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)

E alerta contra algorithm confusion:

> A relying party must verify the integrity of the JWT based on its own configuration or hard-coded logic. It **must not rely on the information of the JWT header** to select the verification algorithm.
> — [REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)

**Custódia de chave.** O OWASP é duro quanto a onde chave privada mora:

> 3. Keys should never be stored in plaintext format.
> 4. Ensure all keys are stored in a cryptographic vault, such as a hardware security module (HSM) or isolated cryptographic service.
> — [Key Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html)

**IdP de terceiro como risco.** A mesma fonte que recomenda MFA alerta:

> However, it is important to consider the security of the third party service, and the implications of using it. For example, **if the third party service is compromised, it could allow an attacker to bypass MFA on all of the applications that use it.**
> — [Multifactor Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)

**PKCE (relevante se a topologia OIDC for adotada).**

> Authorization servers MUST support PKCE. […] Public clients MUST use PKCE to this end. […] Currently, `S256` is the only such method.
> — [OAuth 2.0 Security BCP](https://github.com/oauthstuff/draft-ietf-oauth-security-topics/blob/HEAD/A02_recommendations.md)

### 2026-07-22 — Cognito (AWS Developer Guide)

- **Customização de access token exige plano pago.** *"The Essentials plan adds to the existing functions of a pre token generation trigger. With lower-tier plans, you can customize ID tokens with additional claims, roles, and group membership."* — [Essentials plan features](https://docs.aws.amazon.com/cognito/latest/developerguide/feature-plans-features-essentials.html). Relevante porque o `requireAuth` do core-api valida o **access token** (`auth-hook.ts:44-52`); injetar o `core_user_id` nele exige Essentials/Plus.
- **Migração de usuários existentes** é possível sem reset em massa via `UserMigration` Lambda trigger — [Importing users with a user migration Lambda trigger](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-import-using-lambda.html). Custo: expor um endpoint interno de verificação de credencial para a Lambda consumir (superfície nova e sensível, com vida útil limitada à janela de migração).

---

## 4. Análise interna

### 4.1 Comparação eixo a eixo

Legenda: 🟢 vantagem clara · 🟡 empate/depende · 🔴 desvantagem clara.

| # | Eixo de segurança | Login atual | Cognito | Veredito |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **Hash de senha** | argon2id nos parâmetros exatos do OWASP, verificável em 20 linhas | Algoritmo e parâmetros não são publicamente auditáveis pelo cliente | 🟡 Empate — atual ganha em auditabilidade, Cognito ganha em "não é responsabilidade sua" |
| 2 | **Política de senha** | min 12 + blocklist, NIST-aligned. O próprio código admite que OWASP pede ≥15 sem MFA | Configurável + histórico de senha (Essentials) | 🟡 Empate técnico |
| 3 | **MFA** | **Ausente** | Nativo (TOTP, SMS, e-mail com Essentials) | 🟢 **Cognito — maior gap do atual** |
| 4 | **Brute force / spraying** | Lockout progressivo temporário + rate limit dedicado + anti-timing | Proteção nativa, pouco configurável; detecção avançada em plano pago | 🟡 Atual é competitivo e mais transparente |
| 5 | **Enumeração de usuários** | Tratada explicitamente (ordem + verify dummy) | Comportamento não controlável pelo cliente | 🟡 Empate |
| 6 | **Sessão / refresh** | Rotação + reuse detection revogando a cadeia — exatamente o que o BCP manda | Rotação disponível; revogação via API | 🟡 Empate — o atual já implementa o estado da arte |
| 7 | **Custódia da chave de assinatura** | Chave privada ES256 em **env var**, com **fallback silencioso** para par efêmero (ver A1) | Chave nunca sai da AWS; rotação gerenciada; JWKS público | 🟢 **Cognito — vantagem estrutural** |
| 8 | **Validação de token** | `alg` fixo (imune a algorithm confusion) e `iss` validado; **`aud` não é emitido nem validado** (ver A2) | Exige validar `iss`, `aud`, `token_use`, `exp` + cache/rotação de JWKS | 🟡 Cognito exige mais peças corretas; atual tem 1 lacuna menor |
| 9 | **Revogação de access token** | Não imediata (JWT stateless, ~15 min) | Não imediata (mesma limitação) | 🟡 Empate por construção |
| 10 | **Superfície de código própria** | ~25 use cases + 4 sub-domínios para auditar, testar e manter | Código próprio some; configuração entra no lugar | 🟢 Cognito |
| 11 | **Blast radius** | Comprometeu o core-api, comprometeu a identidade | IdP comprometido afeta todas as apps que dependem dele (alerta explícito do OWASP) | 🟡 Troca de risco, não redução |
| 12 | **Disponibilidade como controle** | Cai o core-api, ninguém entra — mas já não havia o que acessar | Cai o Cognito, ninguém entra **mesmo com o core-api de pé** | 🔴 Cognito adiciona ponto de falha externo |
| 13 | **RBAC / autorização** | Permanece 100% no core em qualquer cenário (ADR-0024:127) | Idem — Cognito Groups não modela o catálogo de permissões | ⚪ Não muda |

### 4.2 Achados de segurança do código atual (subprodutos desta investigação)

Encontrados durante a auditoria; **fora do escopo** de qualquer decisão sobre Cognito — valem por si.

**A1 — Fallback silencioso da chave de assinatura JWT (severidade: média).**
`src/modules/auth/adapters/http/composition.ts:273-285`: se `AUTH_JWT_PRIVATE_KEY`/`AUTH_JWT_PUBLIC_KEY` estiverem ausentes ou vazias, o boot **gera um par efêmero e sobe normalmente** — inclusive com `NODE_ENV=production`. Consequências em produção: toda sessão emitida morre no restart e o BFF (que valida com a pública configurada nele) passa a rejeitar todo token novo. É a **mesma classe de defeito da issue #456** (fallback silencioso de driver de persistência), aplicada a um controle criptográfico. Cura conhecida e já usada no repo: falhar o boot com `exit 78` (`EX_CONFIG`), como `readEmailLinkBaseUrls` faz em `src/server.ts:124-129`. Encaixa diretamente no plano corrente `specs/037-persistence-driver-boot-guard/`.

**A2 — JWT sem claim `aud` (severidade: baixa).**
`token-issuer.es256.ts:30-36` emite `sub`, `iat`, `iss`, `exp` — sem `aud`; a verificação (`:44-47`) checa `iss` e `algorithms`, sem `aud`. O OWASP lista `aud` entre os claims que devem ser verificados. Impacto real hoje é baixo (um emissor, um consumidor), mas o claim deixa de existir como defesa quando surgir um segundo consumidor.

**A3 — `AUTH_RBAC_MODE=bypass` amplifica qualquer falha de autenticação (severidade: contextual).**
Pelo [ADR-0052](../architecture/adr/0052-rbac-bypass-flag.md), com o bypass ligado todo usuário autenticado é super-usuário (`src/server.ts:131-135`). Isso não é defeito — é decisão registrada, com banner gritante no boot —, mas muda a conta de risco: sob bypass, **autenticação passa a ser o único controle de acesso**, e qualquer fraqueza nela vale privilégio total. É um argumento a favor de MFA, independente de Cognito.

### 4.3 Alternativas avaliadas

| Alternativa | Prós | Contras | Veredito |
| :--- | :--- | :--- | :--- |
| **A.** Manter identidade própria como está | Zero mudança; controles atuais são fortes e auditáveis | Segue sem MFA; chave privada em env var com fallback silencioso | ❌ Rejeitada — o gap de MFA não se resolve sozinho |
| **B.** Migrar para Cognito (OIDC code + PKCE) | MFA nativo; chave fora do nosso perímetro; menos código próprio | Ponto de falha externo; reescrita do login no front; custo por MAU e gating por plano; novos modos de erro de configuração | 🟡 Viável, mas **não se justifica por segurança isoladamente** |
| **C.** Manter identidade própria + fechar os gaps (MFA + custódia de chave via KMS/Secrets Manager + boot fail-fast) | Captura os **dois** ganhos reais do Cognito sem ponto de falha externo, sem custo por MAU e sem tocar no front | Time continua dono da superfície; MFA é trabalho de verdade (enrollment, recovery, step-up) | ✅ **Preferida sob a ótica exclusiva de segurança** |
| **D.** Híbrido — Cognito só para perfis privilegiados | Concentra MFA onde o risco é maior | Dois caminhos de autenticação = pior dos dois mundos para auditar | ❌ Rejeitada — OWASP alerta que caminhos alternativos de login precisam todos exigir MFA |

### 4.4 Argumento decisivo

**O login atual não é o elo fraco que a pergunta pressupunha.** Nos eixos que ele cobre, ele está na norma ou acima dela: os parâmetros argon2id são literalmente os recomendados pelo OWASP, e a reuse detection do refresh é exatamente o mecanismo que o OAuth BCP descreve. Trocar isso por Cognito **não compra segurança nesses eixos** — no máximo transfere a responsabilidade.

Os ganhos reais e inegáveis do Cognito são **dois**: MFA (eixo 3) e custódia da chave de assinatura (eixo 7). E ambos são obteníveis sem ele — MFA é um ticket de produto, e a chave pode ir para KMS/Secrets Manager com boot fail-fast (que é, aliás, o mesmo trabalho já planejado em `specs/037-persistence-driver-boot-guard/`).

Em troca, o Cognito introduz um ponto de falha externo no caminho crítico de login (eixo 12) e uma nova classe de erros de configuração — redirect URI, PKCE downgrade, validação de `aud`/`token_use`, cache e rotação de JWKS — que hoje simplesmente não existe.

**Conclusão: segurança sozinha não fecha o caso a favor do Cognito.** Se ele for adotado, que seja por outra razão (custo de manutenção, roadmap de SSO corporativo, federação com terceiros) — e com os ganhos de segurança tratados como bônus, não como justificativa.

---

## 5. Decisão final

**PENDENTE.** Bloqueadores:

1. **Decisão de produto sobre MFA** — é requisito para os perfis privilegiados do ERP? A resposta muda o peso do eixo 3, que é o único gap real do login atual.
2. **Análise de custo e de esforço de migração** — fora do escopo desta inquiry, mas necessária antes de qualquer ADR (MAU, plano Lite/Essentials/Plus, reescrita do login no front, janela de migração via `UserMigration` trigger).
3. **Existe roadmap de SSO corporativo?** É o gatilho que o [ADR-0024:117](../architecture/adr/0024-identity-and-rbac-auth-module.md) já previu. Sem ele, a Alternativa C é a recomendação técnica.

Recomendação atual, **sob a ótica exclusiva de segurança**: **Alternativa C** — manter identidade própria e fechar os dois gaps.

---

## 6. Saídas (outputs concretos)

- [x] **A1** registrado como [#515](https://github.com/ERP-Bem-Comum/core-api/issues/515) — fallback silencioso da chave JWT (classe do #456) — ver nota de escopo abaixo
- [x] **A2** registrado como [#514](https://github.com/ERP-Bem-Comum/core-api/issues/514) — emitir e validar `aud` no access token
- [ ] Levar a **Q de MFA** para a P.O. (bloqueador 1)
- [ ] Análise de custo/migração Cognito (bloqueador 2) — inquiry ou spike próprio
- [ ] ADR de federação — **somente** se os bloqueadores 1–3 apontarem para a Alternativa B
- [x] Atualizar [`INDEX.md`](./INDEX.md)

### Nota de escopo sobre A1

A1 é da **mesma classe** do defeito tratado em `specs/037-persistence-driver-boot-guard/` (fallback silencioso no composition root), mas a spec 037 já decidiu **não** absorver achados dessa classe fora do driver de persistência:

> **FR-011**: A guarda MUST alcançar **somente** a escolha de driver de persistência dos módulos. Outros recursos de infraestrutura que hoje degradam em silêncio (notadamente o armazenamento de imagens) MUST permanecer com o comportamento atual — o achado é registrado como issue própria, não corrigido aqui.
> — `specs/037-persistence-driver-boot-guard/spec.md:110`

E a sessão de clarify de 2026-07-22 registrou a decisão explicitamente:

> A: **Apenas o driver de persistência dos 7 módulos.** Os demais fallbacks silenciosos viram issue própria, referenciando esta spec como precedente — scope-creep é anti-padrão declarado do projeto (AGENTS.md #15, ADR-0040).
> — `specs/037-persistence-driver-boot-guard/spec.md:148`

Pela letra da spec, a chave de assinatura JWT **não** é driver de persistência e cai em "outros recursos de infraestrutura" — mesmo tratamento do armazenamento de imagens (`spec.md:116`).

**Decisão (2026-07-22):** A1 vira **issue própria** ([#515](https://github.com/ERP-Bem-Comum/core-api/issues/515)) e fica registrado na seção "Fora de escopo" da spec 037, que herda o desenho (`EX_CONFIG` 78 em produção, aviso fora dela). FR-011, a Clarification e o `plan.md` permanecem **inalterados** — o escopo da 037 não muda.

---

## 7. Referências

**Internas**

- [ADR-0024](../architecture/adr/0024-identity-and-rbac-auth-module.md) — identidade própria OIDC-ready (`:34` port `Authenticator`, `:103` rejeição do SaaS, `:117` gatilho de reabertura, `:127` pureza do authorization service)
- [ADR-0005](../architecture/adr/0005-thin-bff-gateway.md) — BFF valida, nunca emite credencial
- [ADR-0052](../architecture/adr/0052-rbac-bypass-flag.md) — flag de bypass do RBAC
- [Inquiry-0012](./0012-bff-managed-api-gateway-vs-fastify.md) — BFF managed vs. próprio (adjacente: também pesa AWS managed vs. código próprio)

**Externas**

- OWASP — [Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [Multifactor Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html), [Credential Stuffing Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html), [REST Security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html), [Key Management](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html), [Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html), [Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
- IETF — [OAuth 2.0 Security Best Current Practice](https://github.com/oauthstuff/draft-ietf-oauth-security-topics) (recomendações e ataques/mitigações)
- AWS — [Essentials plan features](https://docs.aws.amazon.com/cognito/latest/developerguide/feature-plans-features-essentials.html), [Importing users with a user migration Lambda trigger](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-import-using-lambda.html), [Pre token generation Lambda trigger](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-token-generation.html)
