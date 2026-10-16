import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdits, parseOperations } from "./contentStream";

const operators = (src: string) => parseOperations(src).map((o) => o.operator);

test("parses operators with their operands and ranges", () => {
  const src = "0 0 10 10 re\nf";
  const [re, f] = parseOperations(src);
  assert.deepEqual(re, { operator: "re", operands: ["0", "0", "10", "10"], start: 0, end: 12 });
  assert.equal(src.slice(f.start, f.end), "f");
});

test("handles marked content with an inline property dict", () => {
  const [bdc] = parseOperations("/Table <</MCID 0 >>BDC");
  assert.equal(bdc.operator, "BDC");
  assert.deepEqual(bdc.operands, ["/Table", "<<", "/MCID", "0", ">>"]);
  assert.equal(bdc.start, 0);
});

test("does not treat operators inside strings as operators", () => {
  assert.deepEqual(operators("BT (a (nested) re f \\) ET) Tj <0031 0044> Tj ET"), ["BT", "Tj", "Tj", "ET"]);
});

test("skips comments", () => {
  assert.deepEqual(operators("% 0 0 1 1 re f\nq Q"), ["q", "Q"]);
});

test("treats an inline image as one EI operation, ignoring its binary data", () => {
  const src = "q BI /W 1 /H 1 ID \x00re f\x01 EI Q";
  const ops = parseOperations(src);
  assert.deepEqual(ops.map((o) => o.operator), ["q", "EI", "Q"]);
  assert.equal(src.slice(ops[1].start, ops[1].end), "BI /W 1 /H 1 ID \x00re f\x01 EI");
});

test("applyEdits replaces and inserts in order", () => {
  const out = applyEdits("abcdef", [
    { start: 4, end: 4, text: "]" },
    { start: 0, end: 1, text: "A" },
    { start: 2, end: 2, text: "[" },
  ]);
  assert.equal(out, "Ab[cd]ef");
});
