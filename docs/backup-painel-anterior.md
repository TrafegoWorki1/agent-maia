# Backup do painel anterior
Referência preservada antes do painel gerencial: commit 2af93da47a52cf2e642d0379ff2c9676cc274d5f.
Branch remota: backup/painel-antes-gestao-20261020.
Tag remota: painel-antes-gestao-20261020.
Arquivo local: ../agent-maia/scratch/backups/painel-20261020/painel-main.zip.
Também foram preservados o patch local e os documentos da auditoria/plano. Credenciais e dados de negócio não fazem parte do arquivo.
## Restaurar o código
Criar uma branch a partir da tag e revisar a diferença com a main atual. Para restaurar em produção, publicar essa referência no mesmo projeto e confirmar o destino antes de promover. As migrações do painel são aditivas e não removem o histórico operacional; não executar reset do banco. Alterações de ambiente e fontes têm reversão própria, documentada na entrega.
O backup não é uma cópia dos dados do Supabase; esta mudança não apaga registros de negócio.

## Publicação da nova versão
PR #31 integrado em 8a0f1c9 e publicado. As migrações aditivas foram aplicadas antes do deploy; 2.064 objetos comparados sem divergência. O backup anterior continua disponível no GitHub. A coleta usa a tarefa Windows Maia-Painel-Coletor e o worktree maia-gerencial; para retornar somente ao painel antigo, revisar também a configuração dessa coleta. O checkout original agent-maia e suas alterações locais foram preservados.
