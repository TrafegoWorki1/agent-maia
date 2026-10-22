import {createHash, randomBytes} from "node:crypto";
import type {IncomingMessage} from "node:http";
import type {Db} from "./store.ts";
import {decryptSecret, encryptSecret, readSecret, storeSecret, deleteSecret} from "./vault.ts";

export type OAuthProvider="meta_ads";
const META_SECRET="INTEGRACAO_META_MCP_OAUTH";
const META_RESOURCE="https://mcp.facebook.com/ads";
const META_AUTHORIZE="https://www.facebook.com/v26.0/dialog/oauth";
const META_TOKEN="https://graph.facebook.com/v26.0/oauth/access_token";
const META_SCOPES=["ads_read","business_management","ads_mcp_management"];

interface MetaOAuthBundle{accessToken:string;refreshToken?:string;expiresAt:number;clientId:string;scope:string[]}
interface OAuthStateRow{provider:OAuthProvider;verifier_enc:string;redirect_uri:string;client_id:string|null;owner_person_id:string;expires_at:string}

function base64url(value:Buffer):string{return value.toString("base64url");}
function sha256(value:string):string{return createHash("sha256").update(value).digest("hex");}
function challenge(value:string):string{return base64url(createHash("sha256").update(value).digest());}
function publicBase(req:IncomingMessage):string{
 const configured=process.env.PUBLIC_APP_URL?.trim().replace(/\/$/,"");
 if(configured)return configured;
 const host=req.headers.host;
 if(!host||!/^[a-z0-9.:[\]-]+$/i.test(host))throw new Error("PUBLIC_APP_URL ausente e Host invalido");
 const forwarded=Array.isArray(req.headers["x-forwarded-proto"])?req.headers["x-forwarded-proto"][0]:req.headers["x-forwarded-proto"];
 const protocol=(forwarded?.split(",")[0].trim()||((req.socket as {encrypted?:boolean}).encrypted?"https":"http"));
 if(protocol!=="http"&&protocol!=="https")throw new Error("Protocolo publico invalido");
 return `${protocol}://${host}`;
}
export function oauthCallbackUrl(req:IncomingMessage):string{return new URL("/api/integration-connections?callback=1",publicBase(req)).toString();}

export async function beginOAuth(db:Db,provider:OAuthProvider,ownerPersonId:string,req:IncomingMessage):Promise<{authorizationUrl:string;callbackUrl:string}>{
 const callbackUrl=oauthCallbackUrl(req),state=base64url(randomBytes(32)),verifier=base64url(randomBytes(48));
 const verifierEnc=encryptSecret(verifier);
 if(!verifierEnc)throw new Error("Falta INTEGRACAO_VAULT_KEY valida para proteger o login");
 const clientId=process.env.META_MCP_CLIENT_ID?.trim();
 if(!clientId)throw new Error("Falta META_MCP_CLIENT_ID: crie um app no Meta for Developers e configure o ID do app no servidor");
 await db.from("maia_oauth_states").delete().lt("expires_at",new Date().toISOString());
 const stored=await db.from("maia_oauth_states").insert({state_hash:sha256(state),provider,verifier_enc:verifierEnc,redirect_uri:callbackUrl,client_id:clientId,owner_person_id:ownerPersonId});
 if(stored.error)throw new Error("Nao consegui guardar o estado seguro do login");
 const url=new URL(META_AUTHORIZE);
 for(const [key,value] of Object.entries({response_type:"code",client_id:clientId,redirect_uri:callbackUrl,scope:META_SCOPES.join(" "),state,code_challenge:challenge(verifier),code_challenge_method:"S256"}))url.searchParams.set(key,value);
 url.searchParams.set("resource",META_RESOURCE);
 return {authorizationUrl:url.toString(),callbackUrl};
}

async function consumeState(db:Db,state:string):Promise<OAuthStateRow>{
 if(!/^[A-Za-z0-9_-]{30,100}$/.test(state))throw new Error("Estado OAuth invalido");
 const result=await db.from("maia_oauth_states").select("provider,verifier_enc,redirect_uri,client_id,owner_person_id,expires_at").eq("state_hash",sha256(state)).maybeSingle();
 await db.from("maia_oauth_states").delete().eq("state_hash",sha256(state));
 if(result.error||!result.data)throw new Error("Login expirado ou nao iniciado pela Maia");
 const row=result.data as OAuthStateRow;
 if(Date.parse(row.expires_at)<=Date.now())throw new Error("Login expirado; inicie novamente pelo painel");
 return row;
}

