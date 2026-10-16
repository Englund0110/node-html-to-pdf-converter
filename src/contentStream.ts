// Minimal tokenizer for PDF page content streams (ISO 32000-1, 7.8.2).
// Turns "0 0 10 10 re f" into operations with their operands and the character
// range they cover, so callers can replace or wrap whole instructions.
// The string is the decoded stream read as latin1, so one character is one byte.

export type Operation = {
  operator: string;
  operands: string[];
  start: number; // index of the first operand (or the operator if none)
  end: number; // index just after the operator
};

const WHITESPACE = "\0\t\n\f\r ";
const DELIMITERS = "()<>[]{}/%";

const isRegular = (ch: string) => !WHITESPACE.includes(ch) && !DELIMITERS.includes(ch);

export function parseOperations(src: string): Operation[] {
  const ops: Operation[] = [];
  let operands: string[] = [];
  let operandsStart = -1;
  let i = 0;

  const pushOperand = (start: number, end: number) => {
    if (operandsStart < 0) operandsStart = start;
    operands.push(src.slice(start, end));
    i = end;
  };
  const pushOperation = (operator: string, start: number, end: number) => {
    ops.push({ operator, operands, start: operandsStart >= 0 ? operandsStart : start, end });
    operands = [];
    operandsStart = -1;
    i = end;
  };

  while (i < src.length) {
    const ch = src[i];
    const start = i;

    if (WHITESPACE.includes(ch)) {
      i++;
    } else if (ch === "%") {
      while (i < src.length && src[i] !== "\n" && src[i] !== "\r") i++;
    } else if (ch === "(") {
      pushOperand(start, endOfLiteralString(src, start));
    } else if (src.startsWith("<<", i) || src.startsWith(">>", i)) {
      pushOperand(start, start + 2);
    } else if (ch === "<") {
      const close = src.indexOf(">", start);
      pushOperand(start, close < 0 ? src.length : close + 1);
    } else if ("[]{}".includes(ch)) {
      pushOperand(start, start + 1);
    } else {
      // Name (/Foo), number, keyword operand or operator
      let end = ch === "/" ? start + 1 : start;
      while (end < src.length && isRegular(src[end])) end++;
      const word = src.slice(start, end);

      if (ch === "/" || /^[+\-.\d]/.test(word) || word === "true" || word === "false" || word === "null") {
        pushOperand(start, end);
      } else if (word === "ID") {
        // Inline image: BI <dict> ID <binary data> EI. Report it as one "EI" operation.
        const bi = ops[ops.length - 1]?.operator === "BI" ? ops.pop()! : undefined;
        if (bi) operandsStart = bi.start; // the image dict entries are not operands of EI
        operands = [];
        pushOperation("EI", start, endOfInlineImage(src, end));
      } else {
        pushOperation(word, start, end);
      }
    }
  }
  return ops;
}

function endOfLiteralString(src: string, start: number): number {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "\\") i++;
    else if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return i + 1;
  }
  return src.length;
}

function endOfInlineImage(src: string, idEnd: number): number {
  const pattern = /\sEI(?=[\0\t\n\f\r ]|$)/g;
  pattern.lastIndex = idEnd + 1; // one whitespace byte follows ID
  const match = pattern.exec(src);
  return match ? match.index + match[0].length : src.length;
}

// Applies non-overlapping edits (sorted by position) to the source string.
export type Edit = { start: number; end: number; text: string };

export function applyEdits(src: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let out = "";
  let pos = 0;
  for (const e of sorted) {
    out += src.slice(pos, e.start) + e.text;
    pos = e.end;
  }
  return out + src.slice(pos);
}
