import {useEffect,useState,type FormEvent} from "react";
import {PageHeader,Panel} from "../../components/ui";
import {panelSourcesRequest} from "../../lib/panelSourcesApi";
import {PANEL_METRICS,type PanelSourceConfig,type PanelSourceView} from "../../lib/panelSourceModel";
import {useCollaboration} from "../collaboration/CollaborationPage";
const empty=()=>({name:"",metric_code:"finance.received",source_ref:"",range_ref:"Dados!A1:F5001",mapping:{key:"id",date:"data",value:"valor"},unit:"BRL",basis:"Caixa; data do pagamento",coverage:"",client_id:"",project_id:"",active:false} as unknown as PanelSourceConfig);
const when=(value:string|null|undefined)=>value?new Date(value).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}):"Sem registro";
export function PanelSourcesPage(){
 const {data}=useCollaboration(),[sources,setSources]=useState<PanelSourceView[]>([]),[config,setConfig]=useState(empty),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 async function load(){try{setSources((await panelSourcesRequest()).sources);setError("");}catch(e){setSources([]);setError(e instanceof Error?e.message:"Falha na consulta");}}
 useEffect(()=>{void load();},[]);
 function field(key:keyof PanelSourceConfig,value:unknown){setConfig(c=>({...c,[key]:value}));}
 async function save(e:FormEvent){e.preventDefault();setBusy(true);setError("");setNotice("");try{await panelSourcesRequest({action:"save",config,id:config.id??null,revision:config.revision??null});setNotice("Configuração salva. Uma coleta só lê a fonte; não altera dados na planilha.");setConfig(empty());await load();}catch(e){setError(e instanceof Error?e.message:"Falha ao salvar");}finally{setBusy(false);}}
 async function collect(id:string){setBusy(true);setNotice("");try{const value=await panelSourcesRequest({action:"collect",id});setNotice(value.result?.error??(value.result?.started?"Coleta concluída.":"Fonte pausada ou coleta em andamento."));await load();}catch(e){setError(e instanceof Error?e.message:"Falha na coleta");}finally{setBusy(false);}}
 if(data&&!data.identity.owner)return <p role="alert">Configuração exclusiva do proprietário.</p>;
 return <><PageHeader eyebrow="Administração" title="Fontes gerenciais" subtitle="Fontes explícitas, histórico e coleta de leitura. Estes dados não mudam regras nem instruções da Maia." action={<button className="button button-outline" disabled={busy} onClick={()=>void load()}>Atualizar leitura</button>}/>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 <Panel title="Fontes cadastradas" caption="Uma fonte por planilha, intervalo e métrica. Falhas preservam o último lote válido; mudar a configuração inicia uma nova revisão, sem reutilizar resultados antigos.">
 {!sources.length?<p>Nenhuma fonte configurada. Escolha a planilha e informe abaixo como os dados devem ser interpretados.</p>:<div className="table-wrap"><table><thead><tr><th>Fonte / métrica</th><th>Estado</th><th>Última tentativa</th><th>Último sucesso</th><th>Cobertura e diagnóstico</th><th>Ações</th></tr></thead><tbody>{sources.map(s=><tr key={s.id}><td>{s.name}<small className="organization-cell-note">{PANEL_METRICS[s.metric_code].label} · {s.unit} · revisão {s.revision}</small></td><td>{!s.active?"Pausada":s.latest?.status==="running"?"Coletando":s.latest?.status==="error"?"Falha":s.success?Date.now()-Date.parse(s.success.completed_at!)>3600000?"Desatualizada":"Atualizada":"Sem coleta"}</td><td>{when(s.latest?.started_at)}</td><td>{when(s.success?.completed_at)}</td><td>{s.latest?.error??s.coverage}<small className="organization-cell-note">{s.basis} · {s.success?.observations.length??"Sem"} registros</small><details><summary>Histórico recente</summary>{s.history?.map(r=><p key={r.id}>Revisão {r.config_revision} · {when(r.started_at)} · {r.status==="ok"?"Sucesso":r.status==="running"?"Em curso":"Falha"} {r.error??""}</p>)}</details></td><td><button disabled={busy} onClick={()=>setConfig({...s})}>Editar</button> <button disabled={busy||!s.active} onClick={()=>void collect(s.id)}>Coletar</button></td></tr>)}</tbody></table></div>}
 </Panel>
 <Panel title={config.id?"Editar fonte":"Cadastrar fonte"} caption="Google Sheets via OAuth do servidor. A primeira linha do intervalo contém o cabeçalho; cada registro precisa de ID único, data e valor numérico. Nenhuma linha é escrita na planilha.">
 <form className="management-filters" onSubmit={save}>
 <label>Nome<input required maxLength={120} value={config.name} onChange={e=>field("name",e.target.value)}/></label>
 <label>Métrica<select value={config.metric_code} onChange={e=>{field("metric_code",e.target.value);field("unit",PANEL_METRICS[e.target.value as keyof typeof PANEL_METRICS].unit);}}>{Object.entries(PANEL_METRICS).map(([code,m])=><option key={code} value={code}>{m.label}</option>)}</select></label>
 <label>Link ou ID da planilha<input required value={config.source_ref} onChange={e=>field("source_ref",e.target.value)}/></label>
 <label>Intervalo com cabeçalho<input required value={config.range_ref} onChange={e=>field("range_ref",e.target.value)}/></label>
 {(["key","date","value"] as const).map((key,i)=><label key={key}>{["Coluna do identificador","Coluna da data","Coluna do valor"][i]}<input required maxLength={80} value={config.mapping[key]} onChange={e=>field("mapping",{...config.mapping,[key]:e.target.value})}/></label>)}
 <label>Unidade<select value={config.unit} onChange={e=>field("unit",e.target.value)}>{["BRL","USD","EUR","count"].map(u=><option key={u} value={u}>{u==="count"?"Quantidade":u}</option>)}</select></label>
 <label>Cliente<select value={config.client_id??""} onChange={e=>{field("client_id",e.target.value);field("project_id","");}}><option value="">Agência / sem cliente</option>{data?.clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 <label>Projeto<select value={config.project_id??""} onChange={e=>field("project_id",e.target.value)}><option value="">Sem projeto</option>{data?.projects.filter(p=>p.client_id===config.client_id).map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.name)}</option>)}</select></label>
 <label>Regime, objetivo e atribuição<input required maxLength={250} value={config.basis} onChange={e=>field("basis",e.target.value)}/></label>
 <label>Cobertura e limites<input required maxLength={500} value={config.coverage} onChange={e=>field("coverage",e.target.value)} placeholder="O que a fonte inclui e o que fica de fora"/></label>
 <label>Coleta<select value={config.active?"active":"paused"} onChange={e=>field("active",e.target.value==="active")}><option value="paused">Pausada</option><option value="active">Ativa</option></select></label>
 <button className="button button-dark" disabled={busy} type="submit">Salvar configuração</button>{config.id&&<button type="button" className="button button-outline" onClick={()=>setConfig(empty())}>Cancelar edição</button>}
 </form><p>O saldo vencido é uma fotografia por dia: cada título aparece uma vez por data, com ID composto único. Os demais indicadores somam movimentos do período. Margem e ROAS exigem cobertura e atribuição completas e não são inferidos.</p>
 </Panel></>;
}
