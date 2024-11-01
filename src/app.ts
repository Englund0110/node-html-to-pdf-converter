import express from "express";
import puppeteer, { Browser, PDFMargin, Page } from "puppeteer";
import genericPool from "generic-pool";
import signpdf from "@signpdf/signpdf";
import { P12Signer } from "@signpdf/signer-p12";
import { plainAddPlaceholder } from '@signpdf/placeholder-plain';
import fs from "fs";
import path from "path";

interface IRequestBody {
  ContentHtml: string | undefined;
  // isHtmlBase64Encoded: boolean | undefined;
  // pdfOptions: undefined | {
  //   margin: PDFMargin | undefined
  // },
  HeaderHtml: string | undefined;
  FooterHtml: string | undefined;
  SigningCertificateThumbprint: string | undefined;
  Sign: boolean
}

const app = express();
const port = process.env.PORT ?? 3000

let globalBrowserInstance: Browser | undefined = undefined; 
puppeteer.launch({ headless: 'new' }).then((browser) => globalBrowserInstance = browser);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create a pool of browser instances
//const browserPool = createBrowserPool();
const pagePool = createPagePool();

app.post("/", async (req: express.Request, res: express.Response) => {
  try {
    if (!(req.body as IRequestBody).ContentHtml) {
      res.status(400).send('HTML is missing from body')
    } else {
      const html = (req.body as IRequestBody).ContentHtml!;

      // Acquire a browser instance from the pool
      // const browserInstance = await browserPool.acquire() ?? puppeteer.launch({ headless: 'new' });

      // const browserInstance = await puppeteer.launch({headless: 'new'});

      // const page = await browserInstance.newPage();
      const page = await pagePool.acquire();
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      await page.emulateMediaType("screen");

      const pdfBuffer = await page.pdf({
        margin: { top: "100px", right: "25px", bottom: "100px", left: "25px" },
        // printBackground: true,
        format: "A4",
        // pageRanges: "",
        // headerTemplate: "<div id='header'><span>Dette er en header</span></div>",
        headerTemplate: "<div></div>",
        // footerTemplate: "<div style='color: lightgray; border-top: solid lightgray 1px; font-size: 10px; padding-top: 5px; text-align: center; width: 100%;'><span>This is a test message</span> - <span class='pageNumber'></span> / <span class='totalPages'></span></div>",
        footerTemplate: "<div></div>",
        displayHeaderFooter: true,
        // path: Math.random() + "_result.pdf",
      });

      // await page.close();
      // await browserInstance.close();

      // Release the browser instance back to the pool
      // browserPool.destroy(browserInstance);

      pagePool.destroy(page);

      const bufferResult = (req.body as IRequestBody).Sign ?
        await signPdf(pdfBuffer) :
        pdfBuffer;

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

app.get("/", function (req, res) {
  res.send("hello world");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// Function to create a pool of browser instances
function createBrowserPool(): genericPool.Pool<Browser> {
  const browserFactory = {
    create: async () => {
      console.log("Creating new pool");
      return puppeteer.launch({ headless: 'new' });
    },
    destroy: async (browserInstance: Browser) => {
      console.log("Destroying pool");
      await browserInstance.close();
    },
  };

  return genericPool.createPool(browserFactory, {
    min: 5,
    max: 10,
    testOnBorrow: false,
    acquireTimeoutMillis: 30000,
  });
}

function createPagePool(): genericPool.Pool<Page> {
  const pageFactory = {
    create: async () => {
      console.log("Creating new page");
      var page = globalBrowserInstance!.newPage();
      return page;
    },
    destroy: async (pageInstance: Page) => {
      console.log("Destroying page");
      await pageInstance.close();
    },
  };

  return genericPool.createPool(pageFactory, {
    min: 5,
    max: 5,
    testOnBorrow: false,
    acquireTimeoutMillis: 30000,
  });
}

async function signPdf(pdfBuffer: Buffer): Promise<Buffer> {
  var certificatePath = path.join(__dirname, '/../oces3_-test-_systemcertifikat.p12');
  var certificateBuffer = fs.readFileSync(certificatePath);
  var signer = new P12Signer(certificateBuffer, { passphrase: 'c5,PnmF8;m4I' });

  const pdfWithPlaceholder = plainAddPlaceholder({
    pdfBuffer: pdfBuffer,
    reason: '',
    contactInfo: '',
    name: '',
    location: '',
    subFilter: 'ETSI.CAdES.detached'
  });

  return await signpdf.sign(pdfWithPlaceholder, signer);
}

// Handle shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown() {
  console.log('Shutting down gracefully...');

  globalBrowserInstance?.close().then(() => {
    console.log("Browser closed")
    process.exit(0);
  })

  // Force close the server after 5 seconds
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 5000);
}