# Plano de execução: alinhamento do comportamento da Maia

Data: 10/10/2026. Status: implementação autorizada pelo owner e em validação.

Este documento registra o plano de trabalho e não é uma instrução ativa para a Maia. A política vigente é gerada em `docs/regras-da-maia.md`. Não incluir este plano automaticamente na base de conhecimento.

Atualização de escopo autorizada durante a implementação: incluir nas regras os novos recursos do Instagram que o owner está implementando no Claude em paralelo — consultas, resposta elegível no Direct e automações de comentário para DM, com aprovações específicas. Preservar os arquivos dessa implementação. As restrições a DM fria e prospecção autônoma permanecem.

## Objetivo

Alinhar regras aprovadas, Markdown, prompt de sistema, conhecimento recuperado e comportamento das ferramentas. Remover contradições sem liberar novas ações, apagar o histórico ou trocar a arquitetura atual.

## Modelo para o Codex implementar

Minha recomendação para esta revisão é **GPT-6 Astra com raciocínio High**, se estiver disponível no seletor da conta. A escolha prioriza capacidade para uma mudança que atravessa documentação, autorização, prompt e banco. É uma recomendação para o assistente que implementará o projeto, não para os modelos usados pela Maia.

Alternativa: **GPT-6.1 Sol**, com esforço elevado disponível no cliente. A documentação oficial recomenda Sol para programação complexa e apresenta Astra como a opção de maior capacidade para trabalhos difíceis entre várias etapas e ferramentas. Disponibilidade varia por conta e cliente.

