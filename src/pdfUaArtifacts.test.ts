import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteDecorations } from "./pdfUaArtifacts";

test("tagged sequence with only paths (Chrome 155 table borders) becomes an artifact", () => {
  const src = "/Table <</MCID 0 >>BDC\n0 277 404 1 re\nf\n.8 g\nEMC\n/NonStruct <</MCID 1 >>BDC\nBT (x) Tj ET\nEMC";
  const { content, artifactMcids } = rewriteDecorations(src);
  assert.deepEqual(artifactMcids, [0]);
  assert.equal(content, "/Artifact BMC\n0 277 404 1 re\nf\n.8 g\nEMC\n/NonStruct <</MCID 1 >>BDC\nBT (x) Tj ET\nEMC");
});

test("tagged sequence with text is left alone, even if it also draws paths", () => {
  const src = "/P <</MCID 3 >>BDC 0 0 1 1 re f BT (x) Tj ET EMC";
  assert.deepEqual(rewriteDecorations(src), { content: src, artifactMcids: [] });
});

test("sequence containing nested marked content is left alone", () => {
  const src = "/Table <</MCID 0 >>BDC 0 0 1 1 re f /Span <</MCID 1 >>BDC BT (x) Tj ET EMC EMC";
  assert.deepEqual(rewriteDecorations(src).artifactMcids, []);
});

test("untagged paths are wrapped, clipping paths are not", () => {
  const src = "0 0 9 9 re W n\n0 28 422 1 re\nf";
  assert.equal(rewriteDecorations(src).content, "0 0 9 9 re W n\n/Artifact BMC\n0 28 422 1 re\nf\nEMC");
});

test("untagged text block (e.g. header/footer template) is wrapped", () => {
  const src = "BT (Page 1) Tj ET";
  assert.equal(rewriteDecorations(src).content, "/Artifact BMC\nBT (Page 1) Tj ET\nEMC");
});

test("untagged XObject is wrapped unless it contains tagged content", () => {
  const src = "/Im1 Do /Fm1 Do";
  const { content } = rewriteDecorations(src, (name) => name === "/Fm1");
  assert.equal(content, "/Artifact BMC\n/Im1 Do\nEMC /Fm1 Do");
});
