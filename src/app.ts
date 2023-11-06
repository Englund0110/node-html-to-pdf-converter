import express from "express";
import puppeteer, { Browser, PDFMargin } from "puppeteer";
import genericPool from "generic-pool";

interface IRequestBody {
  html: string | undefined;
  isHtmlBase64Encoded: boolean | undefined;
  pdfOptions: undefined | {
    margin: PDFMargin | undefined
  }
}

const app = express();
const port = process.env.PORT ?? 3000

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create a pool of browser instances
const browserPool = createBrowserPool();

app.post("/", async (req: express.Request, res: express.Response) => {
  try {
    if (!(req.body as IRequestBody).html) {
      res.status(400).send('HTML is missing from body')
    } else {
      const html = (req.body as IRequestBody).html!;

      // Acquire a browser instance from the pool
      const browserInstance = await browserPool.acquire() ?? puppeteer.launch({ headless: 'new' });

      // const browserInstance = await puppeteer.launch({headless: 'new'});

      const page = await browserInstance.newPage();
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      await page.emulateMediaType("screen");

      const pdf = await page.pdf({
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

      // Release the browser instance back to the pool
      browserPool.destroy(browserInstance);

      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=filename.pdf",
        "Content-Length": pdf.length,
      });
      res.end(pdf);
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
    validate: async (browserInstance: Browser) => {
      try {
        // Check if the browser instance is still usable
        const pages = await browserInstance.pages();
        return pages.length > 0;
      } catch (error) {
        return false; // Invalid instance
      }
    },
  };

  return genericPool.createPool(browserFactory, {
    min: 5,
    max: 10,
    testOnBorrow: true,
    acquireTimeoutMillis: 10000,
  });
}