Fonte verificada: [modelos e esforço de raciocínio no Codex](https://learn.chatgpt.com/docs/models#choosing-astra-sol-and-luna).

Nenhum modelo garante implementação sem erros. A segurança da entrega depende também de mudanças pequenas, testes, revisão e reversão preparada.

## Problemas que o plano precisa resolver

Base: análise anterior dos Markdown e das 31 regras ativas, com confirmação local de `server/rules.ts` e `server/knowledgeSync.ts`. Revalidar o estado antes de implementar.

| Tema | Divergência observada | Direção da correção |
| --- | --- | --- |
| Autorização | Trechos exigem aprovação para qualquer escrita; outros descrevem autonomia do owner e permissões por membro. | Descrever a política aprovada por papel e ação; preservar os bloqueios reais das ferramentas. |
| Áudio e mídia | A identidade ainda diz que áudio não é transcrito; outras regras e o código suportam isso. | Documentar os papéis elegíveis, o fluxo existente e os limites de retenção. |
| Privacidade | Há proibição absoluta de guardar texto de terceiros, mas existem exceções de contexto e retenção. | Separar mensagens do owner, grupos cadastrados, contatos, mídia e payloads, sem ampliar coleta. |
| Integrações | Documentos ainda falam em demo e integrações futuras; LinkedIn não tem regra específica. | Registrar apenas ferramentas implementadas e escopos aprovados. Não prometer DMs/InMail ou outros recursos não disponíveis. |
| Estilo | A regra de três linhas é rígida para análises e relatórios. | Propor resposta curta para ações simples e detalhe proporcional quando solicitado; submeter a mudança de estilo ao owner. |
| Prompt | Regras viram um bloco sem títulos; a reserva local é muito menor que a política ativa. | Preservar estrutura e criar reserva aprovada, versionada e explicitamente identificada. |
| Conhecimento | O RAG contém o plano antigo e o histórico, mas não o documento de regras. | Separar referência histórica de política vigente; alterar fontes somente após aprovação. |

## Organização e precedência propostas

- `CLAUDE.md`: instruções atuais de desenvolvimento, segurança, arquitetura e validação. Não misturar regras vigentes com decisões históricas contraditórias.
- `docs/regras-da-maia.md`: explicação do comportamento vigente, baseada na mesma versão aprovada usada para montar o prompt.
- `maia_rules`: representação operacional das regras ativas. O código continua responsável por verificar autorização e aprovação.
- Um catálogo versionado, inicialmente proposto em `config/maia-rules.json`: proposta revisável e origem das representações geradas, depois de aprovada essa organização. Não manter catálogo, banco e documento como três fontes editáveis independentes.
- `README.md`: operação e arquitetura reais. `TODO.md`: pendências atuais, não uma declaração de funcionalidades já entregues.
- `plan.md` e planos antigos: marcar como históricos ou atualizar o status das partes entregues; não tratá-los como instruções vigentes.
- `CHANGELOG.md`: histórico completo existente. `docs/erros-e-mudancas.md`: resumo existente com causas, correções, verificações e pendências. Não criar outro histórico paralelo.

Texto recuperado de documentos nunca pode conceder acesso, substituir uma recusa da ferramenta ou transformar uma proposta em decisão aprovada. Se a decisão do owner e a implementação divergirem, registrar a divergência e resolver antes de ativar a mudança.

## Sequência de execução

### 1. Registrar a situação inicial

Conferir Git, regras ativas, fontes do conhecimento e testes existentes. Registrar códigos, ordem, textos, versão/hash e diferenças, sem copiar credenciais ou dados pessoais para documentos públicos. Preparar uma cópia protegida das regras que poderão ser alteradas.

Entrega: lista fechada de contradições e referência para comparação e reversão.

### 2. Fechar a matriz de comportamento aprovado

Para cada ação, listar papel elegível, permissão, necessidade de aprovação, escopo, retenção e evidência de conclusão. Usar decisões já aprovadas e código como evidências; não presumir que a última frase de um histórico autoriza uma nova capacidade.

Apresentar ao owner apenas decisões realmente ambíguas. A mudança não deve liberar prospecção autônoma, ações em massa, acesso a segredos ou funcionalidades ausentes.

Entrega: matriz aprovada, incluindo casos de recusa e indisponibilidade de integração.

### 3. Alinhar documentação e catálogo

Separar instrução vigente de histórico e proposta. Corrigir capítulos fora de ordem, descrições de demo obsoletas, capacidades e retenções contraditórias. Produzir o catálogo e a documentação a partir da mesma matriz aprovada.

Preservar decisões históricas nos registros existentes, com data e status. Não apagar evidência de erros anteriores nem incluir números pessoais nas regras publicadas.

Entrega: documentação coerente e diferença de regras revisável, sem ativação em produção.

### 4. Alinhar prompt e base de conhecimento

Em `server/rules.ts`, preservar títulos, categorias, códigos e ordem determinística; eliminar instruções duplicadas ou conflitantes entre regras e diretrizes locais. Gerar a reserva local da versão aprovada e registrar quando ela for usada. Se não houver reserva confiável, restringir efeitos externos em vez de improvisar a política.

Em `server/knowledgeSync.ts` e na busca, propor fontes vigentes explícitas e tratamento separado do histórico. Incluir as regras vigentes somente com autorização para mudar as fontes. Retirar um arquivo da lista de sincronização não basta: verificar e desativar, de forma recuperável e aprovada, a fonte antiga já indexada quando necessário.

Validar a política em ambos os executores, Claude e Codex. Não alterar seus modelos, orçamento ou roteamento como parte deste alinhamento.

Entrega: prompt estruturado e conhecimento com precedência verificável, sem ganho de permissões.

### 5. Testar antes de ativar

Ampliar `tests/rules.test.ts`, `tests/knowledge.test.ts` e os testes existentes de autorização, aprovação e ponte Codex. Cobrir ao menos:

1. Owner em ação interna permitida e ação pública que exige aprovação.
2. Membro com permissão, sem permissão e com `conversa.maia` no privado.
3. Grupo cadastrado e grupo não cadastrado; autoria e retenção corretas.
4. Aprovação expirada, consumida ou com permissão revogada.
5. Áudio/mídia nos papéis elegíveis e limites de retenção.
6. Consulta e publicação LinkedIn/Instagram; recusa de capacidade ausente.
7. Erro ou ausência de regras no banco, reserva, ordenação e cache.
8. Documento antigo contraditório ou instrução maliciosa no conteúdo recuperado.
9. Resultado externo incerto sem reenvio automático; conclusão somente com evidência.
10. Resposta curta para confirmação e relatório completo quando solicitado.

Executar `pnpm typecheck`, `pnpm test`, `pnpm db:validate`, `pnpm db:guard` e `pnpm build`. Testes de cenários não devem enviar mensagens, publicar, gastar ou alterar dados de terceiros. Avaliar respostas com entradas controladas e registrar modelo, prompt e resultado; testes determinísticos não provam sozinhos coerência semântica.

Entrega: comandos aprovados, resultados registrados e revisão separada das mudanças. Avisos preexistentes devem ser identificados, não ocultados.

### 6. Ativar com aprovação e reversão

Mostrar o diff final antes de alterar regras ou índices de produção. Atualizar somente os códigos aprovados, em transação, conferindo os valores anteriores; abortar se houver mudanças concorrentes. Não sobrescrever regras novas do usuário nem reativar regras desativadas sem aprovação.

Se alguma mudança exigir estrutura de banco, seguir `docs/database-migrations.md`: nova migração pelo fluxo do projeto, testes e aprovação do owner antes de aplicar. Não editar migrações aplicadas nem fazer DDL avulso em produção.

Coordenar catálogo, regras ativas, código e conhecimento para evitar versões incompatíveis. Validar a leitura posterior das regras e o prompt realmente usado pelos dois executores. Considerar o cache de regras de 60 segundos e a sincronização horária do conhecimento; verificar hashes efetivos, não apenas o arquivo local. Deploy, push e reinício do worker exigem a autorização correspondente.

Reversão: restaurar apenas os textos/estados alterados a partir da cópia validada, reverter código para uma versão compatível e restaurar as fontes de conhecimento. Não apagar tabelas, histórico ou dados para voltar atrás.

Entrega: versão ativa confirmada, evidências e procedimento de reversão registrado nos Markdown existentes.

## Critérios de conclusão

- Cada divergência tem solução aprovada ou pendência explícita; nenhuma pendência de segurança fica escondida como concluída.
- Documento, catálogo, banco e prompt correspondem à mesma versão aprovada.
- Política vigente é distinguível de histórico e proposta na recuperação de conhecimento.
- Claude e Codex passam pelos mesmos controles de permissão e aprovação.
- Os testes dos cenários e os comandos de qualidade passam, sem ações externas indevidas.
- A leitura em produção confirma a versão ativada; a reversão foi preparada.
- Erros, melhorias, verificações e limitações estão nos registros Markdown já existentes.

Implementar em entregas pequenas e revisar entre elas. Não declarar “sem erros”; declarar o que foi verificado e quais riscos ainda permanecem.
