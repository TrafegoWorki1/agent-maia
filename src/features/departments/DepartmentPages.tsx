import { PageHeader, Panel } from "../../components/ui";

// Departamentos novos (Etapa 0): estados honestos enquanto a fonte não está configurada.
// Nenhum dado simulado ou placeholder numérico — só "Não conectado" quando não há fonte.

export function OportunidadesPage() {
  return (
    <>
      <PageHeader eyebrow="Comercial" title="Oportunidades" subtitle="Negociações e leads ativos. A fonte de oportunidades precisa ser definida antes de aparecer aqui." />
      <Panel title="Fonte de oportunidades" caption="Como conectar">
        <p className="empty-note">
          Nenhuma fonte de CRM ou planilha de oportunidades configurada. Quando a Maia registrar
          uma oportunidade ou você conectar uma planilha, os dados aparecem aqui — com fonte,
          janela e data de atualização identificados.
        </p>
      </Panel>
    </>
  );
}

export function FunilPage() {
  return (
    <>
      <PageHeader eyebrow="Comercial" title="Funil" subtitle="Etapas do funil comercial: prospecção, proposta, negociação, fechamento." />
      <Panel title="Funil comercial" caption="Dados por etapa">
        <p className="empty-note">
          Sem dados de funil disponíveis. O funil é construído a partir das oportunidades
          registradas pela Maia ou importadas de uma planilha conectada.
        </p>
      </Panel>
    </>
  );
}

export function ProjetosListaPage() {
  return (
    <>
      <PageHeader eyebrow="Projetos" title="Projetos" subtitle="Projetos ativos e concluídos. Criados via Maia ou cadastro no sistema." />
      <Panel title="Projetos cadastrados" caption="Lista de projetos">
        <p className="empty-note">
          Nenhum projeto cadastrado ainda. Projetos nascem de pedidos à Maia ou de
          oportunidades convertidas no Comercial; eles aparecem aqui quando registrados.
        </p>
      </Panel>
    </>
  );
}

export function ImplementacoesPage() {
  return (
    <>
      <PageHeader eyebrow="Projetos" title="Implementações" subtitle="Entregas técnicas e marcos de cada projeto." />
      <Panel title="Implementações em andamento" caption="Por projeto">
        <p className="empty-note">
          Nenhuma implementação em andamento. Quando um projeto tiver marcos registrados,
          eles aparecem aqui com progresso, responsável e prazo.
        </p>
      </Panel>
    </>
  );
}

export function ReceitasPage() {
  return (
    <>
      <PageHeader eyebrow="Financeiro" title="Receitas" subtitle="Entradas financeiras por período. Requer uma fonte conectada." />
      <Panel title="Fonte de receitas" caption="Não conectado">
        <p className="empty-note">
          Sem fonte financeira configurada. Para ver receitas, conecte uma planilha do
          Google Sheets ou sistema de cobrança e informe à Maia no WhatsApp. Nenhum dado
          é inventado — o painel só exibe o que a fonte confirma.
        </p>
      </Panel>
    </>
  );
}

export function CustosPage() {
  return (
    <>
      <PageHeader eyebrow="Financeiro" title="Custos e despesas" subtitle="Saídas financeiras por categoria e período." />
      <Panel title="Fonte de custos" caption="Não conectado">
        <p className="empty-note">
          Sem fonte de custos configurada. Conecte uma planilha ou informe à Maia para
          que despesas apareçam aqui com categoria, valor e data identificados.
        </p>
      </Panel>
    </>
  );
}
