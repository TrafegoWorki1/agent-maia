# Plano — Quality Audit, Self-Correction e Aprendizado com erros

> Elaborado em 2026-10-19. Contexto: a Maia às vezes afirma que executou uma ação sem ter prova real, e não registra nem aprende com os erros que comete. Este plano implementa três capacidades de qualidade que se complementam.

---

## Capacidades a implementar

| Capacidade | Descrição |
|---|---|
| **Quality Audit** | Antes de confirmar um resultado ao dono, avaliar se há prova real de execução (ID de mensagem, URL publicada, etc.). Resultado sem prova é reportado como incerto, não como concluído. |
| **Self-Correction** | Quando um erro ou resultado incerto ocorre, registrar automaticamente um incidente com causa, ferramenta e contexto. Propor correção ao dono quando aplicável. |
| **Aprendizado com erros** | Armazenar padrões de falhas aprovados pelo dono como regras de prevenção. Esses padrões entram no contexto do agente a cada execução, reduzindo reincidência. |

---

## Etapa 1 — Migrações de banco

Criar duas tabelas novas:

**`maia_incidents`** — registra erros e resultados incertos com causa e contexto:
- `id`, `created_at`
- `tipo`: `execution_error` | `missing_proof` | `uncertain_result`
- `ferramenta`: nome da ferramenta que falhou (nullable)
- `descricao`: o que aconteceu
- `contexto`: JSON com dados relevantes (task_id, contact, etc.)
- `status`: `open` | `resolved` | `ignored`
- `correcao_proposta`: texto da correção sugerida (nullable)
- `resolved_at`, `resolved_by`

**`maia_error_patterns`** — padrões de falha aprovados pelo dono:
- `id`, `created_at`
- `codigo`: slug único
- `descricao`: o padrão observado
- `regra_prevencao`: instrução de prevenção (entra no prompt)
- `aprovado_em`: timestamp da aprovação do dono
- `ativa`: boolean
- `incident_id`: referência ao incidente de origem (nullable)

Arquivo: `supabase/migrations/YYYYMMDD_maia_quality_selfcorrection.sql`

---

## Etapa 2 — Código do servidor

**`server/qualityAudit.ts`** (novo):
- `auditResult(tool, result)`: recebe o resultado de uma ferramenta e avalia se há prova real. Retorna `{ ok, proof, uncertainty }`.
- Regras por tipo: mensagem exige `messageId`; publicação Instagram exige URL ou `mediaId`; Drive exige `fileId`.
- Resultado sem prova → chama `createIncident` com `tipo: missing_proof`.

**`server/incidents.ts`** (novo):
- `createIncident(tipo, ferramenta, descricao, contexto)`: insere em `maia_incidents`.
- `proposeCorrection(incidentId, texto)`: salva `correcao_proposta` e notifica o dono.
- `resolveIncident(incidentId)`: marca como resolvido.

**`server/errorPatterns.ts`** (novo):
- `loadActivePatterns()`: lê `maia_error_patterns` onde `ativa = true`. Cache de 60 s.
- `proposePattern(incidentId, descricao, regra)`: cria padrão com `ativa = false`, aguarda aprovação.
- `approvePattern(codigo)`: ativa o padrão; owner confirma pelo WhatsApp.

**`server/rules.ts`** (alterar):
- `buildErrorPatternsSection()`: injeta padrões ativos como bloco "Padrões de falha conhecidos" no prompt do sistema, análogo ao `buildCapabilitiesSection` já existente.

**`server/maiaImageTool.ts` + `server/codexMaiaMcp.ts`** (alterar):
- Nova ferramenta `registrar_incidente`: o agente registra explicitamente quando percebe um erro ou resultado incerto.
- Nova ferramenta `propor_padrao_prevencao`: propõe um padrão ao dono após incidente aprovado.
- Adicionar ambas a `MAIA_TOOL_NAMES` em `toolPolicy.ts`.

**`server/inboxWorker.ts`** (alterar):
- Interceptar comando "aprovar padrão \<codigo\>" do dono para chamar `approvePattern`.

---

## Etapa 3 — Regras no catálogo

Adicionar três regras em `config/maia-rules.json` (versão `2026-10-19.2`):

1. **`quality_audit`** (categoria: Conferência): antes de confirmar execução de efeito externo, verificar se o resultado contém prova real. Resultado sem prova é comunicado como incerto.
2. **`auto_incidente`** (categoria: Conferência): ao identificar erro de ferramenta ou resultado incerto, registrar incidente com `registrar_incidente` antes de responder ao dono.
3. **`prevencao_padrao`** (categoria: Limites): consultar o bloco "Padrões de falha conhecidos" antes de executar ações que já geraram incidente anterior; seguir a regra de prevenção correspondente.

Após alterar o catálogo: `pnpm rules:generate` e `pnpm rules:check`.

Preparar migração SQL com INSERT das 3 regras.

---

## Etapa 4 — Verificações e commit

```
pnpm typecheck
pnpm rules:check
pnpm db:validate
pnpm test
```

Commit agrupando: migrações + código + catálogo + docs.

---

## Dependências e restrições

- `maia_incidents` e `maia_error_patterns` precisam de RLS: somente o owner lê e escreve.
- `approvePattern` exige confirmação explícita do dono — nunca ativação automática.
- O bloco de padrões no prompt só entra se houver ao menos um padrão ativo; sem padrões, nenhum bloco é injetado.
- Quality Audit não bloqueia o agente de responder — apenas muda o tom da resposta (incerto vs. confirmado).
- `registrar_incidente` entra em `LOCAL_SAFE_TOOLS` (sem aprovação pontual), pois é somente leitura/escrita interna.

---

## Estado atual (atualizado em 2026-10-20)

- [x] Etapa 1 — Migrações: `20261020030001_maia_quality_selfcorrection.sql` (tabelas `maia_incidents` e `maia_error_patterns`, RLS), aplicada em produção.
- [x] Etapa 2 — Código: `server/incidents.ts`, `server/errorPatterns.ts`, bloco de padrões em `server/rules.ts`, ferramentas `registrar_incidente` e `propor_padrao_prevencao` em `maiaImageTool.ts` e `codexMaiaMcp.ts`, inventário em `toolPolicy.ts`, comando "aprovar padrão \<codigo\>" em `maiaOwnerAgent.ts`.
- [x] Etapa 3 — Regras: catálogo `2026-10-20.1` com 44 regras (`quality_audit` 42, `auto_incidente` 43, `prevencao_padrao` 44); migração `20261020030645_quality_audit_rules.sql` aplicada em produção.
- [x] Etapa 4 — Verificações: `pnpm typecheck`, `pnpm rules:check`, `pnpm db:validate` (56 migrações) e `pnpm test` (76/76) aprovados. Commit `89a9303`.
- [ ] Reiniciar o worker local para carregar o código novo (`pnpm start` ou `Iniciar Maia.bat`).
- [ ] Validação ao vivo: provocar um incidente de teste pelo painel e confirmar o registro em `maia_incidents`; aprovar um padrão com "aprovar padrão \<codigo\>" e confirmar que ele aparece no prompt. Não usar envios ou publicações reais como teste.
- [ ] Revisão humana: primeiro padrão real só entra depois de aprovação explícita do owner.
