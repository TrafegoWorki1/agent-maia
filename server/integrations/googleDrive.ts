// Cliente do Google Drive API v3 via REST direto (sem SDK pesado).
// Auth: OAuth2 com refresh token pessoal do owner.
// Variáveis de ambiente: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN.

import { createReadStream, statSync } from "node:fs";
import { basename } from "node:path";

// Limite de arquivo que a Maia aceita baixar do Drive para mandar no WhatsApp (25 MB).
// A Evolution envia por base64: arquivos maiores congestionam a fila.
export const DRIVE_DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;

// Limite de arquivo que a Maia aceita subir ao Drive (100 MB).
export const DRIVE_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

let _token: { value: string; expiresAt: number } | null = null;

function driveEnv(): { clientId: string; clientSecret: string; refreshToken: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google Drive não configurado: defina GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET e GOOGLE_OAUTH_REFRESH_TOKEN no .env");
  }
  return { clientId, clientSecret, refreshToken };
}

export async function getAccessToken(): Promise<string> {
  if (_token && _token.expiresAt > Date.now() + 60_000) return _token.value;
  const { clientId, clientSecret, refreshToken } = driveEnv();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google OAuth: HTTP ${res.status}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Google OAuth: sem access_token na resposta");
  _token = { value: json.access_token, expiresAt: Date.now() + (Number(json.expires_in ?? 3600) * 1000) };
  return _token.value;
}

export interface DriveFileInfo {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  webViewLink?: string;
}

export async function getDriveFileInfo(fileId: string): Promise<DriveFileInfo> {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,webViewLink`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) throw new Error("arquivo não encontrado no Drive (verifique o ID ou se está compartilhado com esta conta)");
  if (!res.ok) throw new Error(`Drive API: HTTP ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  return {
    id: String(json.id),
    name: String(json.name ?? "arquivo"),
    mimeType: String(json.mimeType ?? "application/octet-stream"),
    size: Number(json.size ?? 0),
    webViewLink: typeof json.webViewLink === "string" ? json.webViewLink : undefined,
  };
}

// Extrai o fileId de uma URL do Drive (drive.google.com/file/d/ID/... ou ?id=ID) ou devolve o valor bruto.
export function parseDriveId(input: string): string {
  const m = input.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  const u = input.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (u) return u[1];
  return input.trim();
}

// Baixa o conteúdo do arquivo (não-Google Workspace) como Buffer.
export async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(120_000),
  });
  if (res.status === 404) throw new Error("arquivo não encontrado no Drive");
  if (!res.ok) throw new Error(`Drive download: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > DRIVE_DOWNLOAD_MAX_BYTES) throw new Error(`arquivo (${Math.round(buf.length / 1024 / 1024)} MB) passa do limite de ${Math.round(DRIVE_DOWNLOAD_MAX_BYTES / 1024 / 1024)} MB para envio no WhatsApp`);
  return buf;
}

export interface DriveUploadResult {
  id: string;
  name: string;
  webViewLink: string;
}

// Faz upload multipart de um arquivo local para o Drive.
export async function uploadToDrive(localPath: string, options: { name?: string; folderId?: string; mimeType?: string } = {}): Promise<DriveUploadResult> {
  const token = await getAccessToken();
  const size = statSync(localPath).size;
  if (size > DRIVE_UPLOAD_MAX_BYTES) throw new Error(`arquivo (${Math.round(size / 1024 / 1024)} MB) passa do limite de ${Math.round(DRIVE_UPLOAD_MAX_BYTES / 1024 / 1024)} MB`);
  const fileName = options.name ?? basename(localPath);
  const mimeType = options.mimeType ?? guessMime(localPath);

  // Metadados do arquivo
  const meta: Record<string, unknown> = { name: fileName, mimeType };
  if (options.folderId) meta.parents = [options.folderId];

  // Upload multipart com boundary
  const boundary = `maia_drive_${Date.now()}`;
  const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`;
  const filePart = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;

  const { readFileSync } = await import("node:fs");
  const fileBytes = readFileSync(localPath);
  const body = Buffer.concat([
    Buffer.from(metaPart),
    Buffer.from(filePart),
    fileBytes,
    Buffer.from(closing),
  ]);

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`Drive upload: HTTP ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  if (!json.id) throw new Error("Drive upload: sem ID no retorno");
  return {
    id: String(json.id),
    name: String(json.name ?? fileName),
    webViewLink: String(json.webViewLink ?? `https://drive.google.com/file/d/${json.id}/view`),
  };
}

function guessMime(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    pdf: "application/pdf",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    mp3: "audio/mpeg", ogg: "audio/ogg", m4a: "audio/mp4",
  };
  return map[ext ?? ""] ?? "application/octet-stream";
}
