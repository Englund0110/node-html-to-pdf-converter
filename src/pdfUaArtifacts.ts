import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNull, PDFNumber, PDFObject, PDFPageLeaf, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { Edit, applyEdits, parseOperations } from "./contentStream";

// PDF/UA requires every drawing to be either tagged content or an artifact (decoration).
// Chromium gets this wrong for CSS borders and backgrounds:
//  - it tags them as content of the Table (/Table <</MCID 0>> BDC ... EMC), which puts
//    content before the Caption ("Invalid use of a Caption structure element"), or
//  - it leaves them outside any marked content ("Path object not tagged").
// This turns both into /Artifact BMC ... EMC and removes the MCIDs from the structure tree.
export function markDecorationsAsArtifacts(doc: PDFDocument): void {
  for (const page of doc.getPages()) {
    const streams = contentStreamsOf(doc, page.node);
    if (!streams) continue;

    const source = streams.map(decodeLatin1).join("\n");
    const { content, artifactMcids } = rewriteDecorations(source, (name) => xObjectHasTaggedContent(page.node, name));
    if (content === source) continue;

    const newStream = doc.context.flateStream(Buffer.from(content, "latin1"));
    page.node.set(PDFName.of("Contents"), doc.context.register(newStream));
    removeMcidsFromStructTree(doc, page.node, artifactMcids);
  }
}

const TEXT_SHOWING = new Set(["Tj", "TJ", "'", '"']);
const PATH_CONSTRUCTION = new Set(["m", "l", "c", "v", "y", "h", "re"]);
const PATH_PAINTING = new Set(["S", "s", "f", "F", "f*", "B", "B*", "b", "b*"]);
const OTHER_PAINTING = new Set(["Do", "sh", "EI"]);

type MarkedContent = { bdcStart: number; bdcEnd: number; mcid?: number; paintsPaths: boolean; hasRealContent: boolean };

// The string transformation behind markDecorationsAsArtifacts, kept free of pdf-lib so it can be unit tested.
export function rewriteDecorations(
  src: string,
  isTaggedXObject: (name: string) => boolean = () => false,
): { content: string; artifactMcids: number[] } {
  const edits: Edit[] = [];
  const artifactMcids: number[] = [];
  const wrap = (start: number, end: number) =>
    edits.push({ start, end: start, text: "/Artifact BMC\n" }, { start: end, end, text: "\nEMC" });

  const open: MarkedContent[] = [];
  let untaggedPathStart: number | null = null;
  let untaggedTextStart: number | null = null;

  for (const op of parseOperations(src)) {
    const name = op.operator;
    const current = open[open.length - 1];

    if (name === "BDC" || name === "BMC") {
      if (current) current.hasRealContent = true; // nested content: leave the outer sequence alone
      untaggedTextStart = null; // a text block with tagged parts is not wrapped
      open.push({ bdcStart: op.start, bdcEnd: op.end, mcid: mcidOf(op.operands), paintsPaths: false, hasRealContent: false });
    } else if (name === "EMC") {
      const closed = open.pop();
      // A tagged sequence that only draws lines/rectangles is decoration, not content
      if (closed?.mcid !== undefined && closed.paintsPaths && !closed.hasRealContent) {
        edits.push({ start: closed.bdcStart, end: closed.bdcEnd, text: "/Artifact BMC" });
        artifactMcids.push(closed.mcid);
      }
    } else if (current) {
      if (PATH_PAINTING.has(name)) current.paintsPaths = true;
      if (TEXT_SHOWING.has(name) || OTHER_PAINTING.has(name)) current.hasRealContent = true;
    }
    // Everything below is drawing outside any marked content
    else if (name === "BT") {
      untaggedTextStart = op.start;
    } else if (name === "ET") {
      if (untaggedTextStart !== null) wrap(untaggedTextStart, op.end);
      untaggedTextStart = null;
    } else if (PATH_CONSTRUCTION.has(name)) {
      untaggedPathStart ??= op.start;
    } else if (PATH_PAINTING.has(name)) {
      if (untaggedPathStart !== null) wrap(untaggedPathStart, op.end);
      untaggedPathStart = null;
    } else if (name === "n") {
      untaggedPathStart = null; // clipping path, nothing is painted
    } else if (OTHER_PAINTING.has(name) && untaggedTextStart === null && !isTaggedXObject(op.operands[0] ?? "")) {
      wrap(op.start, op.end);
    }
  }

  return { content: edits.length ? applyEdits(src, edits) : src, artifactMcids };
}

