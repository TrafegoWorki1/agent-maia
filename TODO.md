# Pendências atuais da Maia

Atualizado em 10/10/2026. Comportamento aprovado: [regras vigentes](docs/regras-da-maia.md). Entregas anteriores e seus resultados estão no [changelog](CHANGELOG.md).

## Validações operacionais

- [ ] Conferir uma conversa real após o alinhamento: consulta, aprovação, áudio e continuidade de contexto. Os testes automatizados não substituem avaliação semântica das respostas.
- [ ] Validar pelo WhatsApp o fluxo de membro autorizado com texto, áudio e imagem, usando contatos autorizados pelo owner.
- [ ] Fazer inspeção visual autenticada do painel; na revisão anterior o navegador estava indisponível.
- [ ] Avaliar relevância e resolução em amostra humana de pedidos reais; as metas do plano de eficácia ainda não são resultados comprovados.

## Melhorias que continuam pendentes

- [ ] Vincular a aprovação persistida à impressão digital de parâmetros e revisar a revalidação de permissões durante a espera.
- [ ] Definir escopo de memória por cliente antes de incluir documentos de clientes. A busca atual é só documental do projeto.
- [ ] Decidir eventual prazo de retenção de `messages`; hoje não há exclusão automática por idade.
- [ ] Investigar o bundle do painel acima de 500 kB, mantendo a verificação funcional.

## Fora do escopo aprovado

- Prospecção autônoma, escalonamento automático para grupos e ações em massa.
- DMs/InMail do LinkedIn, DMs frias e comentários avulsos fora das automações aprovadas do Instagram.
- Integração Kommo e novos formatos/recursos sociais que não estejam nas ferramentas.

Permissões por pessoa, áudio pelo Whisper, grupos cadastrados, cota de imagens, tarefas/lembretes e integração Zernio já existem. Não tratá-los como funcionalidades futuras por causa dos planos históricos.

Os novos recursos do Instagram são uma implementação paralela do owner no Claude: a política deste alinhamento já contempla as consultas, respostas elegíveis no Direct e automações com aprovação. Sua disponibilidade depende da entrega das ferramentas no executor usado e da conexão Zernio.
