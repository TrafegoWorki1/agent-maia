import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {Db} from "../store.ts";
import {metaOAuthBundle} from "../oauthConnections.ts";

const ENDPOINT=new URL("https://mcp.facebook.com/ads");

async function connectedClient(db:Db):Promise<{client:Client;transport:StreamableHTTPClientTransport}>{
 const token=(await metaOAuthBundle(db)).accessToken;
 const transport=new StreamableHTTPClientTransport(ENDPOINT,{requestInit:{headers:{Authorization:`Bearer ${token}`}}});
 const client=new Client({name:"maia-worki",version:"1.0.0"},{capabilities:{}});
 await client.connect(transport);
 return {client,transport};
}

export async function listMetaAdsMcpTools(db:Db):Promise<Array<{name:string;description?:string}>>{
 const {client,transport}=await connectedClient(db);
 try{return (await client.listTools()).tools.map(tool=>({name:tool.name,description:tool.description}));}
 finally{await client.close().catch(()=>{});await transport.close().catch(()=>{});}
}

export async function callMetaAdsMcpTool(db:Db,name:string,args:Record<string,unknown>):Promise<unknown>{
 if(!/^ads_[a-z0-9_]+$/.test(name))throw new Error("Ferramenta MCP da Meta invalida");
 const {client,transport}=await connectedClient(db);
 try{
  const result=await client.callTool({name,arguments:args});
  if(result.isError)throw new Error("O MCP da Meta recusou a consulta");
  if(result.structuredContent!==undefined)return result.structuredContent;
  return result.content;
 }finally{await client.close().catch(()=>{});await transport.close().catch(()=>{});}
}
