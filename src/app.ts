import express from "express";
import puppeteer, { Browser, PDFMargin } from "puppeteer";
import genericPool from "generic-pool";
import { CreatePdfRequestDto } from "./types";
import { applyPdfUaMetadata } from "./pdfUa";

const app = express();
const port = process.env.PORT ?? 3030
const headlessMode: boolean | 'shell' | undefined = true;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create a pool of browser instances
const browserPool = createBrowserPool();

app.post("/api/pdf/create", async (req: express.Request, res: express.Response) => {
  try {
    if (!(req.body as CreatePdfRequestDto).ContentHtml) {
      res.status(400).send('HTML is missing from body')
    } else {
      const contentHtml = (req.body as CreatePdfRequestDto).ContentHtml!;
      const headerHtml = (req.body as CreatePdfRequestDto).HeaderHtml ?? undefined;
      const footerHtml = (req.body as CreatePdfRequestDto).FooterHtml ?? undefined;
      const margin = (req.body as CreatePdfRequestDto).Margin ?? undefined;
      const title = (req.body as CreatePdfRequestDto).Title ?? undefined;
      const language = (req.body as CreatePdfRequestDto).Language ?? undefined;

      // Create PDF
      const bufferResult = await createPdf(contentHtml, headerHtml, footerHtml, margin, title, language);

      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=filename.pdf",
        "Content-Length": bufferResult.length,
      });

      res.end(bufferResult);
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("An error occurred. Error: " + error);
  }
});

app.get("/isAlive", async function (req, res) {
  await createPdf(`<div>${new Date().toISOString()}</div>`);
  res.send(true);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

async function createPdf(contentHtml: string, headerHtml?: string, footerHtml?: string, margin?: PDFMargin, title?: string, language?: string): Promise<Uint8Array> {
  const browserInstance = await browserPool.acquire() ?? puppeteer.launch({ headless: headlessMode });
  const page = await browserInstance.newPage();
  await page.setContent(contentHtml, { waitUntil: "domcontentloaded" });
  await page.emulateMediaType("screen");

  // Fallbacks for PDF/UA metadata: <title> and <html lang> from the content
  const htmlTitle = await page.title();
  const htmlLang = await page.evaluate(() => document.documentElement.lang);

  const pdfBuffer = await page.pdf({
    margin: margin ?? { top: "0px", right: "25px", bottom: "100px", left: "25px" },
    format: "A4",
    headerTemplate: headerHtml,
    footerTemplate: footerHtml,
    displayHeaderFooter:   headerHtml || footerHtml ? true : false,
    tagged: true,
    outline: true,
    // headerTemplate: "<div id='header'><span>Dette er en header</span></div>",
    // footerTemplate: "<div style='color: lightgray; border-top: solid lightgray 1px; font-size: 10px; padding-top: 5px; text-align: center; width: 100%;'><span>This is a test message</span> - <span class='pageNumber'></span> / <span class='totalPages'></span></div>",
  });

  await browserInstance.close();
  browserPool.destroy(browserInstance);

  return applyPdfUaMetadata(pdfBuffer, {
    title: title || htmlTitle || "Document",
    lang: language || htmlLang || undefined,
  });
}

// Function to create a pool of browser instances
function createBrowserPool(): genericPool.Pool<Browser> {
  const browserFactory = {
    create: async () => {
      const browserInstance = await puppeteer.launch({ headless: headlessMode });
      console.log(`Creating browser instance (PID: ${browserInstance.process()!.pid})`);
      return browserInstance;
    },
    destroy: async (browserInstance: Browser) => {
      console.log(`Destroying browser instance (PID: ${browserInstance.process()!.pid})`);
      await browserInstance.close();
    },
  };

  return genericPool.createPool(browserFactory, {
    min: 1,
    max: 2,
    testOnBorrow: false,
    acquireTimeoutMillis: 30000,
  });
}

// Handle shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown() {
  console.log('Shutting down gracefully...');

  // Close the browser pool
  browserPool.drain().then(() => {
    browserPool.clear();
    console.log("Browser pool drained and cleared");
  }).catch((error) => {
    console.error("Error draining browser pool:", error);
    process.exit(1);
  });

  // Force close the server after 5 seconds
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 5000);
}