# Integração das áreas do painel

## Missões delegadas — 21/10/2026

O Núcleo inclui `MissionPanel`, com atualização a cada quinze segundos, estado, limites, avisos e recibos. `/api/nucleus` devolve missões e evidências ao owner autenticado; `mission_control` usa a revisão corrente para pausar, retomar, corrigir ou cancelar. A mesma RPC atende controles do WhatsApp. Durante requisições, os botões ficam indisponíveis e erros aparecem na tela. A migração deve preceder o código dependente. Situação de implantação em `autonomia-delegada-maia.md`; o escopo histórico abaixo corresponde à entrega anterior.

## Escopo desta entrega

Branch `feat/integrated-workspace`, base `97c6d65`. Implementação e testes locais; sem autorização nesta etapa para aplicar banco remoto, publicar, enviar mensagens ou reiniciar o worker.

## Inspeção e fontes únicas

| Área | Encontrado | Decisão |
|---|---|---|
| Central | API autenticada, carteira, tarefas, planos e capacidade reais | Reutilizar serviços e componentes |
| Projetos | Páginas departamentais estáticas | Consultar `work_projects`, `work_deliverables` e `work_tasks` da Central |
| Execução | Editor legado mistura trabalho e diagnóstico da IA | Encaminhar trabalho à Central; preservar filas, recibos e eficácia |
| Clientes/CS | Cadastro real, sem acompanhamento de combinados | Reutilizar `maia_clients`; pendências vinculadas a tarefas, nunca cópias |
| Comercial | Oportunidades/funil estáticos, sem CRM | Registro interno persistido com origem; conversão transacional em projeto |
| Marketing | Snapshots gerais exclusivos do owner | Trabalho/calendário sobre tarefas compartilhadas; snapshots separados e restritos |

## Etapas e aceite

1. Migração aditiva para oportunidades e combinados, RLS fechada, revisão e auditoria. Escritas revalidam pessoa/capacidade/escopo no banco.
2. Contrato comum para painel e ferramentas Claude/Codex. Criação de trabalho continua pelo WhatsApp; painel atualiza registros existentes.
3. Carteira, detalhe de tarefa e filtros compartilhados nas áreas. Membro não recebe acesso às páginas administrativas antigas.
4. Comercial/CS persistentes, conversão idempotente e vínculo explícito de cliente/projeto/tarefa. Sem valores financeiros implícitos.
5. Marketing como recorte das mesmas tarefas e calendário; sem simular publicação ou associar contas por nome.
6. Testes unitários, UI e Postgres temporário; regras, tipos, migrations, guard e build.

Critérios: mesmos IDs em todas as visões; nenhuma concessão por nome/cargo/texto; bloqueio individual vence herança; revisão detecta concorrência; conversão repetida não duplica projeto; histórico registra autoria/antes/depois/origem; revogação limpa dados; fontes externas não conectadas permanecem indisponíveis.

## Dependências e limites

Não instalar framework novo nem alterar SDKs de IA. Fontes externas e mapeamentos por conta/cliente exigem configuração e validação separadas. Aprovação de qualidade nunca autoriza publicação. Memória/contexto nunca autoriza acesso. Não criar modo de desenvolvimento pelo WhatsApp.

## Implantação e reversão

Aplicar somente após autorização: validar migração em banco temporário, revisar dry-run no projeto correto, aplicar antes de publicar código dependente e conferir drift. Atualizar frontend/API e, separadamente, reiniciar uma única instância do worker. Reversão de código preserva registros e auditoria; não usar DROP/reset. Esquema posterior exige migração compensatória autorizada.

## Código implementado e exemplos

- A entrada do owner agora é Meu dia; links legados continuam válidos. Projetos e Implementações usam a mesma carteira e o mesmo detalhe de tarefa da Central. `?project=<id>` abre o recorte de um projeto; `?task=<id>` abre o detalhe da tarefa quando ela pertence à lista autorizada.
- Comercial usa oportunidades internas (prospecção, qualificada, proposta, negociação, ganha, perdida, cancelada). O funil filtra a mesma população. Ganha exige conversão em projeto; conversão repetida/concorrente retorna o mesmo projeto e não repete a criação. Perda exige motivo.
- CS usa combinados/retornos (pendente, em execução, aguardando, concluído, cancelado), com próxima ação, prazo opcional, classificação da espera e evidência. Referência a tarefa é um vínculo, não uma cópia. Não conclui combinado com tarefa vinculada ainda aberta nem conclui a tarefa automaticamente.
- Marketing usa `area` explícita das tarefas e calendário de prazos; não infere cliente nem publicação. Observações `marketing.*`, `content.*` e `traffic.*` conservam origem/período/tentativa/sucesso. Snapshot geral da Meta permanece em uma aba exclusiva do owner, sem redistribuição aos clientes.
- Financeiro lê as observações persistidas e o catálogo autorizados. Corrigida leitura com concessão herdada por cliente. Sem métrica de despesas catalogada, a tela informa a ausência; não inventa valores nem soma moedas/períodos diferentes.
- Operação da Maia preserva filas criativas retomáveis, lembretes, recibos e eficácia. O outro editor de tarefas foi removido; trabalho abre na Central.
- Meu dia também aponta para os combinados e próximas ações comerciais atribuídos. A criação de tarefa/combinado/oportunidade continua pela Maia no WhatsApp; o painel atualiza registros existentes. O editor de carteira existente foi reaproveitado, não substituído.

