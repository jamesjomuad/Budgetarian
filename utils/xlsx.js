/**
 * XLSX generation without a spreadsheet dependency.
 *
 * A workbook is a ZIP of OOXML parts. Every sheet here writes inline strings
 * (never formula cells), so user text such as "=SUM(A1:A9)" is stored as text
 * and cannot execute when the file opens. Numbers stay numbers, which keeps
 * sorting, formulas and totals in Excel working.
 */

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** UTF-8 bytes for a string; avoids depending on TextEncoder in Hermes. */
export function utf8Bytes(value) {
  const text = String(value ?? '');
  const bytes = [];
  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function littleEndian16(value) {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function littleEndian32(value) {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

/**
 * Store-only ZIP (compression method 0). Store is enough for text parts and
 * keeps the writer short; the result is a valid OOXML package.
 */
function zip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = (46 << 9) | (1 << 5) | 1; // 2026-01-01 00:00

  for (const entry of entries) {
    const name = utf8Bytes(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : utf8Bytes(entry.data);
    const crc = crc32(data);

    const local = concatBytes([
      littleEndian32(0x04034b50),
      littleEndian16(20),
      littleEndian16(0x0800),
      littleEndian16(0),
      littleEndian16(dosTime),
      littleEndian16(dosDate),
      littleEndian32(crc),
      littleEndian32(data.length),
      littleEndian32(data.length),
      littleEndian16(name.length),
      littleEndian16(0),
      name,
      data,
    ]);
    localParts.push(local);

    centralParts.push(
      concatBytes([
        littleEndian32(0x02014b50),
        littleEndian16(20),
        littleEndian16(20),
        littleEndian16(0x0800),
        littleEndian16(0),
        littleEndian16(dosTime),
        littleEndian16(dosDate),
        littleEndian32(crc),
        littleEndian32(data.length),
        littleEndian32(data.length),
        littleEndian16(name.length),
        littleEndian16(0),
        littleEndian16(0),
        littleEndian16(0),
        littleEndian16(0),
        littleEndian32(0),
        littleEndian32(offset),
        name,
      ]),
    );

    offset += local.length;
  }

  const central = concatBytes(centralParts);
  const end = concatBytes([
    littleEndian32(0x06054b50),
    littleEndian16(0),
    littleEndian16(0),
    littleEndian16(entries.length),
    littleEndian16(entries.length),
    littleEndian32(central.length),
    littleEndian32(offset),
    littleEndian16(0),
  ]);

  return concatBytes([...localParts, central, end]);
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function safeSheetName(name, used) {
  const base =
    String(name ?? 'Sheet')
      .replace(/[\\/?*[\]:]/g, ' ')
      .replace(/^'+|'+$/g, '')
      .trim()
      .slice(0, 31) || 'Sheet';
  let candidate = base;
  let index = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${index})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    index += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function styleFor(kind) {
  if (kind === 'label') return 3;
  if (kind === 'muted') return 4;
  return 0;
}

function sheetXml(sheet, selected) {
  const rows = [];
  const header = sheet.columns.map((column, index) => {
    const ref = `${columnName(index)}1`;
    return `<c r="${ref}" s="1" t="inlineStr"><is><t>${escapeXml(column.label)}</t></is></c>`;
  });
  rows.push(`<row r="1" ht="22" customHeight="1">${header.join('')}</row>`);

  sheet.rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2;
    const cells = [];
    row.forEach((entry, columnIndex) => {
      if (!entry) return;
      const value = entry.value;
      if (value == null || value === '') return;
      const ref = `${columnName(columnIndex)}${line}`;
      if (entry.kind === 'money' || entry.kind === 'number' || typeof value === 'number') {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return;
        const style = entry.kind === 'money' ? ' s="2"' : '';
        cells.push(`<c r="${ref}"${style}><v>${numeric}</v></c>`);
      } else {
        cells.push(
          `<c r="${ref}" s="${styleFor(entry.kind)}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(
            value,
          )}</t></is></c>`,
        );
      }
    });
    rows.push(`<row r="${line}">${cells.join('')}</row>`);
  });

  const lastColumn = columnName(Math.max(0, sheet.columns.length - 1));
  const lastRow = Math.max(1, sheet.rows.length + 1);
  const cols = sheet.columns
    .map(
      (column, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${column.width ?? 18}" customWidth="1"/>`,
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${lastColumn}${lastRow}"/>
<sheetViews><sheetView${selected ? ' tabSelected="1"' : ''} workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${rows.join('')}</sheetData>
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF5E6B64"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F4D3A"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD8E0DB"/></left><right style="thin"><color rgb="FFD8E0DB"/></right><top style="thin"><color rgb="FFD8E0DB"/></top><bottom style="thin"><color rgb="FFD8E0DB"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Build a complete .xlsx file from a workbook model of sheets and typed cells. */
export function buildXlsxBytes(workbook) {
  const sheets = Array.isArray(workbook?.sheets) ? workbook.sheets : [];
  if (sheets.length === 0) throw new Error('The workbook has no sheets.');

  const used = new Set();
  const names = sheets.map((sheet) => safeSheetName(sheet.name, used));
  const entries = [];

  entries.push({
    name: '[Content_Types].xml',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="${XLSX_MIME}"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets
  .map(
    (_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join('\n')}
</Types>`,
  });

  entries.push({
    name: '_rels/.rels',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  });

  entries.push({
    name: 'xl/workbook.xml',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="14000"/></bookViews>
<sheets>${sheets
      .map(
        (_, index) =>
          `<sheet name="${escapeXml(names[index])}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
      )
      .join('')}</sheets>
</workbook>`,
  });

  entries.push({
    name: 'xl/_rels/workbook.xml.rels',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  )
  .join('\n')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  });

  entries.push({ name: 'xl/styles.xml', data: STYLES });

  sheets.forEach((sheet, index) => {
    entries.push({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: sheetXml(sheet, index === 0),
    });
  });

  return zip(entries);
}

export { crc32 };
