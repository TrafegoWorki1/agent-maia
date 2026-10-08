// Manual do operador da Maia. Fonte única: o painel exibe este conteúdo na página Operação.

export const MANUAL_SECTIONS: { title: string; items: string[] }[] = [
  {
    title: "Objetivo",
    items: [
      "A Maia responde pedidos operacionais pelo WhatsApp e pelo painel, usando as conexões do claude.ai (Gmail, Meta Ads, Drive/Sheets, Agenda e outras).",
      "Ela só altera dados reais depois de aprovação do aprovador, por ação. Leituras rodam direto.",
    ],
  },
  {
    title: "Autonomia e autorização",
    items: [
      "Leitura: a Maia executa diretamente, sem aprovação.",
      "Escrita (enviar, editar, alterar, apagar, publicar): pede SIM ou NÃO ao aprovador pelo WhatsApp. A aprovação vale só para aquela ação e expira em 10 minutos sem resposta.",
      "Pelo painel, a conversa é só de leitura. Pedidos de escrita feitos pelo painel são recusados e precisam ser feitos pelo WhatsApp.",
      "Mensagens de outros números não são respondidas nem têm o texto guardado.",
    ],
  },
  {
    title: "Quem pode falar com a Maia",
    items: [
      "Conversa: o número do dono (Herickson Maia).",
      "Aprovação de escrita: o número aprovador, apenas com SIM ou NÃO.",
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
