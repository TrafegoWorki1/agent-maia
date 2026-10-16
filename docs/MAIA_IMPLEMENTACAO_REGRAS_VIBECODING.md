# Implementação das regras de vibecoding da Maia

Fonte solicitante: `MAIA_IMPLEMENTACAO_REGRAS_VIBECODING.md`. Este documento registra a execução; a fonte normativa continua sendo `config/maia-rules.json`.

## Etapas e decisões

1. Centralizar o limite em `config/ai-routing.json`, preservando 30 passos por ser o valor efetivamente usado pelos dois executores Claude. O Codex não oferece limite nativo de turnos no SDK instalado; o limite é aplicado às chamadas MCP observáveis.
2. Fechar leituras sem política explícita e acrescentar autorização por pessoa + recurso + capacidade. `sheets.ler` passa a ser requisito base, não autorização global de Drive.
3. Bloquear o `share_file` direto, pois o conector não fornece ao backend um contrato que garanta o registro do `permissionId`. O serviço gerenciado persiste e confere criação/revogação usando um provider injetado; nenhuma conexão é anunciada como ativa sem configuração real.
4. Encerrar planos ativos após sete dias com atualização condicional, motivo, última etapa e aviso único ao owner. A retomada exige novo pedido.
5. Configurar retenção de mensagens brutas do owner em 90 dias, sem apagar memória durável, auditoria ou recibos junto com elas. O worker grava métricas e usa a rotina antiga em modo compatível até a migration existir.
6. Gerar os três documentos humanos a partir do catálogo normativo e manter inventário de ferramentas/permissões.

## Dependências

- Migration `20261016223848_maia_vibecoding_access_retention.sql`.
- Um provider real de permissões do Google Drive para habilitar o wrapper gerenciado de compartilhamento. Sem ele, compartilhamento permanece bloqueado.
- Worker com acesso `service_role`; nenhuma credencial vai para o frontend.

## Critérios de aceite

- Leituras desconhecidas são negadas; Drive de membro exige recurso autorizado.
- Negação específica vence pasta/grupo; expiração e remoção de grupo são revalidadas.
- Aprovações existentes continuam vinculadas ao payload, expiram em dez minutos e são de uso único.
- Planos vencidos não retomam e notificam uma vez.
- Retenção é configurada, mensurada e não remove memória durável.
- Documentos gerados, typecheck, testes, validação do banco e build passam.

## Implantação e reversão

1. Aplicar a migration na ordem do diretório e executar `pnpm db:validate` e `pnpm rules:verify`.
2. Publicar o commit integrado e reiniciar somente o worker da Maia.
3. Conferir logs de retenção, alertas de planos e uma consulta de Drive negada/permitida em ambiente controlado.
4. Para reversão, voltar o código ao commit anterior. Preservar as tabelas de autorização e auditoria; uma remoção física deve ser feita apenas por migration compensatória após exportação.

Nenhum teste chama WhatsApp, Google Drive, redes sociais ou serviço pago real.
