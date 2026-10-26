/**
 * A very small PDF 1.4 writer: pages made of absolutely positioned text,
 * rectangles and rules, drawn with the two standard Helvetica fonts.
 *
 * The standard fonts are not embedded, so the file stays small and every
 * viewer can open it. Text is limited to WinAnsi (the fonts' built-in
 * encoding); anything outside it is sanitised to a readable equivalent or a
 * question mark. No external library, no native module, no web view.
 */

export const PDF_PAGE_WIDTH = 595.28;
export const PDF_PAGE_HEIGHT = 841.89;

// Adobe AFM advance widths for ASCII 32-126, per 1000 units.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

function glyphWidth(character, bold) {
  const code = character.charCodeAt(0);
  if (code < 32 || code > 126) return 556;
  return (bold ? HELVETICA_BOLD : HELVETICA)[code - 32] ?? 556;
}

/** Width of one line of text at a given point size, in points. */
export function measureText(text, size = 10, bold = false) {
  const value = String(text ?? '');
  let width = 0;
  for (let index = 0; index < value.length; index += 1) {
    width += glyphWidth(value[index], bold);
  }
  return (width * size) / 1000;
}

/** Greedy word wrap, hard-breaking a word that is wider than the column. */
export function wrapText(text, size, bold, maxWidth) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n');
  const result = [];
  const paragraphs = source.split('\n');

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      result.push('');
      continue;
    }
    let line = '';
    const appendWord = (word) => {
      if (measureText(word, size, bold) <= maxWidth) {
        line = word;
        return;
      }
      // A single word wider than the column: break it by character.
      let chunk = '';
      for (const character of word) {
        if (measureText(chunk + character, size, bold) > maxWidth && chunk) {
          result.push(chunk);
          chunk = character;
        } else {
          chunk += character;
        }
      }
      line = chunk;
    };

    for (const word of words) {
      if (!line) {
        appendWord(word);
        continue;
      }
      const candidate = `${line} ${word}`;
      if (measureText(candidate, size, bold) <= maxWidth) {
        line = candidate;
      } else {
        result.push(line);
        line = '';
        appendWord(word);
      }
    }
    result.push(line);
  }

  return result.length > 0 ? result : [''];
}

/**
 * Sanitise text for the standard fonts. Common typographic characters become
 * their plain equivalents; currency symbols become ISO codes so no document
 * depends on a glyph the font lacks.
 */
function winAnsiText(value) {
  const replacements = {
    '\u2018': "'",
    '\u2019': "'",
    '\u201A': ',',
    '\u201C': '"',
    '\u201D': '"',
    '\u2013': '-',
    '\u2014': '-',
    '\u2022': '*',
    '\u2026': '...',
    '\u00A0': ' ',
    '\u20B1': 'PHP ',
    '\u20AC': 'EUR ',
    '\u00A3': 'GBP ',
    '\u00A5': 'JPY ',
    '\u2192': '->',
  };

  let output = '';
  for (const character of String(value ?? '')) {
    const replacement = replacements[character];
    if (replacement != null) {
      output += replacement;
      continue;
    }
    const code = character.charCodeAt(0);
    output += code >= 32 && code <= 126 ? character : code >= 160 && code <= 255 ? character : '?';
  }
  return output;
}

function escapePdfText(value) {
  let output = '';
  for (const character of winAnsiText(value)) {
    const code = character.charCodeAt(0);
    if (character === '\\' || character === '(' || character === ')') output += `\\${character}`;
    else if (code < 32 || code > 126) output += `\\${code.toString(8).padStart(3, '0')}`;
    else output += character;
  }
  return output;
}

function number(value) {
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '0';
}

function rgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''));
  if (!match) return [0, 0, 0];
  const value = match[1];
  return [
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
  ];
}