Exemplos após implantação: “Consulte meus combinados com o cliente cadastrado”; “Registre uma oportunidade para esse cliente, sob minha responsabilidade, com próxima ação de revisar a proposta”; “Atualize o retorno usando a revisão atual”; “Converta a oportunidade qualificada em projeto”. A Maia deve consultar IDs com `trabalho_contexto` e esclarecer ambiguidade. Não há frase obrigatória nem promoção de identidade pelo texto.

`area_registro_salvar` e `oportunidade_converter` entram pelo catálogo `workTools` nos dois executores. A política emite permit de uso único vinculado a número/execução/ferramenta/payload; a ferramenta consome e recarrega a identidade. A RPC revalida capacidade/escopo e revisão. Novos registros sem chave explícita recebem chave determinística baseada na execução/payload. Esses dois fluxos novos exigem competência vigente e recusam o modo aprovação pontual, em vez de confirmar um OK que a transação não possa cumprir. Aprovações existentes de tarefas/ações externas não foram ampliadas.

## Matriz de permissões

| Operação | Capacidade | Escopo adicional |
|---|---|---|
| Entrar no painel | `painel.ver` | Login vinculado a pessoa ativa |
| Consultar áreas e registros | `trabalho.ver` | Atribuição, papel explícito cliente/projeto ou coordenação da equipe |
| Atualizar combinado/oportunidade | `trabalho.atualizar` | Próprio registro ou responsabilidade/coordenação explícita; revisão atual |
| Criar registro pelo WhatsApp | `tarefas.criar` | Cliente conhecido e autorizado; criar para outro exige competência de redistribuição e escopo destino |
| Redistribuir registro existente | `trabalho.redistribuir` | Escopo de origem e destino; pessoa cadastrada e equipe autorizada |
| Converter em projeto | `trabalho.planejar` | Gestão da carteira no mesmo cliente; etapa qualificada/proposta/negociação |
| Ver indicadores | `indicadores.ver` | População de registros autorizados; bloqueio individual vence herança |
| Ver financeiro | `financeiro.ver` | Papel financeiro com cliente/projeto explícito; nenhum dado de outro cliente |
| Administrar cadastro global/acessos/conexões/snapshots | Owner autenticado | Não liberado por associação operacional |

Membro de equipe não recebe leitura de todos os clientes da equipe. Revisor/aprovador não recebe administração. A versão de cache inclui a pessoa, além de permissões e escopos. Dados/formulários departamentais são descartados ao receber 401/403; troca de escopo remonta os editores. Polling/reconexão reutilizam o mecanismo da Central, que descarta respostas antigas.

## Catálogo de indicadores acrescentados

| Código | Fórmula / população | Unidade | Cobertura e detalhe |
|---|---|---|---|
| `commercial.open` | Contagem de oportunidades não encerradas | registros | IDs das oportunidades abertas autorizadas |
| `commercial.win_rate` | ganhas / (ganhas + perdidas) × 100 | % | IDs do denominador; sem encerradas = indisponível; não confundir com conversão por etapa |
| `cs.open` | Contagem de combinados não encerrados | registros | IDs dos combinados abertos autorizados |
| `cs.overdue` | Contagem de próximas ações abertas com prazo anterior à leitura | registros | População com prazo, incluindo não vencidas; sem prazos = indisponível; ausentes ficam fora |

Todos usam `work_department_records`, período de estado atual na leitura, meta não configurada e população completa sem truncamento. Cálculo puro em `src/lib/departmentMetrics.ts` compartilhado pelo backend e recortes do frontend; metadados também entram no catálogo persistido. O detalhe de cada KPI lista os registros. Não há ranking de produtividade. Métricas antigas sem fonte continuam indisponíveis, não foram convertidas artificialmente em zero.

## Evidências locais