function mcidOf(operands: string[]): number | undefined {
  const i = operands.indexOf("/MCID");
  return i >= 0 ? Number(operands[i + 1]) : undefined;
}

function contentStreamsOf(doc: PDFDocument, page: PDFPageLeaf): PDFRawStream[] | undefined {
  const contents = doc.context.lookup(page.get(PDFName.of("Contents")));
  const streams = contents instanceof PDFArray ? contents.asArray().map((s) => doc.context.lookup(s)) : [contents];
  return streams.every((s) => s instanceof PDFRawStream) ? (streams as PDFRawStream[]) : undefined;
}

// A form XObject that contains MCIDs is tagged content and must not become an artifact
function xObjectHasTaggedContent(page: PDFPageLeaf, name: string): boolean {
  const xObjects = page.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  const xObject = xObjects?.lookup(PDFName.of(name.slice(1)));
  return xObject instanceof PDFRawStream && decodeLatin1(xObject).includes("/MCID");
}

function decodeLatin1(stream: PDFRawStream): string {
  return Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
}

// Removes the marked-content references from their struct elements and from the ParentTree.
function removeMcidsFromStructTree(doc: PDFDocument, page: PDFPageLeaf, mcids: number[]): void {
  if (mcids.length === 0) return;
  const ctx = doc.context;
  const structTreeRoot = doc.catalog.lookupMaybe(PDFName.of("StructTreeRoot"), PDFDict);
  const parentTree = structTreeRoot?.lookupMaybe(PDFName.of("ParentTree"), PDFDict);
  const structParents = page.lookupMaybe(PDFName.of("StructParents"), PDFNumber)?.asNumber();
  if (!parentTree || structParents === undefined) return;

  const parents = lookupNumberTree(doc, parentTree, structParents);
  if (!(parents instanceof PDFArray)) return;

  const K = PDFName.of("K");
  for (const mcid of mcids) {
    const element = ctx.lookup(parents.get(mcid));
    if (element instanceof PDFDict) {
      const kids = ctx.lookup(element.get(K));
      const list = kids instanceof PDFArray ? kids.asArray() : kids ? [element.get(K)!] : [];
      element.set(K, ctx.obj(list.filter((kid) => !refersToMcid(doc, kid, mcid))));
    }
    if (mcid < parents.size()) parents.set(mcid, PDFNull);
  }
}

function refersToMcid(doc: PDFDocument, kid: PDFObject, mcid: number): boolean {
  const resolved = doc.context.lookup(kid);
  if (resolved instanceof PDFNumber) return resolved.asNumber() === mcid;
  if (resolved instanceof PDFDict && resolved.get(PDFName.of("Type")) === PDFName.of("MCR")) {
    return resolved.lookupMaybe(PDFName.of("MCID"), PDFNumber)?.asNumber() === mcid;
  }
  return false;
}

function lookupNumberTree(doc: PDFDocument, node: PDFDict, key: number): PDFObject | undefined {
  const nums = node.lookupMaybe(PDFName.of("Nums"), PDFArray);
  for (let i = 0; nums && i + 1 < nums.size(); i += 2) {
    if (nums.lookup(i, PDFNumber).asNumber() === key) return nums.lookup(i + 1);
  }
  for (const kid of node.lookupMaybe(PDFName.of("Kids"), PDFArray)?.asArray() ?? []) {
    const found = lookupNumberTree(doc, doc.context.lookup(kid, PDFDict), key);
    if (found) return found;
  }
  return undefined;
}