async function tokenRequest(url:string,body:URLSearchParams):Promise<Record<string,unknown>>{
 const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Accept":"application/json"},body,signal:AbortSignal.timeout(20_000)});
 const raw=await response.json().catch(()=>({})) as Record<string,unknown>;
 if(!response.ok||typeof raw.access_token!=="string")throw new Error(`Troca do codigo OAuth falhou (HTTP ${response.status})${raw.error_description||raw.error?`: ${String(raw.error_description??raw.error).slice(0,160)}`:""}`);
 return raw;
}

export async function finishOAuth(db:Db,state:string,code:string):Promise<OAuthProvider>{
 if(!code||code.length>3000)throw new Error("Codigo OAuth ausente ou invalido");
 const saved=await consumeState(db,state),verifier=decryptSecret(saved.verifier_enc);
 if(!verifier)throw new Error("Nao consegui abrir o estado seguro do login");
 const raw=await tokenRequest(META_TOKEN,new URLSearchParams({grant_type:"authorization_code",code,client_id:saved.client_id??"",redirect_uri:saved.redirect_uri,code_verifier:verifier,resource:META_RESOURCE}));
 const bundle:MetaOAuthBundle={accessToken:String(raw.access_token),refreshToken:typeof raw.refresh_token==="string"?raw.refresh_token:undefined,expiresAt:Date.now()+Math.max(60,Number(raw.expires_in??3600))*1000,clientId:saved.client_id??"",scope:typeof raw.scope==="string"?raw.scope.split(/[ ,]+/).filter(Boolean):META_SCOPES};
 const stored=await storeSecret(db,META_SECRET,JSON.stringify(bundle));if(!stored.ok)throw new Error(stored.error);
 return saved.provider;
}

export async function connectionStatus(db:Db):Promise<Record<OAuthProvider,{connected:boolean;detail:string}>>{
 const meta=await readSecret(db,META_SECRET);
 let metaValid=false;
 if(meta)try{const parsed=JSON.parse(meta) as Partial<MetaOAuthBundle>;metaValid=Boolean(parsed.accessToken&&parsed.clientId);}catch{}
 return {meta_ads:{connected:metaValid,detail:metaValid?"Meta Ads conectado pelo MCP oficial":"Entre com o Facebook e escolha a conta empresarial"}};
}

export async function disconnectOAuth(db:Db,_provider:OAuthProvider):Promise<void>{await deleteSecret(db,META_SECRET);}

export async function metaOAuthBundle(db:Db):Promise<MetaOAuthBundle>{
 const encoded=await readSecret(db,META_SECRET);if(!encoded)throw new Error("Meta Ads nao conectado; use Conexoes no painel da Maia");
 let bundle:MetaOAuthBundle;try{bundle=JSON.parse(encoded) as MetaOAuthBundle;}catch{throw new Error("Credencial MCP da Meta invalida; conecte novamente");}
 if(!bundle.accessToken||!bundle.clientId)throw new Error("Credencial MCP da Meta incompleta; conecte novamente");
 if(bundle.expiresAt>Date.now()+60_000)return bundle;
 if(!bundle.refreshToken)throw new Error("Sessao da Meta expirou; conecte novamente pelo painel");
 const raw=await tokenRequest(META_TOKEN,new URLSearchParams({grant_type:"refresh_token",refresh_token:bundle.refreshToken,client_id:bundle.clientId,resource:META_RESOURCE}));
 bundle={...bundle,accessToken:String(raw.access_token),refreshToken:typeof raw.refresh_token==="string"?raw.refresh_token:bundle.refreshToken,expiresAt:Date.now()+Math.max(60,Number(raw.expires_in??3600))*1000};
 const stored=await storeSecret(db,META_SECRET,JSON.stringify(bundle));if(!stored.ok)throw new Error(stored.error);
 return bundle;
}
