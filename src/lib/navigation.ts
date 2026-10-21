export const sections = [
 {id:"gestao",label:"Gestão",icon:"home",pages:[{id:"panorama",label:"Panorama da operação"},{id:"coordenacao",label:"Coordenação"},{id:"direcao",label:"Direção e equipes"},{id:"planejamento",label:"Planejamento"},{id:"metricas",label:"Indicadores"}]},
 {id:"trabalho",label:"Meu trabalho",icon:"work",pages:[{id:"meu-dia",label:"Meu dia"},{id:"minha-equipe",label:"Minha equipe"}]},
 {id:"comercial",label:"Comercial",icon:"comercial",pages:[{id:"oportunidades",label:"Oportunidades"},{id:"funil",label:"Funil"},{id:"vendas",label:"Resultados de vendas"}]},
 {id:"projetos",label:"Projetos e entregas",icon:"projetos",pages:[{id:"projetos-lista",label:"Projetos"},{id:"implementacoes",label:"Entregáveis e implementações"}]},
 {id:"marketing",label:"Marketing",icon:"marketing",pages:[{id:"trabalho-marketing",label:"Produção e calendário"},{id:"campanhas",label:"Resultados de campanhas"}]},
 {id:"clientes-cs",label:"Clientes e CS",icon:"groups",pages:[{id:"acompanhamento",label:"Combinados e retornos"},{id:"grupos",label:"Grupos do WhatsApp"}]},
 {id:"financeiro",label:"Financeiro",icon:"financeiro",pages:[{id:"receitas",label:"Receitas e previsões"},{id:"custos",label:"Custos e despesas"}]},
 {id:"execucao",label:"Operação da Maia",icon:"execution",pages:[{id:"resumo",label:"Saúde da operação"},{id:"indicadores",label:"Qualidade da IA"},{id:"tarefas",label:"Filas e entregas"},{id:"ocorrencias",label:"Ocorrências"},{id:"modelos",label:"Execução e custos"},{id:"insights",label:"Estatísticas de conversa"},{id:"tom",label:"Estilo das mensagens"}]},
 {id:"administracao",label:"Administração",icon:"access",pages:[{id:"pessoas",label:"Pessoas e acessos"},{id:"grupos-acesso",label:"Grupos de acesso"},{id:"clientes",label:"Cadastro de clientes"},{id:"conexoes",label:"Conexões e fontes"},{id:"dados",label:"Fontes gerenciais"},{id:"regras",label:"Regras da Maia"},{id:"memoria",label:"Memória e combinados"},{id:"nucleo",label:"Núcleo e automações"},{id:"manual",label:"Continuidade e backup"}]}
] as const;
export type SectionId=typeof sections[number]["id"];
export type ScreenId=typeof sections[number]["pages"][number]["id"];
export interface PanelRoute{section:SectionId;screen:ScreenId}
export function routeHash(route:PanelRoute){return `#${route.section}/${route.screen}`;}
const legacySections:Record<string,string[]> = {
 trabalho:["meu-dia","minha-equipe","coordenacao","direcao","planejamento","metricas"],
 "visao-geral":["resumo","indicadores"],marketing:["trabalho-marketing","campanhas","vendas","insights","tom"],
 execucao:["tarefas","ocorrencias"],comercial:["oportunidades","funil"],projetos:["projetos-lista","implementacoes"],
 "clientes-cs":["acompanhamento","clientes","grupos"],financeiro:["receitas","custos"],acessos:["pessoas","grupos-acesso"],
 "agente-maia":["regras","memoria","nucleo","manual"],sistema:["conexoes","modelos"],"grupos-clientes":["grupos","clientes"]
};
function target(hash:string){
 const raw=hash.replace(/^#/,"").split("?")[0];
 if(raw==="operacao")return "manual";
 if(raw==="agente"||raw==="agente-maia/agente")return "regras";
 if(raw==="grupos-clientes")return "clientes";
 const [section,screen]=raw.split("/");
 if(screen&&legacySections[section]?.includes(screen))return screen;
 return raw;
}
export function parseRoute(hash:string,access:boolean|readonly string[]=true):PanelRoute{
 const owner=access===true,screens=new Set(Array.isArray(access)?access:[]);
 const allowed=(id:string)=>owner||screens.has(id)||(typeof access==="boolean"&&!access&&id==="pessoas");
 const value=target(hash);
 for(const section of sections){
  for(const page of section.pages){
   if(allowed(page.id)&&(value===page.id||value===`${section.id}/${page.id}`))return {section:section.id,screen:page.id};
  }
  if(value===section.id){const first=section.pages.find(page=>allowed(page.id));if(first)return{section:section.id,screen:first.id};}
 }
 // Entradas antigas de seção continuam apontando à primeira tela autorizada daquela área.
 const old=legacySections[value];
 if(old)for(const id of old)if(allowed(id))for(const section of sections)for(const page of section.pages)if(page.id===id)return {section:section.id,screen:page.id};
 if(owner)return{section:"gestao",screen:"panorama"};
 for(const section of sections)for(const page of section.pages)if(page.id==="meu-dia"&&allowed(page.id))return{section:section.id,screen:page.id};
 for(const section of sections)for(const page of section.pages)if(allowed(page.id))return{section:section.id,screen:page.id};
 return{section:"administracao",screen:"pessoas"};
}
export function canonicalRouteHash(hash:string,access:boolean|readonly string[]=true){
 const route=parseRoute(hash,access),query=hash.split("?")[1];
 const requested=target(hash),same=requested===route.screen||requested===`${route.section}/${route.screen}`;
 return routeHash(route)+(same&&query?"?"+query:"");
}