Ambiente: Supabase JS 2.117.3, React 19.3.0, Zod 4.6.5, sem troca de framework/SDK. Revisão de Supabase/Postgres orientou RLS fechada, revogação de EXECUTE, índices e operações transacionais; revisão React orientou reutilização de componentes, carregamento sob demanda e descarte de estado ao trocar escopo. Referências: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) e [RPC JS](https://supabase.com/docs/reference/javascript/rpc).

- `pnpm rules:check`: documento e catálogo correspondem; catálogo de regras não foi alterado.
- `pnpm typecheck`: aprovado.
- `pnpm test`: 566 testes Vitest e 75 testes de Postgres temporário aprovados.
- `pnpm db:validate`: 50 migrations reconstruídas do zero; estruturas essenciais/uso pelo código conferidos.
- `pnpm db:guard`: uma migration nova; nenhuma migration existente alterada.
- `pnpm build`: aprovado; páginas sob demanda e entrada abaixo do aviso de chunk de 500 kB.
- `git diff --check`: aprovado.

Novos testes: `departmentWork.test.ts`, `departmentWorkspace.test.ts`, `departmentTools.test.ts` e suíte departamental em `tests/db/migrations.nodetest.ts`. Cobrem: visibilidade da carteira/tarefas nas áreas; edição com revisão capturada; limpeza do formulário após revogação; escrita cruzada WhatsApp/API/painel em banco temporário; herança de cliente e bloqueio individual; coordenador limitado; conversão concorrente/idempotente; vínculo cliente/projeto/tarefa; tentativa de criação manual; conclusão de CS sem concluir tarefa aberta; roles públicas sem acesso a tabela/RPC; financeiro herdado isolado e KPI com 1005 registros. O teste da ferramenta confere que o schema MCP não adiciona defaults nem normaliza o payload antes de consumir o permit, e que a chave de criação se mantém entre chamadas repetidas na mesma execução. Testes legados do editor foram atualizados para verificar sua remoção deliberada, preservando verificação de filas/recibos/incerteza.

## Limites e validação operacional pendente

- Esta entrega não cria CRM externo, coletor financeiro ou mapeamento de conta publicitária por cliente. São dependências externas/configurações autorizadas, não telas ativas por existir um menu.
- O calendário de Marketing é de trabalho/prazo, não um agendador de publicações. Não foi implementado nem alegado um coletor novo de confirmação de publicação por peça.
- Não foram adicionados cadastro de prospect sem cliente real, valores comerciais, SLA automático ou indicador inferido de saúde do cliente. Oportunidades usam clientes/prospects previamente cadastrados pelo fluxo administrativo existente.
- O painel não cria trabalho manualmente; cria/edita carteira conforme a competência existente. Nenhuma regra gerada foi editada e nenhuma mudança de regra foi ativada.
- Interface validada em testes DOM; inspeção visual autenticada em desktop/celular e homologação com logins reais ainda são necessárias. Os testes não provam qualidade semântica de respostas do modelo nem disponibilidade de conectores.
- Migration `20261016180722` aplicada ao projeto Supabase `Agent Maia`; ledger local/remoto confirmado. Código integrado pelo [PR #23](https://github.com/TrafegoWorki1/agent-maia/pull/23), squash `5c504d4`, com checks aprovados. `pnpm db:drift` ainda não validado: a Management API respondeu HTTP 401. Publicação de produção e reinício do worker exigem conferência separada. A evolução visual seguinte está implementada/testada localmente e não exige migration ou atualização do worker; evidências no changelog. Nenhuma mensagem, publicação, imagem real ou chamada paga foi usada para simular sucesso.

## Procedimento de implantação após autorização

1. Migration já aplicada no projeto Supabase `Agent Maia`; dry-run e histórico confirmaram somente a versão `20261016180722` pendente. A comparação `pnpm db:drift` precisa ser repetida após corrigir a credencial da Management API (HTTP 401).
2. Integração departamental já enviada e integrada pelo PR #23. Para a evolução visual posterior, publicar o frontend após revisão da branch e CI.
3. Após o merge, atualizar o checkout do worker, encerrar a instância anterior e iniciar **uma** instância com `pnpm start` ou `Iniciar Maia.bat`. Não iniciar dois workers para conferir.
4. Homologar com contas de teste: membro, coordenação, cliente, revisão e financeiro. Não usar publicação/mensagem real como teste automático.

Reversão: voltar frontend/API/worker à versão anterior e manter tabela, projetos convertidos e auditoria. Conversão já confirmada não é desfeita automaticamente; cancelamento impede somente próximos efeitos. Qualquer ajuste estrutural posterior requer migration compensatória revisada.
