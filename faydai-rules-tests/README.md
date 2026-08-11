# Deploy das Firestore Rules — Faydai

## 0. Pré-requisitos locais (rodar isso na sua máquina, não aqui)

```bash
npm install -g firebase-tools   # ou npx firebase-tools
firebase login
# Java é exigido pelo Firestore Emulator (JRE 11+)
java -version
```

## 1. Testar com o Emulator Suite ANTES de qualquer deploy

Copie esta pasta (`faydai-rules-tests/`) para o seu repositório, ao lado do
`firestore.rules` real do projeto (ou ajuste o caminho lido no teste).

```bash
cd faydai-rules-tests
npm install
npm test
```

O `npm test` sobe o emulador do Firestore isolado, roda a suíte
(`test/firestore.rules.test.js`) e derruba o emulador ao final —
não precisa deixar nada rodando manualmente. Se quiser inspecionar
manualmente pela UI do emulador:

```bash
npm run emulator
# abre em http://127.0.0.1:4000 (Firestore em 127.0.0.1:8080)
```

### O que a suíte cobre (mapeado em `controle-acesso-custom-claims.md`)

| Cenário | Esperado |
|---|---|
| `company_admin` lê `reports` do próprio `orgId` | ✅ permitido |
| `company_admin` lê `reports` de **outro** `orgId` | ❌ negado |
| `company_admin` lê `invites`/`responses`/`linkage`/`participants` do próprio org | ❌ negado (sempre, sem exceção) |
| Claim só com namespace `backoffice` tenta ler via rules | ❌ negado (backoffice_admin não é validado por rules, só por middleware/Admin SDK) |
| Usuário não autenticado | ❌ negado em tudo |
| `company_admin` tenta **escrever** em qualquer coleção | ❌ negado (escrita é só Admin SDK) |
| `company_admin` lê `orgs/{orgId}`, `units`, `rounds` do próprio org | ✅ permitido |
| `company_admin` lê `units`/`rounds` de outro org | ❌ negado |

Se alguma dessas asserções falhar, **não faça o deploy** — corrija a regra
primeiro. É mais barato pegar isso no emulador do que em produção.

## 2. Checklist antes do `firebase deploy`

- [ ] `npm test` passa 100% localmente
- [ ] Revisão manual: nenhuma coleção sensível (`invites`, `responses`,
      `linkage`, `participants`) tem `allow read` condicional — deve ser
      `allow read, write: if false` fixo, sem `if` que dependa de claim
- [ ] Confirmar que o projeto do Firebase CLI aponta para o projeto certo:
      `firebase use --add` / conferir `.firebaserc`
- [ ] Se houver mais de um ambiente (staging/produção), rodar primeiro em
      staging
- [ ] Ter certeza de que **nenhum código do dashboard** (`company_admin`)
      ainda depende de ler `responses` diretamente — hoje o
      `PsychosocialDashboard.jsx` usa dados mockados, então não há
      regressão aqui, mas vale grep rápido por `collection(db, "responses"`
      no client-side antes de travar as rules

## 3. Deploy

```bash
# preview do diff antes de aplicar (opcional mas recomendado)
firebase deploy --only firestore:rules --dry-run 2>/dev/null || true

# deploy real
firebase deploy --only firestore:rules
```

Isso publica **só** as rules (não mexe em Functions, Hosting, etc.).
Se quiser publicar rules + índices juntos:

```bash
firebase deploy --only firestore
```

## 4. Depois do deploy

- Testar manualmente com uma conta `company_admin` real (custom claim
  setado) contra o projeto de staging, confirmando na prática que `reports`
  abre e que `responses`/`invites` continuam fechados.
- Só então liberar a emissão do claim `company_admin` para contas reais de
  RH (isso ainda está em aberto — ver seção 4 de
  `controle-acesso-custom-claims.md`, "fora do escopo deste documento").

## Nota

Este ambiente de sandbox não tem acesso de rede aos domínios do Firebase/
Google (só npm, pypi, github), então os testes acima **não foram
executados aqui de fato** — só preparados. Rode `npm test` na sua máquina
ou CI antes do deploy.
