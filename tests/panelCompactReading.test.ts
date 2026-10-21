import {it,expect} from "vitest";
import {collaborationView} from "../server/collaborativeWork";
import type {PanelIdentity} from "../server/panelIdentity";
import type {Db} from "../server/store";
it("a API original preserva o histórico completo e a leitura do painel não consulta esse histórico",async()=>{
 const calls:string[]=[],queries:Array<{table:string;filters:string[]}> =[];
 const db={from(table:string){calls.push(table);const filters:string[]=[],q:any={};queries.push({table,filters});for(const name of ["select","order","eq","in","gte","lte","or"])q[name]=(...args:unknown[])=>{if(!["select","order"].includes(name))filters.push(name+":"+args.join("|"));return q;};q.range=()=>Promise.resolve({data:table==="work_task_history"?[{id:1,work_task_id:42}]:table==="work_tasks"?[{id:42,workflow_status:"pending",priority:2}]:[],error:null});return q;}} as unknown as Db;
 const identity={owner:true,personId:"owner",name:"Dono",authUserId:null,directPermissions:new Set(),permissionModes:new Map(),groupPermissions:[],teams:[],roles:[]} as PanelIdentity;
 const original=await collaborationView(db,identity,new Date("2026-10-20T15:00:00Z"));expect(original.history).toEqual([{id:1,work_task_id:42}]);calls.length=0;queries.length=0;
 const compact=await collaborationView(db,identity,new Date("2026-10-20T15:00:00Z"),"panel",{start:"2026-10-01",end:"2026-10-20"});expect(compact.history).toEqual([]);expect(calls).not.toContain("work_task_history");expect(compact.tasks).toEqual(original.tasks);expect(queries.find(q=>q.table==="work_task_reviews")?.filters[0]).toContain("or:and(created_at.gte.2026-10-01");expect(queries.find(q=>q.table==="work_portfolio_history")?.filters).toEqual(["gte:at|2026-10-01T00:00:00-03:00","lte:at|2026-10-20T23:59:59.999-03:00"]);
});
it("preserva a primeira revisão anterior ao período sem carregar revisões antigas de outras tarefas",async()=>{
 const ids:number[][]=[];
 const old={id:1,work_task_id:42,outcome:"returned",created_at:"2026-10-10T15:00:00Z"},current={id:2,work_task_id:42,outcome:"approved",created_at:"2026-10-20T12:00:00Z"};
 const db={from(table:string){let period=false,selected:number[]|null=null;const q:any={};for(const name of ["select","order","eq","gte","lte"])q[name]=()=>q;q.or=()=>{period=true;return q;};q.in=(_column:string,values:number[])=>{selected=values;ids.push(values);return q;};q.range=()=>Promise.resolve({data:table==="work_tasks"?[{id:42,area:"design",workflow_status:"completed",completed_at:"2026-10-20T12:00:00Z",priority:2}]:table==="work_task_reviews"?period?[current,{id:3,work_task_id:999,outcome:"approved",created_at:current.created_at}]:selected?[old,current]:[old,current]:[],error:null});return q;}} as unknown as Db;
 const identity={owner:true,personId:"owner",name:"Dono",authUserId:null,directPermissions:new Set(),permissionModes:new Map(),groupPermissions:[],teams:[],roles:[]} as PanelIdentity,now=new Date("2026-10-20T15:00:00Z");
 const original=await collaborationView(db,identity,now),compact=await collaborationView(db,identity,now,"panel",{start:"2026-10-19",end:"2026-10-25"});
 expect(compact.metrics.find(m=>m.code==="creative.first_review")).toEqual(original.metrics.find(m=>m.code==="creative.first_review"));expect(compact.metrics.find(m=>m.code==="creative.first_review")?.value).toBe(0);expect(ids).toEqual([[42]]);expect(compact.reviews.map(r=>r.id).sort()).toEqual([1,2]);
});
