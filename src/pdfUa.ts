import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { markDecorationsAsArtifacts } from "./pdfUaArtifacts";

export type PdfUaOptions = {
  title: string;
  lang?: string;
};

// Chromium's tagged PDF output has a structure tree but no XMP metadata stream,
// so the PDF/UA identifier (pdfuaid:part=1) is missing. This adds it together with
// dc:title, DisplayDocTitle and /Lang, keeping the Info dictionary and XMP in sync.
export async function applyPdfUaMetadata(pdf: Uint8Array, opts: PdfUaOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });

  const now = new Date();
  const creationDate = doc.getCreationDate() ?? now;
  const creator = doc.getCreator() ?? "Chromium";
  const producer = doc.getProducer() ?? "Skia/PDF";

  doc.setTitle(opts.title, { showInWindowTitleBar: true });
  doc.setCreator(creator);
  doc.setProducer(producer);
  doc.setCreationDate(creationDate);
  doc.setModificationDate(now);

  const xmp = buildXmp({ title: opts.title, creator, producer, creationDate, modDate: now });
  const xmpBytes = new TextEncoder().encode(xmp);
  const metadataStream = doc.context.stream(xmpBytes, {
    Type: "Metadata",
    Subtype: "XML",
    Length: xmpBytes.length,
  });
  doc.catalog.set(PDFName.of("Metadata"), doc.context.register(metadataStream));

  if (opts.lang && !doc.catalog.get(PDFName.of("Lang"))) {
    doc.catalog.set(PDFName.of("Lang"), PDFString.of(opts.lang));
  }

  markDecorationsAsArtifacts(doc);

  // Chromium writes a PDF 1.4 header; object streams require 1.5.
  return doc.save({ useObjectStreams: false });
}

function buildXmp(v: { title: string; creator: string; producer: string; creationDate: Date; modDate: Date }): string {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:xmp="http://ns.adobe.com/xap/1.0/"
        xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
        xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/">
      <dc:format>application/pdf</dc:format>
      <dc:title>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${escapeXml(v.title)}</rdf:li>
        </rdf:Alt>
      </dc:title>
      <xmp:CreatorTool>${escapeXml(v.creator)}</xmp:CreatorTool>
      <xmp:CreateDate>${toXmpDate(v.creationDate)}</xmp:CreateDate>
      <xmp:ModifyDate>${toXmpDate(v.modDate)}</xmp:ModifyDate>
      <xmp:MetadataDate>${toXmpDate(v.modDate)}</xmp:MetadataDate>
      <pdf:Producer>${escapeXml(v.producer)}</pdf:Producer>
      <pdfuaid:part>1</pdfuaid:part>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

// pdf-lib writes Info dates in UTC, so the XMP dates use UTC too (seconds precision).
function toXmpDate(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
