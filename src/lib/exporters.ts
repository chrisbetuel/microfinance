import { strToU8, zipSync } from 'fflate'
import { downloadCSV } from './csv'

/** A report ready to export: exactly the filtered rows shown on screen. */
export interface ExportTable {
  title: string // e.g. "Loan Report — September 2026"
  subtitle?: string // the filters that produced it
  organisation: string
  summary?: [string, string][]
  headers: string[]
  rows: (string | number)[][]
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function download(name: string, data: Blob) {
  const url = URL.createObjectURL(data)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function exportCSV(t: ExportTable) {
  downloadCSV(`${slug(t.title)}.csv`, t.headers, t.rows)
}

const xml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function colName(i: number) {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** A real .xlsx workbook: title rows, bold header, numbers stored as numbers. */
export function exportXLSX(t: ExportTable) {
  const lines: (string | number)[][] = [[t.title], ...(t.subtitle ? [[t.subtitle]] : []), []]
  for (const [k, v] of t.summary ?? []) lines.push([k, v])
  if (t.summary?.length) lines.push([])
  const headerRow = lines.length
  lines.push(t.headers, ...t.rows)

  const cell = (v: string | number, r: number, c: number) => {
    const ref = `${colName(c)}${r + 1}`
    const style = r === headerRow || r === 0 ? ' s="1"' : ''
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`
    if (v === '' || v == null) return ''
    return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`
  }
  const widths = t.headers.map((h, i) => Math.min(48, Math.max(h.length, ...t.rows.slice(0, 200).map((r) => String(r[i] ?? '').length)) + 2))
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow + 1}" topLeftCell="A${headerRow + 2}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${lines.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c)).join('')}</row>`).join('')}</sheetData>
</worksheet>`
  const files = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xml(t.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    'xl/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs>
</styleSheet>`),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  }
  download(`${slug(t.title)}.xlsx`, new Blob([zipSync(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
}

/** Opens a print-ready document; the browser's "Save as PDF" produces the file. */
export function exportPDF(t: ExportTable) {
  const w = window.open('', '_blank')
  if (!w) return
  const esc = (v: string | number) => xml(String(v ?? ''))
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(t.title)}</title>
<style>
@page{size:A4 landscape;margin:12mm}
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111;margin:0}
h1{font-size:18px;margin:0}.org{font-size:12px;color:#555}.sub{font-size:11px;color:#555;margin:4px 0 12px}
.sum{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 14px}.sum div{border:1px solid #ddd;border-radius:6px;padding:6px 10px;font-size:11px}
.sum b{display:block;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:10px}th{background:#14705d;color:#fff;text-align:left;padding:5px}
td{padding:4px 5px;border-bottom:1px solid #eee}tr:nth-child(even) td{background:#f7faf9}
.foot{margin-top:10px;font-size:10px;color:#777}
</style></head><body>
<div class="org">${esc(t.organisation)}</div><h1>${esc(t.title)}</h1>${t.subtitle ? `<div class="sub">${esc(t.subtitle)}</div>` : ''}
${t.summary?.length ? `<div class="sum">${t.summary.map(([k, v]) => `<div>${esc(k)}<b>${esc(v)}</b></div>`).join('')}</div>` : ''}
<table><thead><tr>${t.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${t.rows.map((r) => `<tr>${r.map((v) => `<td>${esc(typeof v === 'number' ? v.toLocaleString() : v)}</td>`).join('')}</tr>`).join('')}</tbody></table>
<div class="foot">${t.rows.length} row(s) · generated ${esc(new Date().toLocaleString())} from transaction records</div>
<script>window.onload=()=>window.print()</script></body></html>`)
  w.document.close()
}
