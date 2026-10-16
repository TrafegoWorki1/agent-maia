# Inventário de ferramentas e decisões de acesso

Inventário operacional do código. A decisão efetiva fica em `server/access.ts`, `server/approvalPolicy.ts`, `server/resourceAccess.ts` e nas validações específicas de cada fluxo. Ferramenta não mapeada é bloqueada; a tabela não concede acesso.

| tool_name | read_or_write | risk | required_permission | owner_only | approval_required | resource_scope | channel_scope |
|---|---|---|---|---|---|---|---|
| `mcp__claude_ai_Gmail__get/list/search/read/download*` | read | medium | `gmail.ler` | no | if capability is absent | mailbox | Claude |
| `mcp__claude_ai_Meta_ADS__ads_get/insights/library/experiment*` | read | medium | `meta.ler` | no | if capability is absent | account/client | Claude |
| `mcp__claude_ai_Google_Calendar__get/list/search*` | read | medium | `agenda.ler` | no | if capability is absent | calendar | Claude |
| `mcp__claude_ai_Google_Drive__get/read/download*` | read | high | `sheets.ler` + resource grant | no | grant may require approval | file/folder/client/project | Claude |
| `mcp__claude_ai_Google_Drive__search/list*` without resource ID | read | high | none sufficient | no | no | denied | Claude |
| `mcp__claude_ai_Google_Drive__share_file` | write | high | managed wrapper | no | yes | exact permission/resource | blocked until provider exists |
| `mcp__claude_ai_Meta_ADS__ads_create/update/activate/boost/delete*` | write | high | `escrita.pedir` | no | yes | account/client | Claude/WhatsApp |
| `mcp__claude_ai_instamany__send_message/set_flow_status` | write | high | `escrita.pedir` | no | yes | conversation/flow | Claude/WhatsApp |
| `mcp__maia__buscar_conhecimento`, `contato_buscar`, `artes_recentes` | read | low | explicit internal read | no | no | requester context | Claude/Codex |
| `mcp__maia__instagram_*` and `linkedin_*` consultations | read | medium | explicit internal read | varies | no | connected account | Claude/Codex |
| `mcp__maia__instagram_publicar/direct_responder/automacao_*`, `linkedin_publicar/post_*` | write | high | `escrita.pedir` | no | yes | exact account/content | WhatsApp |
| `mcp__maia__tarefas_listar`, `trabalho_contexto` | read | medium | `trabalho.ver` | no | policy mode | team/client/project | WhatsApp/panel |
| `mcp__maia__tarefa_criar/atualizar`, `area_registro_salvar`, `oportunidade_converter` | write | medium | work capability | no | policy-dependent | task/team/client/project | WhatsApp |
| `mcp__maia__membro_acesso_localizar/consultar/definir` | read/write | high | authenticated owner | yes | no | exact person/capability | private WhatsApp |
| `mcp__maia__grupo_*`, `contato_enviar_mensagem` | read/write | medium/high | `mensagem.enviar` for writes | varies | unregistered group/risk/limits | group/contact | WhatsApp |
| `mcp__maia__integracao_*` | read/write | high | `integracao.usar` or owner | varies | external call/activation | exact integration | private WhatsApp |
| `mcp__maia__plano_*`, `planos_ativos`, `operacao_resumo`, `arquivo_reenviar` | read/write | medium | owner | yes | operation-specific | owner operation | private WhatsApp |
| `Read/Grep/Glob` | read | high | path policy | project owner; member media only | no | allowed roots, secrets denied | executor |
| `ToolSearch/TodoWrite` | internal | low | explicit builtin | no | no | execution | executor |
| any unlisted read or write | any | unknown | none | no | no | denied | all |

Os nomes locais registrados nos executores Claude e Codex são cobertos pelas famílias acima e pelas listas explícitas nos módulos de ferramentas. Conectores dinâmicos permanecem limitados por prefixo, operação e allowlist do executor.