function drawItem(item) {
  if (!item) return '';
  if (item.type === 'rect') {
    const [r, g, b] = rgb(item.color);
    const y = PDF_PAGE_HEIGHT - item.top - item.height;
    return `${number(r)} ${number(g)} ${number(b)} rg\n${number(item.x)} ${number(y)} ${number(
      item.width,
    )} ${number(item.height)} re f\n`;
  }
  if (item.type === 'line') {
    const [r, g, b] = rgb(item.color);
    return `${number(r)} ${number(g)} ${number(b)} RG\n${number(item.width ?? 0.7)} w\n${number(
      item.x1,
    )} ${number(PDF_PAGE_HEIGHT - item.top1)} m ${number(item.x2)} ${number(
      PDF_PAGE_HEIGHT - item.top2,
    )} l S\n`;
  }
  if (item.type !== 'text') return '';

  const text = winAnsiText(item.text);
  const width =
    item.align === 'center' || item.align === 'right'
      ? measureText(text, item.size, item.bold)
      : 0;
  const offset =
    item.align === 'right'
      ? (item.width ?? 0) - width
      : item.align === 'center'
        ? ((item.width ?? 0) - width) / 2
        : 0;
  const x = (item.x ?? 0) + Math.max(0, offset);
  const y = PDF_PAGE_HEIGHT - item.top - item.size * 0.82;
  const [r, g, b] = rgb(item.color);
  const font = item.bold ? '/F2' : '/F1';
  return `BT ${font} ${number(item.size)} Tf ${number(r)} ${number(g)} ${number(b)} rg ${number(
    x,
  )} ${number(y)} Td (${escapePdfText(text)}) Tj ET\n`;
}

function footerText(page, total, footer) {
  if (footer === false) return '';
  if (typeof footer === 'function') return footer(page, total);
  return `Page ${page} of ${total}`;
}

export function buildPdfBytes(pages, options = {}) {
  const pageList = Array.isArray(pages) && pages.length > 0 ? pages : [{ items: [] }];
  const total = pageList.length;
  const contents = pageList.map((page, index) => {
    let stream = '';
    for (const item of page.items ?? []) stream += drawItem(item);
    const footer = footerText(index + 1, total, options.footer);
    if (footer) {
      const size = 8;
      const width = measureText(footer, size, false);
      const x = (PDF_PAGE_WIDTH - width) / 2;
      const y = 26;
      stream += `BT /F1 ${size} Tf 0.478 0.525 0.498 rg ${number(x)} ${number(y)} Td (${escapePdfText(
        footer,
      )}) Tj ET\n`;
    }
    return stream;
  });

  const objects = [];
  const pageObjectNumbers = [];
  const firstPage = 6;
  pageList.forEach((_, index) => pageObjectNumbers.push(firstPage + index * 2));

  const created = new Date(options.createdAt ?? Date.now());
  const stamp = `D:${created.getUTCFullYear()}${String(created.getUTCMonth() + 1).padStart(2, '0')}${String(
    created.getUTCDate(),
  ).padStart(2, '0')}${String(created.getUTCHours()).padStart(2, '0')}${String(
    created.getUTCMinutes(),
  ).padStart(2, '0')}${String(created.getUTCSeconds()).padStart(2, '0')}Z`;

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageObjectNumbers
    .map((numberValue) => `${numberValue} 0 R`)
    .join(' ')}] /Count ${total} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objects[5] = `<< /Title (${escapePdfText(options.title ?? 'Budgetarian document')}) /Producer (Budgetarian) /Creator (Budgetarian) /CreationDate (${stamp}) >>`;

  pageList.forEach((_, index) => {
    const pageObject = pageObjectNumbers[index];
    const contentObject = pageObject + 1;
    objects[pageObject] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObject} 0 R >>`;
    objects[contentObject] = `<< /Length ${contents[index].length} >>\nstream\n${contents[index]}endstream`;
  });

  const count = objects.length - 1;
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let objectNumber = 1; objectNumber <= count; objectNumber += 1) {
    offsets[objectNumber] = pdf.length;
    pdf += `${objectNumber} 0 obj\n${objects[objectNumber]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${count + 1}\n0000000000 65535 f \n`;
  for (let objectNumber = 1; objectNumber <= count; objectNumber += 1) {
    pdf += `${String(offsets[objectNumber]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${count + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const bytes = new Uint8Array(pdf.length);
  for (let index = 0; index < pdf.length; index += 1) bytes[index] = pdf.charCodeAt(index) & 0xff;
  return bytes;
}
