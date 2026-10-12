# Pendências atuais da Maia

Atualizado em 10/10/2026. Comportamento aprovado: [regras vigentes](docs/regras-da-maia.md). Entregas anteriores e seus resultados estão no [changelog](CHANGELOG.md).

## Atualizado em 12/10/2026 — a fazer

**Validar ao vivo (pelo WhatsApp, com o número do dono)**
- [ ] Rotas de escrita da Evolution e da Zernio (responder, ocultar, apagar, reagir, renomear grupo etc.): nenhuma foi exercitada.
- [ ] Menção a todos (menção fantasma) em um grupo real: confirmar que todos recebem o aviso.
- [ ] Prospecção de ponta a ponta: checagem de WhatsApp, lote, OK por contato, teto e SAIR.
- [ ] Busca na web pelo WhatsApp e a trava depois da busca.
- [ ] Reação no WhatsApp: a Maia precisa do id da mensagem; testar com um id real.

**Implementar**
- [ ] Descadastro automático quando o contato responde SAIR (hoje é manual, com `prospeccao_descadastrar`).
- [ ] Escrita de ice breakers do Instagram: o formato dos itens não está documentado.
- [ ] Conexão de conta da Zernio por OAuth: exige login no navegador.

**Ações do owner**
- [x] Reconciliar `20261011185724_maia_client_groups_access` com o histórico aplicado; `response_deliveries.requester` permanece somente na migração nova `20261012014613`.
- [x] Migração `20261012030526_maia_secrets_vault` aplicada; chave `INTEGRACAO_VAULT_KEY` criada no `.env`; worker reiniciado.
- [ ] Testar o cofre pelo privado do dono: `cofre teste | abc12345678`, depois `cofre listar` e `cofre apagar teste`.
- [x] `MAIA_LID` cadastrada na Vercel (tipo plain, Production) e PR #6 mesclado em 12/10/2026.
- [ ] Testar ao vivo, em grupo cadastrado: menção por texto, resposta por citação a uma mensagem da Maia e áudio marcando a Maia.
- [ ] Whisper (EasyPanel, projeto n8n, serviço whisper-api): fora do ar, com o container reiniciando em loop no boot; o compose corrigido está salvo no EasyPanel mas ainda NÃO foi implantado. Implantar e ler o /boot.log para achar o erro de instalação (suspeita: pkg_resources/setuptools).
- [x] Migração `20261012104713_maia_rules_contatos_prospeccao` aplicada (regra de contatos com prospecção pedida pelo dono).
- [ ] Testar prospecção pelo WhatsApp com números seus: preparar lote, enviar um contato com OK, conferir teto e SAIR.
- [ ] Decidir se o webhook da Vercel deve apagar o texto do comando `cofre` antes de gravar na fila (hoje o worker apaga logo depois de ler).
- [ ] Revisar e publicar a reorganização do painel: sete áreas, clientes e grupos de acesso; conferir visualmente o painel autenticado e exercitar um grupo de cliente autorizado.
- [ ] Revisar e fazer o merge do PR #5 (as migrações já estão aplicadas).
- [ ] Reiniciar o worker sempre que o código mudar.

**Limpeza**
- [ ] Conferir o `db:drift` depois das migrações desta semana.


## Validações operacionais

- [x] Aplicar `20261011012443_maia_owner_preferences_v1.sql` no Supabase (exceção direta explicitamente autorizada pelo owner); reconciliar versão registrada e arquivo do repositório antes do merge.
- [ ] Após o deploy do PR #4, testar pelo WhatsApp uma proposta, confirmação literal, expiração e uma preferência restritiva; confirmar que nenhuma preferência altera permissões ou ações externas.
- [ ] Conferir uma conversa real após o alinhamento: consulta, aprovação, áudio e continuidade de contexto. Os testes automatizados não substituem avaliação semântica das respostas.
- [ ] Validar pelo WhatsApp o fluxo de membro autorizado com texto, áudio e imagem, usando contatos autorizados pelo owner.
- [ ] Fazer inspeção visual autenticada do painel; na revisão anterior o navegador estava indisponível.
- [ ] Avaliar relevância e resolução em amostra humana de pedidos reais; as metas do plano de eficácia ainda não são resultados comprovados.

## Melhorias que continuam pendentes

- [ ] Vincular a aprovação persistida à impressão digital de parâmetros e revisar a revalidação de permissões durante a espera.
- [ ] Definir escopo de memória por cliente antes de incluir documentos de clientes. A busca atual é só documental do projeto.
- [ ] Decidir eventual prazo de retenção de `messages`; hoje não há exclusão automática por idade.
- [x] Carregar páginas sob demanda e retirar o fluxo de demonstração da navegação: entrada JavaScript de 458,90 kB no build da reorganização, abaixo do aviso de 500 kB.

## Fora do escopo aprovado

- Prospecção autônoma, escalonamento automático para grupos e ações em massa.
- DMs/InMail do LinkedIn, DMs frias e comentários avulsos fora das automações aprovadas do Instagram.
- Integração Kommo e novos formatos/recursos sociais que não estejam nas ferramentas.

Permissões por pessoa, áudio pelo Whisper, grupos cadastrados, cota de imagens, tarefas/lembretes e integração Zernio já existem. Não tratá-los como funcionalidades futuras por causa dos planos históricos.

As ferramentas Instagram agora estão disponíveis nos executores Claude e Codex. Validação autenticada da interface e dos fluxos externos segue pendente; áudio pode exigir reconexão Facebook Login. Não testar envio real sem um cenário de teste autorizado.

- [ ] Jev: rotular ~100 mensagens reais; só considerar roteamento ativo com 200 rotuladas e 85% na faixa de alta confiança. Usar complexidade=simples para modelo mais barato em modo sombra.
