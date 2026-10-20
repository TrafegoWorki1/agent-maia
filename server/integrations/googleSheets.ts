import { getAccessToken } from "./googleDrive.ts";

// Cliente do Google Sheets API v4 via REST, com o mesmo token OAuth do owner usado pelo Drive (escopo drive).
// Só o que as ferramentas `sheets_*` expõem: ler, escrever valores, criar planilha, adicionar, inserir e apagar coluna e aba.
// Fora de propósito: scripts (Apps Script), que exigem outro escopo e não são liberados aqui.

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const TIMEOUT_MS = 20_000;
const ID = /^[A-Za-z0-9_-]{20,100}$/;

export const SHEET_LIMITS = { maxRows: 1000, maxCols: 26, maxCells: 20_000, maxCellChars: 1000 };

export class SheetsError extends Error {}

export function parseSpreadsheetId(raw: string): string {
  const fromUrl = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(raw)?.[1];
  const id = (fromUrl ?? raw).trim();
  if (!ID.test(id)) throw new SheetsError("ID de planilha inválido: envie o ID ou o link da planilha.");
  return id;
}

export function colIndex(letters: string): number {
  if (!/^[A-Za-z]{1,3}$/.test(letters)) throw new SheetsError("Coluna inválida: use a letra, como C.");
  return [...letters.toUpperCase()].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
}

export function a1(tab: string, range?: string): string {
  const quoted = `'${tab.replace(/'/g, "''")}'`;
  return range ? `${quoted}!${range}` : quoted;
}

async function call<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* resposta sem JSON */ }
  if (!res.ok) {
    if (res.status === 404) throw new SheetsError("planilha não encontrada (confira o ID ou se a conta do owner tem acesso a ela)");
    if (res.status === 403) throw new SheetsError("a conta do owner não tem permissão para esta planilha");
    const message = (data as { error?: { message?: unknown } } | null)?.error?.message;
    throw new SheetsError(`Google Sheets respondeu ${res.status}${message ? `: ${String(message).slice(0, 200)}` : ""}`);
  }
  return data as T;
}

interface RawSheet { properties?: { sheetId?: number; title?: string; gridProperties?: { rowCount?: number; columnCount?: number } } }
interface RawSpreadsheet { spreadsheetId: string; spreadsheetUrl?: string; properties?: { title?: string }; sheets?: RawSheet[] }

export interface SheetTab { sheetId: number; titulo: string; linhas: number; colunas: number }

function toTab(s: RawSheet): SheetTab {
  return { sheetId: s.properties?.sheetId ?? -1, titulo: s.properties?.title ?? "", linhas: s.properties?.gridProperties?.rowCount ?? 0, colunas: s.properties?.gridProperties?.columnCount ?? 0 };
}

export async function getSpreadsheet(id: string) {
  const data = await call<RawSpreadsheet>("GET", `/${id}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))`);
  return { id: data.spreadsheetId, titulo: data.properties?.title ?? "", url: data.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}`, abas: (data.sheets ?? []).map(toTab) };
}

export function resolveTab(abas: SheetTab[], aba?: string): SheetTab {
  if (!abas.length) throw new SheetsError("a planilha não tem abas");
  if (!aba) return abas[0];
  const tab = abas.find((t) => t.titulo === aba);
  if (!tab) throw new SheetsError(`aba "${aba}" não encontrada (abas: ${abas.map((t) => t.titulo).join(", ")})`);
  return tab;
}

export async function readValues(id: string, aba?: string, intervalo?: string) {
  const sheet = await getSpreadsheet(id);
  const tab = resolveTab(sheet.abas, aba);
  const range = encodeURIComponent(a1(tab.titulo, intervalo));
  const data = await call<{ values?: string[][] }>("GET", `/${id}/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`);
  return { planilha: sheet.titulo, aba: tab.titulo, valores: data.values ?? [] };
}

// USER_ENTERED: fórmulas (=SOMA(...)) são calculadas como numa planilha digitada. Não cria scripts.
export async function writeValues(id: string, aba: string | undefined, inicio: string | undefined, valores: Array<Array<string | number | boolean>>) {
  const sheet = await getSpreadsheet(id);
  const tab = resolveTab(sheet.abas, aba);
  const range = a1(tab.titulo, inicio ?? "A1");
  const data = await call<{ updatedRange?: string; updatedCells?: number }>("PUT", `/${id}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { range, majorDimension: "ROWS", values: valores });
  return { planilha: sheet.titulo, intervaloAtualizado: data.updatedRange ?? range, celulas: data.updatedCells ?? 0 };
}

export async function createSpreadsheet(titulo: string, abas?: string[]) {
  const data = await call<RawSpreadsheet>("POST", "", {
    properties: { title: titulo },
    sheets: (abas?.length ? abas : ["Planilha1"]).map((t) => ({ properties: { title: t } })),
  });
  return { id: data.spreadsheetId, titulo, url: data.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}` };
}

async function batchUpdate(id: string, requests: unknown[]) {
  await call<unknown>("POST", `/${id}:batchUpdate`, { requests });
}

export async function addTab(id: string, titulo: string) {
  await batchUpdate(id, [{ addSheet: { properties: { title: titulo } } }]);
  return { planilha: id, aba: titulo };
}

export async function insertColumns(id: string, aba: string | undefined, coluna: string, quantidade = 1) {
  const sheet = await getSpreadsheet(id);
  const tab = resolveTab(sheet.abas, aba);
  const start = colIndex(coluna);
  await batchUpdate(id, [{ insertDimension: { range: { sheetId: tab.sheetId, dimension: "COLUMNS", startIndex: start, endIndex: start + quantidade }, inheritFromBefore: start > 0 } }]);
  return { planilha: sheet.titulo, aba: tab.titulo, colunasInseridas: quantidade, a_partir_de: coluna.toUpperCase() };
}

export async function deleteColumns(id: string, aba: string | undefined, coluna: string, quantidade = 1) {
  const sheet = await getSpreadsheet(id);
  const tab = resolveTab(sheet.abas, aba);
  const start = colIndex(coluna);
  await batchUpdate(id, [{ deleteDimension: { range: { sheetId: tab.sheetId, dimension: "COLUMNS", startIndex: start, endIndex: start + quantidade } } }]);
  return { planilha: sheet.titulo, aba: tab.titulo, colunasApagadas: quantidade, a_partir_de: coluna.toUpperCase() };
}

export async function deleteTab(id: string, aba: string) {
  const sheet = await getSpreadsheet(id);
  const tab = resolveTab(sheet.abas, aba);
  await batchUpdate(id, [{ deleteSheet: { sheetId: tab.sheetId } }]);
  return { planilha: sheet.titulo, abaApagada: tab.titulo };
}
