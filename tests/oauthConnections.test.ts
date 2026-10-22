import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {IncomingMessage} from "node:http";
import {beginOAuth,oauthCallbackUrl} from "../server/oauthConnections.ts";
import type {Db} from "../server/store.ts";

describe("OAuth do MCP oficial da Meta",()=>{
 let inserted:Record<string,unknown>|null;
 const db={from:(table:string)=>{
  expect(table).toBe("maia_oauth_states");
  return {
   delete:()=>({lt:async()=>({error:null})}),
   insert:async(row:Record<string,unknown>)=>{inserted=row;return {error:null};},
  };
 }} as unknown as Db;
 const req={headers:{host:"maia.example.com","x-forwarded-proto":"https"},socket:{}} as unknown as IncomingMessage;

 beforeEach(()=>{inserted=null;process.env.INTEGRACAO_VAULT_KEY="11".repeat(32);delete process.env.PUBLIC_APP_URL;vi.stubGlobal("fetch",async()=>new Response(JSON.stringify({client_id:"meta-dynamic-client"}),{status:201,headers:{"Content-Type":"application/json"}}));});
 afterEach(()=>{delete process.env.INTEGRACAO_VAULT_KEY;delete process.env.PUBLIC_APP_URL;vi.unstubAllGlobals();});

 it("usa callback do painel, PKCE e apenas escopos de leitura",async()=>{
  const result=await beginOAuth(db,"meta_ads","00000000-0000-0000-0000-000000000001",req);
  const url=new URL(result.authorizationUrl);
  expect(result.callbackUrl).toBe("https://maia.example.com/api/integration-connections?callback=1");
  expect(url.origin+url.pathname).toBe("https://www.facebook.com/v26.0/dialog/oauth");
  expect(url.searchParams.get("client_id")).toBe("meta-dynamic-client");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("resource")).toBe("https://mcp.facebook.com/ads");
  expect(url.searchParams.get("scope")).toContain("ads_read");
  expect(url.searchParams.get("scope")).not.toContain("ads_management");
  expect(inserted).toMatchObject({provider:"meta_ads",client_id:"meta-dynamic-client",redirect_uri:result.callbackUrl});
  expect(String(inserted?.state_hash)).toMatch(/^[a-f0-9]{64}$/);
  expect(String(inserted?.verifier_enc)).not.toContain(String(url.searchParams.get("code_challenge")));
 });

 it("prioriza PUBLIC_APP_URL para o callback publicado",()=>{
  process.env.PUBLIC_APP_URL="https://painel.worki.digital/";
  expect(oauthCallbackUrl(req)).toBe("https://painel.worki.digital/api/integration-connections?callback=1");
 });
});
