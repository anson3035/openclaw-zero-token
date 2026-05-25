/**
 * Validate a Taiwan license plate string against MOTC issuance rules.
 *
 * A plate that passes ALL rules can earn a confidence boost; a plate
 * that fails one or more rules drops to low confidence (high chance of
 * OCR hallucination).
 */

export interface PlateValidation {
  valid: boolean;
  reasons: string[]; // failures; empty when valid
  format?: "modern-7" | "old-6a" | "old-6b" | "motorcycle-3l3d" | "motorcycle-2l3d";
  special?: "ev" | "rental-ev" | "taxi" | undefined;
}

const NUMERIC = /^[0-9]+$/;
const ALPHA = /^[A-Z]+$/;

/**
 * Modern 7-character plates have 3 letters + 4 digits. The DIGIT section
 * never contains '4' per MOTC rules. Letters never contain 'I' or 'O'.
 * E-prefix = electric vehicle; RE-prefix = rental EV; T-/Y-prefix = taxi.
 */
function checkLetters(s: string, reasons: string[]): void {
  if (!ALPHA.test(s)) {
    reasons.push(`letter section "${s}" contains non-letter chars`);
    return;
  }
  if (/[IO]/.test(s)) {
    reasons.push(`letter section "${s}" contains 'I' or 'O' which are excluded by MOTC`);
  }
}

function checkDigits(s: string, modern7: boolean, reasons: string[]): void {
  if (!NUMERIC.test(s)) {
    reasons.push(`digit section "${s}" contains non-digit chars`);
    return;
  }
  if (modern7 && /4/.test(s)) {
    reasons.push(`digit section "${s}" contains '4' which is excluded in modern 7-char plates`);
  }
}

export function validatePlate(rawPlate: string): PlateValidation {
  const plate = rawPlate.toUpperCase().replace(/\s+/g, "");
  const reasons: string[] = [];

  // strip the dash for parts (still detect format by length)
  const m = plate.match(/^([A-Z0-9]+)-([A-Z0-9]+)$/);
  if (!m) {
    reasons.push("plate does not contain exactly one dash");
    return { valid: false, reasons };
  }
  const [, left, right] = m;
  if (!left || !right) {
    reasons.push("invalid plate sections");
    return { valid: false, reasons };
  }
  const total = left.length + right.length;

  // Modern 7-Character: 3L-4D
  if (left.length === 3 && right.length === 4 && ALPHA.test(left) && NUMERIC.test(right)) {
    checkLetters(left, reasons);
    checkDigits(right, true, reasons);
    let special: PlateValidation["special"];
    if (left.startsWith("RE")) special = "rental-ev";
    else if (left.startsWith("E")) special = "ev";
    else if (left.startsWith("T") || left.startsWith("Y")) special = "taxi";
    return { valid: reasons.length === 0, reasons, format: "modern-7", special };
  }

  // Older 6-character: 2L-4D
  if (left.length === 2 && right.length === 4 && ALPHA.test(left) && NUMERIC.test(right)) {
    checkLetters(left, reasons);
    checkDigits(right, false, reasons);
    return { valid: reasons.length === 0, reasons, format: "old-6a" };
  }

  // Older 6-character: 4D-2L
  if (left.length === 4 && right.length === 2 && NUMERIC.test(left) && ALPHA.test(right)) {
    checkDigits(left, false, reasons);
    checkLetters(right, reasons);
    return { valid: reasons.length === 0, reasons, format: "old-6b" };
  }

  // Motorcycle: 3L-3D
  if (left.length === 3 && right.length === 3 && ALPHA.test(left) && NUMERIC.test(right)) {
    checkLetters(left, reasons);
    checkDigits(right, false, reasons);
    return { valid: reasons.length === 0, reasons, format: "motorcycle-3l3d" };
  }

  // Motorcycle: 2L-3D
  if (left.length === 2 && right.length === 3 && ALPHA.test(left) && NUMERIC.test(right)) {
    checkLetters(left, reasons);
    checkDigits(right, false, reasons);
    return { valid: reasons.length === 0, reasons, format: "motorcycle-2l3d" };
  }

  reasons.push(`length ${total} or arrangement does not match any MOTC issued format`);
  return { valid: false, reasons };
}
