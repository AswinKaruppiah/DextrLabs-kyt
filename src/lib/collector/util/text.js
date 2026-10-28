import { ADDRESS_SCAN_RE, chainFromHint } from "./address.js";

/** RFC 4180 CSV -> array of rows (arrays of strings). Handles quoted newlines and "" escapes. */
export function parseCsv(input) {
  const s = input.replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Rows -> objects keyed by the header row. */
export function csvToObjects(rows) {
  const [header, ...body] = rows;
  return body
    .filter((r) => r.length > 1 || r[0])
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}

export const decodeXmlEntities = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");

/** First text content of <tag>...</tag> in an XML fragment. */
export function xmlTag(fragment, tag) {
  const m = fragment.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? decodeXmlEntities(m[1].trim()) : null;
}

export function xmlTags(fragment, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  return [...fragment.matchAll(re)].map((m) => decodeXmlEntities(m[1].trim()));
}

/** Splits an XML document into the raw inner text of each <tag ...>...</tag> block. */
export function xmlBlocks(xml, tag) {
  const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, "g");
  return xml.match(re) || [];
}

/**
 * Extracts addresses from free text (sanction remarks / statements), attaching the
 * chain hint written closest before each address, e.g. "BSC: 0x30..." or "(3) USDT: T...".
 */
export function extractLabelledAddresses(text, lookback = 40) {
  const found = [];
  for (const m of text.matchAll(ADDRESS_SCAN_RE)) {
    const before = text.slice(Math.max(0, m.index - lookback), m.index);
    // Only the segment after the previous address belongs to this one.
    const segment = before.split(ADDRESS_SCAN_RE).pop();
    found.push({ address: m[0], statedChain: chainFromHint(segment), hint: segment.trim() });
  }
  return found;
}
