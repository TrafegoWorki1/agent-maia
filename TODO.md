# Pendências atuais da Maia

## Regras de vibecoding — estado de implantação

- [x] Após autorização explícita posterior, aplicar a migration `20261016223848_maia_vibecoding_access_retention.sql`: 51 versões alinhadas, 40 regras alinhadas e drift de 1.850 objetos sem divergência.
- [x] Iniciar o launcher local atualizado e verificar o worker; primeiro ciclo de retenção registrado no banco às 02:55:51 UTC de 17/10/2026, com `legacyFallback=false` e zero registros removidos.
- [ ] Configurar e validar um provider real de permissões do Google Drive antes de expor o wrapper gerenciado; até lá `share_file` permanece bloqueado para não criar acesso sem rastreio.

Atualizado em 16/10/2026. Comportamento aprovado: [regras vigentes](docs/regras-da-maia.md). Entregas anteriores e seus resultados estão no [changelog](CHANGELOG.md).

## Indicadores e quadros — evolução visual local

- [x] Cartões responsivos compartilhados; indicadores por área e motivos de indisponibilidade recolhidos.
- [x] Meu dia, equipe e coordenação com população clicável e dados atualizados na recarga.
- [x] Baseline semanal por equipe/período, capacidade em horas e avanço de entregáveis com denominador explícito.
- [x] Funil comercial em colunas; quadro de produção nas áreas; taxa de ganho independente do filtro de etapa.
- [x] Regras/tipos, 571 testes Vitest + 75 de banco temporário e build aprovados; capturas isoladas desktop/celular conferidas.
- [ ] Publicar a evolução visual após validação; sem nova migration e sem alteração de worker.

## Integração das áreas — PR #23 integrado

- [x] Projetos/Implementações conectados à carteira e tarefas reais da Central.
- [x] Trabalho/calendário de Marketing sobre os mesmos registros; snapshots gerais mantidos separados e restritos.
- [x] Oportunidades/funil internos e combinados de CS com fonte, próxima ação, revisão, auditoria e conversão idempotente em projeto.
- [x] Ferramentas comuns Claude/Codex; escrita pelo painel e WhatsApp usa as mesmas RPCs, com revalidação de capacidade/escopo.
- [x] Remover editor duplicado da área técnica e abrir áreas operacionais somente por telas autorizadas.
- [x] Financeiro lê observações autorizadas persistidas; sem coletor novo, sem somar períodos/moedas incompatíveis.
- [x] Aplicar `20261016180722_maia_department_workspace.sql` no projeto Supabase `Agent Maia` antes da publicação dependente; dry-run listou somente essa migration e o ledger local/remoto está alinhado.
- [ ] Revalidar drift do schema remoto: `pnpm db:drift` respondeu HTTP 401 na Management API; corrigir/renovar credencial de leitura e executar após a integração.
- [x] Enviar e integrar PR #23 por squash `5c504d4`, com checks aprovados.
- [ ] Confirmar publicação de produção e atualizar/reiniciar uma única instância do worker, em etapa separada.
- [ ] Validar visualmente com logins de homologação e fontes externas configuradas. Nenhum envio/publicação real foi usado como teste.

Mapa, matriz, catálogo e evidências: [integração do painel](docs/integracao-painel-maia.md).

## Painel colaborativo (implementação e integração autorizadas)

- [x] Backend autenticado, escopos por pessoa/equipe/cliente/projeto, papéis operacionais e restrição individual prevalecendo sobre herança.
- [x] Workflow compartilhado, trilha de alteração, revisões, baseline/planejamento, capacidade declarada e painéis com polling reconciliador.
- [x] Testes de permissão, isolamento, revogação, concorrência/revisão, indicadores e banco temporário.
- [x] Concluir edição de planos existentes/baseline, carteira de contrato/projeto/entregável, calendário real e detalhe de tarefas com artefatos/dependências.
- [x] Validar sincronização nos dois sentidos com banco temporário e KPIs com população superior a mil itens.
- [x] PR #21 integrado na main pelo squash `2fcd839`, com matriz, métricas e evidências de teste.
- [x] Aplicar migrations `20261016160000` e `20261016161000` no Supabase do projeto antes do merge; drift sem divergência (1697 objetos) e 40 regras alinhadas.
- [x] Publicação frontend/API Production Ready, CI da main aprovado e novas rotas recusando acesso sem login.
- [ ] Reiniciar uma única instância do worker local para carregar o checkout já atualizado.
- [ ] Validar operacionalmente com contas de teste por perfil, sem mensagens reais ou publicações.
- [ ] Configurar fontes externas e mapeamento por IDs de cliente/recurso; sem essa dependência, indicadores correspondentes permanecem indisponíveis.

