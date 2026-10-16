import { DepartmentWorkspace } from "./DepartmentWorkspace";
import { FinanceWorkspace } from "./FinanceWorkspace";

export function OportunidadesPage(){return <DepartmentWorkspace mode="opportunities"/>;}
export function FunilPage(){return <DepartmentWorkspace mode="funnel"/>;}
export function ProjetosListaPage(){return <DepartmentWorkspace mode="projects"/>;}
export function ImplementacoesPage(){return <DepartmentWorkspace mode="implementations"/>;}

// Não existe coletor financeiro configurado: não confundir cadastro verbal com conexão.
export function ReceitasPage(){return <FinanceWorkspace kind="receipts"/>;}
export function CustosPage(){return <FinanceWorkspace kind="costs"/>;}
