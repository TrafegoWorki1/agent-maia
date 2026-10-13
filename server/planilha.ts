import { mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const MIDIA_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "midia");

export type PlanilhaAba = {
  nome: string;
  cabecalhos: string[];
  linhas: (string | number | null)[][];
};

export type PlanilhaInput = {
  titulo: string;
  abas: PlanilhaAba[];
};

// Converte valor bruto para o tipo correto do ExcelJS
function parseCellValue(raw: string | number | null): unknown {
  if (raw === null || raw === "") return null;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && raw.startsWith("=")) return { formula: raw.slice(1) };
  // Data ISO: 2026-10-13 ou 2026-10-13T...
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
  }
  return raw;
}

// Detecta pelo nome do cabeçalho se a coluna é data, moeda ou percentual
function colHints(cabecalhos: string[]): { date: Set<number>; currency: Set<number>; percent: Set<number> } {
  const date = new Set<number>();
  const currency = new Set<number>();
  const percent = new Set<number>();
  cabecalhos.forEach((h, i) => {
    const l = h.toLowerCase();
    if (l.includes("data") || l.includes("prazo") || l.includes("início") || l.includes("inicio") || l.includes("nascimento")) date.add(i);
    if (l.includes("valor") || l.includes("r$") || l.includes("custo") || l.includes("total") || l.includes("receita") || l.includes("fixo") || l.includes("comissão") || l.includes("salário")) currency.add(i);
    if (l.includes("%") || l.includes("percent") || l.includes("taxa")) percent.add(i);
  });
  return { date, currency, percent };
}

export async function criarPlanilha(input: PlanilhaInput): Promise<{ ok: true; path: string; fileName: string } | { ok: false; error: string }> {
  try {
    const ExcelJS = (await import("exceljs")).default ?? (await import("exceljs"));
    const wb = new ExcelJS.Workbook();
    wb.creator = "Maia";
    wb.created = new Date();

    const HEADER_BG = "FF1A1A2E";   // azul escuro
    const HEADER_FG = "FFFFFFFF";   // branco
    const ROW_ALT    = "FFF0F4FF";  // azul muito claro
    const BORDER_CLR = "FFD0D0D0";

    for (const aba of input.abas) {
      const ws = wb.addWorksheet(aba.nome.slice(0, 31));
      ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1, activeCell: "A2" }];

      // Linha de cabeçalho
      const headerRow = ws.addRow(aba.cabecalhos);
      headerRow.height = 22;
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: HEADER_FG }, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
      });

      const hints = colHints(aba.cabecalhos);

      // Linhas de dados
      aba.linhas.forEach((rowData, ri) => {
        const values = rowData.map(parseCellValue);
        const row = ws.addRow(values);
        row.height = 18;

        if (ri % 2 === 1) {
          row.eachCell({ includeEmpty: true }, (cell, _col) => {
            if (!cell.fill || (cell.fill as { pattern?: string }).pattern === "none") {
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ROW_ALT } };
            }
          });
        }

        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
          const idx = colNumber - 1;
          if (cell.value instanceof Date) {
            cell.numFmt = "DD/MM/YYYY";
          } else if (typeof cell.value === "number") {
            if (hints.currency.has(idx)) {
              cell.numFmt = '"R$"\\ #,##0.00';
            } else if (hints.percent.has(idx)) {
              cell.numFmt = "0.00%";
            } else if (!Number.isInteger(cell.value)) {
              cell.numFmt = "#,##0.00";
            }
          }
          cell.alignment = { vertical: "middle" };
        });
      });

      // Largura automática das colunas
      ws.columns.forEach((col, i) => {
        let max = (aba.cabecalhos[i] ?? "").length + 4;
        for (const rowData of aba.linhas) {
          const v = rowData[i];
          if (v !== null && v !== undefined) {
            const len = String(v).length + 2;
            if (len > max) max = len;
          }
        }
        col.width = Math.min(Math.max(max, 10), 55);
      });

      // Bordas em toda a tabela usada
      const lastRow = ws.lastRow?.number ?? 1;
      const lastCol = aba.cabecalhos.length;
      for (let r = 1; r <= lastRow; r++) {
        for (let c = 1; c <= lastCol; c++) {
          ws.getCell(r, c).border = {
            top:    { style: "thin", color: { argb: BORDER_CLR } },
            left:   { style: "thin", color: { argb: BORDER_CLR } },
            bottom: { style: "thin", color: { argb: BORDER_CLR } },
            right:  { style: "thin", color: { argb: BORDER_CLR } },
          };
        }
      }
    }

    mkdirSync(MIDIA_ROOT, { recursive: true });
    const slug = input.titulo.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, "_").slice(0, 60) || "planilha";
    const fileName = `${slug}.xlsx`;
    const filePath = join(MIDIA_ROOT, fileName);

    // Se já existir arquivo com mesmo nome, adiciona sufixo aleatório
    const finalPath = existsSync(filePath)
      ? join(MIDIA_ROOT, `${slug}_${randomBytes(3).toString("hex")}.xlsx`)
      : filePath;
    const finalName = finalPath.split(/[\\/]/).pop() ?? fileName;

    await wb.xlsx.writeFile(finalPath);
    return { ok: true, path: finalPath, fileName: finalName };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