Detalhes: [docs/painel-colaborativo.md](docs/painel-colaborativo.md).

## Núcleo da Maia — pendências de ativação e escopo

- [x] Persistência/busca de sessões de owner e membros com revalidação, migrações locais, painel autenticado, reserva atômica de planos/rotinas/subagentes e testes em banco temporário.
- [x] Aplicar no Supabase do projeto as migrações `20261016120000`, `20261016130000`, `20261016140000` e `20261016150000`; histórico remoto conferido em 16/10/2026.
- [x] Publicar o código dependente (`a5e31e4`) e atualizar/reiniciar um único worker; reinício verificado em 16/10/2026, com uma instância aguardando a fila.
- [ ] Validar recuperação de membro e revogação de `conversa.maia` e acesso ao grupo em ambiente operacional; não usar clientes reais como teste automático.
- [ ] Habilitar separadamente resumos, skills, subagentes e rotinas após revisão de limites, custos e entregas; MCP externo continua fora do catálogo dos executores.
- [x] Retomar planos por horário ISO futuro (até sete dias) com reserva idempotente no worker.
- [x] Registrar e exibir contadores de cache de entrada informados pelo Claude; valores ausentes ficam nulos.
- [ ] Implementar gatilhos gerais de plano por resposta/arquivo privado e obrigatoriedade de plano estruturado para todos os pedidos com múltiplas etapas.
- [ ] Medir custo efetivo e implantar runner isolado para navegador/comandos somente em ambiente com runtime e autorização explícita.

## Atualizado em 13/10/2026 — Vibe Code em andamento

**Etapa 0 — concluída** (commit `d13d339`)
- [x] Contratos TypeScript: `OperationalArea`, `OperationalContext`, `DataProvenance`
- [x] Navegação: Comercial, Projetos, Financeiro; "Clientes e CS"; redirects de legado
- [x] Migração `20261013210000`: `area`, `client_id`, `project_id` em `work_tasks`
- [x] Páginas com empty states honestos (sem mock data)

**Etapa 1 — pendente** (Plano 01: memória, planos robustos, cancelamento, agendamentos)
- [x] Contratos de sessão, histórico pesquisável e resumo com cobertura em `maia_nucleus_v1`
- [x] Dependências, leases, evidência e estado externo incerto para etapas de plano
- [x] Contratos de rotinas com intervalo/cron, fuso e distinção entre execução e entrega
- [x] Aplicar migrations no ambiente autorizado e ligar as retomadas implementadas ao worker operacional.
- [ ] `automation_rules`: gatilhos por evento com contexto departamental opcional

**Evolução do núcleo — código preparado, ativação pendente**
- [x] Catálogo Markdown inicial: diagnóstico operacional, relatório de marketing e trabalho criativo
- [x] Contratos de subagentes supervisionados com limites e cancelamento
- [x] Registro configurável de servidores MCP, allowlist e timeout
- [x] Política de navegador/comandos desabilitada por padrão
- [x] Expor sessões do owner, planos, subagentes, skills e rotinas no painel autenticado, com estados vazios honestos.
- [x] Integrar subagentes textuais isolados ao Codex sem ferramentas; ativação do worker e consumo pago permanecem pendentes.

**Etapa 2 — implementação local; implantação departamental pendente** (Plano 02)
- [x] Clientes e CS: cadastro real reutilizado; acompanhamento e combinados persistidos preparados
- [x] Comercial: funil interno e oportunidades com origem e histórico; sem CRM externo ativado
- [x] Projetos: carteira/entregáveis/tarefas compartilhados com a Central
- [ ] Financeiro: fonte Google Sheets ou sistema de cobrança
- [x] Contrato autenticado compartilhado e RPCs com autorização por escopo; tabela departamental sem acesso direto do navegador

**Limpeza do painel — concluída (13/10/2026)**
- [x] Apagar perfil "Aprovador" (`people.id = 0cfd12b8`)
- [x] Apagar "Hélio Embalagem" de `contacts` e `people`
- [x] Apagar contato `558598372658` ("Herickson maia" — número de aprovador)

---

## Atualizado em 13/10/2026 — a fazer

