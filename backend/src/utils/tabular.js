import ExcelJS from 'exceljs';
import { Readable } from 'stream';

/** Shared helpers for reading uploaded .xlsx/.csv files and producing .xlsx/.csv downloads. */

export function cellValue(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ('result' in v) return cellValue(v.result); // formula cell -> its cached result
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
    if ('error' in v) return '';
    return String(v);
  }
  return v;
}

export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** "1,234.50", "₦1 234", "(500)", "8%", 12 -> number; blanks/invalid -> null */
export function toNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s);
  s = s.replace(/[^0-9.\-]/g, '');
  if (!s || s === '-' || s === '.') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

/** Reads a base64 .xlsx/.csv payload into [{ name, rows: any[][] }]. */
export async function readTable(contentBase64, fileName = '') {
  const buffer = Buffer.from(String(contentBase64 || ''), 'base64');
  if (buffer.length === 0) throw Object.assign(new Error('The uploaded file is empty.'), { status: 400 });
  if (buffer.length > 6 * 1024 * 1024) throw Object.assign(new Error('The file is too large (max 6 MB).'), { status: 400 });

  const workbook = new ExcelJS.Workbook();
  const isCsv = /\.csv$/i.test(fileName);
  try {
    if (isCsv) await workbook.csv.read(Readable.from(buffer));
    else await workbook.xlsx.load(buffer);
  } catch {
    throw Object.assign(new Error('Could not read this file. Upload an .xlsx or .csv file.'), { status: 400 });
  }

  return workbook.worksheets.map((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values.slice(1).map(cellValue); // exceljs rows are 1-indexed
      rows.push(values);
    });
    return { name: ws.name, rows };
  });
}

/** Builds an .xlsx (or .csv of the first sheet) from [{ name, columns:[{header,width}], rows:[[...]] , notes? }] */
export async function buildTable(sheets, format = 'xlsx') {
  const workbook = new ExcelJS.Workbook();
  for (const sh of sheets) {
    const ws = workbook.addWorksheet(sh.name);
    ws.addRow(sh.columns.map((c) => c.header));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    sh.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width || 16; });
    sh.rows.forEach((r) => ws.addRow(r));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  if (format === 'csv') {
    const buf = await workbook.csv.writeBuffer();
    return { buffer: Buffer.from(buf), contentType: 'text/csv; charset=utf-8', ext: 'csv' };
  }
  const buf = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buf),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
  };
}

export function sendTable(res, built, baseName) {
  res.setHeader('Content-Type', built.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${baseName.replace(/[^A-Za-z0-9._-]/g, '_')}.${built.ext}"`);
  res.send(built.buffer);
}
