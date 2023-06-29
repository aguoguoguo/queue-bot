const puppeteer = require('puppeteer-extra');
const pluginStealth = require('puppeteer-extra-plugin-stealth');
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;

puppeteer.use(pluginStealth());

let targetUrl = "";
let numSessions = 0;

if (process.argv.length < 3) {
  console.log("Usage: node stress_test.js <URL> <number_of_sessions>");
  process.exit(1);
}

targetUrl = process.argv[2];
numSessions = parseInt(process.argv[3]);

launchWorkers();

function launchWorkers() {
  if (cluster.isMaster) {
    console.log(`Master ${process.pid} is running`);

    for (let i = 0; i < numSessions; i++) {
      cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
      console.log(`Worker ${worker.process.pid} died`);
    });
  } else {
    console.log(`Worker ${process.pid} started`);
    runTest(targetUrl);
  }
}

async function runTest(url) {
  let page;
  let browser;

  async function launchBrowser() {
    browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    page = await browser.newPage();

    // Block images
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if(req.resourceType() === 'image'){
        req.abort();
      }
      else {
        req.continue();
      }
    });

    await page.goto(url);
    await page.screenshot({ path: 'image.png', fullPage: true });

    let isLaunchingBrowser = false;

    async function checkUrlChange() {
      if (page.url() !== url && !isLaunchingBrowser) {
        isLaunchingBrowser = true;
        console.log(`Worker ${process.pid} has passed queue! ":)`);
        const cookies = await page.cookies();

        const newBrowser = await puppeteer.launch({
          headless: false,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const newPage = await newBrowser.newPage();
        await newPage.setCookie(...cookies);
        await newPage.goto(url);

        // Stop blocking images
        newPage.off('request');
        await newPage.setRequestInterception(false);

        await browser.close();
        browser = newBrowser;
        page = newPage;
      }

      // Schedule the next URL check after 10 seconds
      setTimeout(checkUrlChange, 10000);
    }

    // Start the URL change checking loop
    checkUrlChange();
  }

  // Launch the browser and start checking for URL changes
  launchBrowser();

  console.log(`Worker ${process.pid} started browsing`);
}