**Validar ao vivo (pelo WhatsApp, com o número do dono)**
- [x] PDF enviado no grupo lido e plano concluído (validado em 13/10/2026, plano #2).
- [ ] Entrada de alguém no grupo retomando o plano sozinha (com o @lid resolvido): repetir com um grupo novo.
- [ ] Aviso de entrada em grupo cadastrado: o formato do evento da Evolution foi inferido da documentação; confirmar com uma entrada real.
- [ ] Retomada de áudio pendente (dono, membro e grupo) com o Whisper local.
- [ ] Áudio de 59 s transcrito de ponta a ponta pelo Whisper local.

**Implementar**
- [ ] Obrigar o plano em pedidos com várias etapas (hoje é só instrução ao agente).
- [ ] Gatilho de arquivo ou resposta recebida no privado para planos.
- [ ] Mostrar o texto ao dono antes de enviar mensagem a terceiros, se ele quiser (hoje o envio a contato salvo sai direto).
- [ ] Envio a contato: usar o número da agenda que casa com o nome pedido (não número de pedidos antigos) e recusar número do próprio dono sem confirmação.
- [ ] Enviar ao Ítalo (•••2784) o link do grupo "Projeto Italo Teste 2" — só com o OK do dono.
- [ ] Modelo `large-v3` no PC: não está instalado e o disco C: tinha 0,3 GB livres.
- [ ] Tirar o cadastro duplicado do grupo "Projeto Ítalo" (com acento), se o dono confirmar.
- [ ] Repetir o teste de comportamento (ferramentas simuladas) sempre que o prompt ou as descrições de ferramenta mudarem.

**Ações do owner**
- [ ] Rotacionar segredos que passaram pela listagem do EasyPanel (as variáveis de todos os serviços apareceram em uma conversa).
- [ ] Decidir sobre o Whisper da VPS (modelo `base`, mais CPU ou desligar), já que a Maia usa o do PC.
- [ ] Corrigir o nome `SUPABASE_ACCESS_TOKKEN` no `.env` (a CLI do Supabase funciona com ele, mas é um erro de digitação).

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
- [x] Publicar a reorganização do painel: sete áreas, clientes e grupos de acesso; commit `d4d2180`, Vercel Production em `Ready`.
- [x] Integrar o PR #5 à `main`; GitHub confirmou `MERGED`.
- [x] Desativar a aba Conversa com Maia, redirecionar links antigos para Regras ativas e publicar `80095aa` em produção.
- [ ] Conferir visualmente o painel autenticado e exercitar um grupo de cliente autorizado.
- [ ] Reiniciar o worker sempre que o código mudar.
- [x] Conectores de operação liberados ao owner (Trello, Vercel, Miro, ClickUp, Claude Docs) em 20/10/2026: leitura livre, escrita com OK. Ver `server/operationalConnectors.ts`.
- [ ] Confirmar o prefixo do conector ClickUp quando ele aparecer (`mcp__claude_ai_ClickUp__` está só reservado) e confirmar pelo WhatsApp que o worker enxerga Trello, Vercel, Miro e Docs.
- [x] Ferramentas `github_*` criadas (20/10/2026); leitura real confirmada com o token do `.env`.
- [ ] Testar o GitHub pelo WhatsApp depois de reiniciar o worker: listar repositórios, criar um repositório privado de teste e conferir o OK em commit/PR/comentário.
- [ ] Revogar o token `github_pat_` que foi colado no chat em 20/10/2026, se ainda não foi.

**Limpeza**
- [x] Conferir o `db:drift`: 34 migrações e 788 objetos, sem divergência em 12/10/2026 antes da publicação do painel.


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
- [ ] PRs #7 (docs) e #8 (áudio sem eco) aguardam merge; depois, testes ao vivo de cofre, prospecção, citação/áudio em grupo e menção fantasma.
# Administração de acessos — implantação pendente

- Integrar as capacidades do catálogo ainda sem política efetiva (incluindo `painel.ver`) antes de permitir sua administração por linguagem natural; criar fluxo próprio para entrada com OK pontual se esse modo for necessário.
- [x] Aplicar `20261016150000_maia_member_access_modes.sql` no Supabase do projeto; tabelas, função e RLS verificadas por leitura.
- [ ] Verificar auditoria com dados de teste; o rollout e o reinício do worker já foram concluídos.
- Validar manualmente no WhatsApp owner: nome ambíguo, equipe herdada, bloqueio e aprovação pontual; confirmar no painel após leitura do banco.
- Validar operacionalmente, com autorização do owner, a corrida residual entre a checagem imediatamente anterior e a aceitação de um efeito externo; efeitos já aceitos não são reversíveis.
