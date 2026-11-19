import type { FastifyReply } from 'fastify';
import ExcelJS from 'exceljs';

/** Plain text of any Excel cell (numbers, rich text, formulas, links). */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((r) => r.text).join('').trim();
    if ('result' in value) return value.result === undefined ? '' : String(value.result).trim();
    if ('text' in value) return String(value.text).trim();
    return '';
  }
  return String(value).trim();
}

export interface SheetColumn {
  header: string;
  key: string;
  width?: number;
}

/** Adds a sheet with a bold, frozen header row. */
export function addSheet(wb: ExcelJS.Workbook, name: string, columns: SheetColumn[], rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16 }));
  ws.getRow(1).font = { bold: true };
  ws.addRows(rows);
  return ws;
}

export async function sendWorkbook(reply: FastifyReply, wb: ExcelJS.Workbook, filename: string) {
  const buffer = await wb.xlsx.writeBuffer();
  return reply
    .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .header('content-disposition', `attachment; filename="${filename}"`)
    .send(Buffer.from(buffer));
}
