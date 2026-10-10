// Manual do operador da Maia. Fonte única: o painel exibe este conteúdo na página Operação.

export const MANUAL_SECTIONS: { title: string; items: string[] }[] = [
  {
    title: "Objetivo",
    items: [
      "A Maia é a assistente operacional da Worki Digital. Ajuda o Herickson no dia a dia pelo WhatsApp e pelo painel: tarefas, grupos, campanhas, planilhas, e-mails, agenda, artes e Instagram.",
      "Usa as conexões do claude.ai (Gmail, Meta Ads, Drive/Sheets, Agenda e outras) e as ferramentas próprias (artes, base de conhecimento, Instagram pela Zernio), sempre com dados reais.",
      "Precisão: confere o resultado na fonte antes de dizer que está feito (grupo na lista, post lido de volta, arte com confirmação de envio).",
      "Proatividade: avisa riscos e oportunidades (conexão com erro, aprovação parada, gasto fora do esperado) e sugere o próximo passo.",
      "Leituras rodam direto. Ações públicas ou de risco, como publicar em redes sociais e responder no Direct, pedem aprovação do owner ou do aprovador; outras ações seguem permissões por pessoa e as regras do servidor.",
      "Se pedirem algo que ela não faz, avisa o Herickson.",
    ],
  },
  {
    title: "Autonomia e autorização",
    items: [
      "Leitura: a Maia executa diretamente, sem aprovação.",
      "Publicações, anúncios, resposta no Direct e mudanças em automações de comentário para DM pedem OK ou NÃO ao owner ou aprovador pelo WhatsApp. A aprovação vale para aquela ação e expira em 10 minutos. As demais ações seguem as permissões cadastradas e os bloqueios do servidor.",
      "Pelo painel, a conversa é só de leitura. Pedidos de escrita feitos pelo painel são recusados e precisam ser feitos pelo WhatsApp.",
      "O owner sempre pode conversar no privado. Membros cadastrados podem conversar no privado quando têm a permissão conversa.maia; as ferramentas disponíveis continuam limitadas pelas permissões individuais.",
    ],
  },
  {
    title: "Quem pode falar com a Maia",
    items: [
      "Conversa: o número do dono (Herickson Maia) e membros cadastrados com a permissão conversa.maia.",
      "Aprovação de escrita: o número aprovador, apenas com OK (ou SIM) ou NÃO.",
    ],
  },
  {
    title: "Se a Maia parar",
    items: [
      "Feche a janela da Maia, se ainda estiver aberta, e clique em Iniciar Maia.bat.",
      "Confira em Conexões e dados: WhatsApp em 'Ativo', webhook 'recebendo' e as fontes sem 'Com erro'.",
      "Se alguma fonte estiver com erro, reconecte o conector no claude.ai e clique em Atualizar fontes.",
      "Tarefas marcadas como 'incerta' foram interrompidas por um reinício. Revise antes de pedir de novo: nada é reexecutado automaticamente.",
      "Se uma conexão pedir confirmação no celular, a Maia avisa e aguarda.",
    ],
  },
  {
    title: "Avisos da Maia",
    items: [
      "Resumo diário no WhatsApp do dono, no horário configurado (padrão 8h, Brasília).",
      "Alerta quando uma conexão cai, e aviso quando ela volta.",
      "Lembrete quando uma aprovação fica parada por mais de 8 minutos.",
    ],
  },
];
