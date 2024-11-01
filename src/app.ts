import express from "express";
import puppeteer, { Browser } from "puppeteer";
import genericPool from "generic-pool";

interface IRequestBody {
  ContentHtml: string | undefined;
  // isHtmlBase64Encoded: boolean | undefined;
  // pdfOptions: undefined | {
  //   margin: PDFMargin | undefined
  // },
  HeaderHtml: string | undefined;
  FooterHtml: string | undefined;
}

const app = express();
const port = process.env.PORT ?? 3000
const headlessMode: boolean | 'shell' | undefined = true;

let globalBrowserInstance: Browser | undefined = undefined;
puppeteer.launch({ headless: headlessMode }).then((browser) => globalBrowserInstance = browser);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create a pool of browser instances
const browserPool = createBrowserPool();

app.post("/", async (req: express.Request, res: express.Response) => {
  try {
    if (!(req.body as IRequestBody).ContentHtml) {
      res.status(400).send('HTML is missing from body')
    } else {
      const html = (req.body as IRequestBody).ContentHtml!;
      const headerHtml = (req.body as IRequestBody).HeaderHtml ?? undefined;
      const footerHtml = (req.body as IRequestBody).FooterHtml ?? undefined;

      // Acquire a browser instance from the pool
      const browserInstance = await browserPool.acquire() ?? puppeteer.launch({ headless: headlessMode });

      // const browserInstance = await puppeteer.launch({headless: 'new'});

      const page = await browserInstance.newPage();
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      await page.emulateMediaType("screen");

      const pdfBuffer = await page.pdf({
        margin: { top: "0px", right: "25px", bottom: "100px", left: "25px" },
        format: "A4",
        headerTemplate: headerHtml,
        footerTemplate: footerHtml,
        displayHeaderFooter: headerHtml || footerHtml ? true : false,
        // headerTemplate: "<div id='header'><span>Dette er en header</span></div>",
        // footerTemplate: "<div style='color: lightgray; border-top: solid lightgray 1px; font-size: 10px; padding-top: 5px; text-align: center; width: 100%;'><span>This is a test message</span> - <span class='pageNumber'></span> / <span class='totalPages'></span></div>",
      });

      console.log("Version", await browserInstance.version());
      await browserInstance.close();

      // Release the browser instance back to the pool
      browserPool.destroy(browserInstance);

      const bufferResult = pdfBuffer;

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
    min: 5,
    max: 10,
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

    globalBrowserInstance?.close().then(() => {
      console.log("Global browser instance closed");
      process.exit(0);
    }).catch((error) => {
      console.error("Error closing global browser instance:", error);
      process.exit(1);
    });
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