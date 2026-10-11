# Pendências atuais da Maia

Atualizado em 10/10/2026. Comportamento aprovado: [regras vigentes](docs/regras-da-maia.md). Entregas anteriores e seus resultados estão no [changelog](CHANGELOG.md).

## Validações operacionais

- [ ] Aplicar `20261011005800_maia_owner_preferences_v1.sql` pelo workflow aprovado de produção, validar o schema e só então publicar o código que depende dela.
- [ ] Após a implantação, testar pelo WhatsApp uma proposta, confirmação literal, expiração e uma preferência restritiva; confirmar que nenhuma preferência altera permissões ou ações externas.
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

As ferramentas Instagram agora estão disponíveis nos executores Claude e Codex. Validação autenticada da interface e dos fluxos externos segue pendente; áudio pode exigir reconexão Facebook Login. Não testar envio real sem um cenário de teste autorizado.
