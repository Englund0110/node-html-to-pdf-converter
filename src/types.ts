import { PDFMargin, PDFOptions } from "puppeteer";

export type CreatePdfRequestDto = {
  ContentHtml: string | undefined;
  HeaderHtml: string | undefined;
  FooterHtml: string | undefined;
  Margin: PDFMargin | undefined;
  Title: string | undefined;
  Language: string | undefined;
};