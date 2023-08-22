const puppeteer = require('puppeteer-extra');
const pluginStealth = require('puppeteer-extra-plugin-stealth');
const cluster = require('cluster');

puppeteer.use(pluginStealth());

let targetUrl = "";
let numSessions = 0;

if (process.argv.length < 3) {
  console.log("Usage: node stress_test.js <URL> <number_of_sessions>");
  process.exit(1);
}

targetUrl = process.argv[2];
numSessions = parseInt(process.argv[3]);

if (cluster.isMaster) {
    console.log(`Master ${process.pid} is running`);

    for (let i = 0; i < numSessions; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} died`);
    });

    process.on('SIGINT', () => {
      console.log("\nGracefully shutting down from SIGINT (CTRL+C)");

      cluster.disconnect(() => {
          console.log("All workers closed.");
          process.exit(); // Exit the master process
      });
    });

} else {
    let browser; // Declare the browser inside the worker
    let checkUrlChangeTimeout; // Define timeout reference
    
    let pageClosed = false; // Flag to track if the original page has been closed
    
    console.log(`Worker ${process.pid} started`);
    runTest(targetUrl);
    
  
  process.on('SIGINT', async () => {
    console.log(`\nWorker ${process.pid} gracefully shutting down from SIGINT (CTRL+C)`);

    if (browser) {
      await browser.close();
      console.log(`Worker ${process.pid} Browser closed.`);
    }

    clearTimeout(checkUrlChangeTimeout); // Clear the timeout
    process.exit(); // Exit the worker process
  });

  async function launchBrowser() {
    if (!browser) {
      browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
    return browser;
  }

  async function runTest(url) {
    await launchBrowser();
    const page = await browser.newPage();

    // Block images
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if(req.resourceType() === 'image'){
        req.abort();
      } else {
        req.continue();
      }
    });

    try {
      await page.goto(url);
      // await page.screenshot({ path: `image_${process.pid}.png`, fullPage: true });

      async function checkUrlChange() {
        try {
            if (page.url() !== url && !pageClosed) {
                console.log(`Worker ${process.pid} has passed queue! ":)`);
                const cookies = await page.cookies();

                const newBrowser = await puppeteer.launch({
                    headless: false,  // open a visible browser
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });
                const newPage = await newBrowser.newPage();
                await newPage.setCookie(...cookies);
                await newPage.goto(url);

                // Stop blocking images for the new page
                await newPage.setRequestInterception(false);

                // Close the original page to free up resources
                clearTimeout(checkUrlChangeTimeout);
                await page.close();
                pageClosed = true; // Mark the page as closed
            }

            if (!pageClosed) { // Only schedule a new check if the page isn't closed
                clearTimeout(checkUrlChangeTimeout);
                checkUrlChangeTimeout = setTimeout(checkUrlChange, 10000);
            }
        } catch (error) {
            console.error(`Worker ${process.pid} encountered an error in checkUrlChange:`, error);
        }
    }

      // Start the URL change checking loop
      checkUrlChange();
    } catch (error) {
      console.error(`Worker ${process.pid} encountered an error:`, error);
    }

    console.log(`Worker ${process.pid} started browsing`);
  }
}
