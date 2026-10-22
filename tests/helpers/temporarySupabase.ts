import type { LocalDb } from "../../scripts/db/local.ts";
import type { Db } from "../../server/store.ts";

// PostgREST-shaped adapter over the temporary Postgres. Production auth and services are never contacted.
export function temporarySupabase(local:LocalDb):Db{
 const quote=(name:string)=>{if(!/^[a-z_][a-z0-9_]*$/.test(name))throw new Error("Invalid test identifier");return '"'+name+'"';};
 const execute=async(sql:string,values:unknown[])=>{try{return {data:(await local.db.query<Record<string,unknown>>(sql,values)).rows,error:null};}catch(error){return {data:null,error:{message:error instanceof Error?error.message:String(error)}};}};
 return {
  from(table:string){
   let columns="*",order="",offset=0,limit:number|undefined,single=false;
   let mutation: "insert" | "update" | "delete" | null=null, payload:Record<string,unknown>|null=null, conflict="";
   const filters:string[]=[],values:unknown[]=[];
   const predicate=(column:string,value:unknown,operator="=")=>{values.push(value);filters.push(quote(column)+" "+operator+" $"+values.length);return query;};
   const query={
    select(value="*"){columns=value;return query;},
    insert(value:Record<string,unknown>){mutation="insert";payload=value;return query;},
    upsert(value:Record<string,unknown>,options:{onConflict:string;ignoreDuplicates?:boolean}){mutation="insert";payload=value;conflict=" on conflict ("+options.onConflict.split(",").map(quote).join(",")+") do nothing";return query;},
    update(value:Record<string,unknown>){mutation="update";payload=value;return query;},
    delete(){mutation="delete";return query;},
    eq(column:string,value:unknown){return predicate(column,value);},
    neq(column:string,value:unknown){return predicate(column,value,"<>");},
    lt(column:string,value:unknown){return predicate(column,value,"<");},
    lte(column:string,value:unknown){return predicate(column,value,"<=");},
    gte(column:string,value:unknown){return predicate(column,value,">=");},
    is(column:string,value:null){if(value!==null)throw new Error("Only NULL supported");filters.push(quote(column)+" is null");return query;},
    in(column:string,items:unknown[]){if(!items.length){filters.push("false");return query;}const placeholders=items.map(value=>{values.push(value);return "$"+values.length;});filters.push(quote(column)+" in ("+placeholders.join(",")+")");return query;},
    order(column:string,options?:{ascending?:boolean}){order=" order by "+quote(column)+(options?.ascending===false?" desc":" asc");return query;},
    range(from:number,to:number){offset=from;limit=to-from+1;return query;},
    limit(value:number){limit=value;return query;},
    maybeSingle(){single=true;return run();},
    single(){single=true;return run();},
    then(resolve:(result:unknown)=>unknown,reject:(reason:unknown)=>unknown){return run().then(resolve,reject);},
   };
   async function run(){
    const nested=columns.includes("work_teams!inner");
    const projection=nested?"*":columns==="*"?"*":columns.split(",").map(quote).join(",");
    const where=filters.length?" where "+filters.join(" and "):"";
    const bindings=[...values];
    const entries=Object.entries(payload??{}), slots=entries.map(([,value])=>{bindings.push(typeof value==="object"&&value!==null?JSON.stringify(value):value);return "$"+bindings.length;});
    const sql=mutation==="insert"?"insert into public."+quote(table)+" ("+entries.map(([key])=>quote(key)).join(",")+") values ("+slots.join(",")+")"+conflict+" returning "+projection
     :mutation==="update"?"update public."+quote(table)+" set "+entries.map(([key],i)=>quote(key)+"="+slots[i]).join(",")+where+" returning "+projection
     :mutation==="delete"?"delete from public."+quote(table)+where+" returning "+projection
     :"select "+projection+" from public."+quote(table)+where+order+(limit!==undefined?" limit "+limit:"")+(offset?" offset "+offset:"");
    const result=await execute(sql,bindings);
    if(nested&&result.data){const teams=await local.db.query<Record<string,unknown>>("select id,name,active from work_teams");result.data=result.data.flatMap(row=>{const team=teams.rows.find(team=>team.id===row.team_id);return team?[{...row,work_teams:team}]:[];});}
    return {...result,data:single?result.data?.[0]??null:result.data};
   }
   return query;
  },
  async rpc(name:string,input:Record<string,unknown>){
   const entries=Object.entries(input),values=entries.map(([,value])=>typeof value==="object"&&value!==null&&!Array.isArray(value)?JSON.stringify(value):value);
   const result=await execute("select * from public."+quote(name)+"("+entries.map(([key],index)=>quote(key)+" => $"+(index+1)).join(",")+")",values);
   const row=result.data?.[0];
   return {...result,data:row&&Object.hasOwn(row,name)?row[name]:row??null};
  },
 } as unknown as Db;
}
