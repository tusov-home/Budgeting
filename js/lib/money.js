// Money helpers. All amounts inside the app are whole cents (integers),
// so 12.30 € is stored as 1230. This avoids floating-point surprises
// like 0.1 + 0.2 = 0.30000000000000004.

const formatter = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatterWhole = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Turn what the user typed into cents.
 * Accepts "12,30", "12.30", "1.234,56", "1,234.56", "12", "-5".
 * Returns null when the text is not a number.
 */
export function parseCents(text) {
  if (text === null || text === undefined) return null;
  let s = String(text).trim().replace(/\s|€/g, '');
  if (s === '') return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  // Whichever separator comes last is the decimal separator;
  // the other one is a thousands separator and is removed.
  if (lastComma > lastDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma && lastComma !== -1) {
    s = s.replace(/,/g, '');
  }

  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

/** 123456 → "1.234,56 €" */
export function formatCents(cents) {
  return formatter.format((cents || 0) / 100);
}

/** 123456 → "1.235 €" (for compact stats) */
export function formatCentsWhole(cents) {
  return formatterWhole.format(Math.round((cents || 0) / 100));
}

const byCurrency = {};
/** 123456, 'SEK' → "1.234,56 SEK" (any currency; EUR shows €) */
export function formatMoney(cents, currency = 'EUR') {
  if (!byCurrency[currency]) {
    byCurrency[currency] = new Intl.NumberFormat('de-DE', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return byCurrency[currency].format((cents || 0) / 100);
}

/** 123456 → "1234,56" (for pre-filling input fields) */
export function centsToInput(cents) {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}
