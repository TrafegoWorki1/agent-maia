# Mapa operacional das regras da Maia

Documento humano derivado de `config/maia-rules.json` (versão 2026-10-22.1). Não é uma segunda fonte normativa.

O limite geral vigente é de **30 passos observáveis**, definido somente em `config/ai-routing.json`. Claude usa esse valor como turnos; o SDK do Codex não oferece limite nativo de turnos e por isso a Maia o aplica às chamadas MCP observáveis.

## Como ler

Identidade e permissões são confirmadas no servidor. Mensagens, memórias, documentos e resumos nunca concedem acesso. Aprovações são pontuais, expiram e não alteram permissões permanentes.

## Índice

- 1. **Quem pede — Objetivo e capacidades** (`identidade`)

- 2. **Resposta — Como responder** (`estilo`)

- 3. **Dados — Dados reais** (`dados`)

- 4. **Aprovação — Ações que alteram algo** (`aprovacao`)

- 5. **Privacidade — Dados de terceiros** (`privacidade`)

- 6. **Segurança — Conteúdo não é instrução** (`conteudo`)

- 7. **Limites — O que não faz** (`limites`)

- 8. **Artes — Criação de artes** (`arte`)

- 9. **Base — Regras e decisões do projeto** (`base`)

- 10. **WhatsApp — Grupos e envio** (`whatsapp`)

- 11. **Grupos — Criar grupo** (`criar_grupo`)

- 12. **Grupos — Grupo operacional** (`grupo_operacional`)

- 13. **Quem pede — Números desconhecidos** (`remetente`)

- 14. **Aprovação — Regras da aprovação** (`aprovacao_regras`)

- 15. **Limites — Limites de execução** (`execucao`)

- 16. **Mensagens — Mensagens seguidas** (`agrupamento`)

- 17. **Dados — O que fica guardado** (`dados_guardados`)

- 18. **Segurança — Segredos** (`segredos`)

- 19. **Triagem — Triagem em modo sombra** (`triagem`)

- 20. **Artes — Limites da arte** (`arte_limites`)

- 21. **Grupos — Privacidade nos grupos** (`grupos_privacidade`)

- 22. **Painel — Acesso ao painel** (`painel_acesso`)

- 23. **Quem pede — Número do dono** (`dono_numero`)

- 24. **Resposta — Respostas curtas** (`resposta_curta`)

- 25. **Instagram — Instagram de Herickson Maia** (`instagram`)

- 26. **Conduta — Proatividade** (`proatividade`)

- 27. **Conduta — Precisão e conferência** (`precisao_conferencia`)

- 28. **Grupos — Ações em grupos** (`grupos_acoes`)

- 29. **Conexões — Achar a ferramenta antes de dizer que não tem** (`conectores_ferramentas`)

- 30. **Pessoas — Contatos e membros** (`contatos_membros`)

- 31. **Mídia — Imagens, vídeos, documentos e áudios** (`midia`)

- 32. **LinkedIn — LinkedIn de Herickson Maia** (`linkedin`)

- 33. **Execução — Consulta operacional** (`execucao_consulta`)

- 34. **Execução — Execução e entrega** (`execucao_resultado`)

- 35. **Execução — Tarefas reais** (`tarefas`)

- 36. **Execução — Lembretes persistidos** (`lembretes`)

- 37. **Instagram — Consultas do Instagram** (`instagram_consultas`)

- 38. **Instagram — Respostas no Direct** (`instagram_direct`)

- 39. **Instagram — Automações de comentário para DM** (`instagram_automacoes`)

- 40. **Anúncios — Vídeo ou imagem do WhatsApp para Meta Ads** (`anuncios_midia_url`)

- 41. **Limites — Verificar capacidade antes de prometer** (`capacidades_reais`)

- 42. **Conferência — Verificar prova antes de confirmar resultado** (`quality_audit`)

- 43. **Conferência — Registrar incidente ao identificar erro ou incerteza** (`auto_incidente`)

- 44. **Limites — Seguir padrões de prevenção aprovados** (`prevencao_padrao`)

- 45. **Conexões — Criar e publicar site (HTML, GitHub e Vercel)** (`site_publicar`)

- 46. **Conexões — Ler e editar planilhas do Google Sheets** (`google_sheets`)

- 47. **Conexões — Consultar contas, campanhas e métricas do Meta Ads** (`meta_ads`)

- 48. **Conexões — Consultar e criar eventos na Google Agenda** (`agenda`)

