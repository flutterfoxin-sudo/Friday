const puppeteer = require('puppeteer');
(async () => {
  console.log("Launching Puppeteer...");
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    console.log("Browser launched. Opening page...");
    const page = await browser.newPage();
    console.log("Navigating to google...");
    await page.goto('https://www.google.com', { timeout: 10000 });
    console.log("Success! Title:", await page.title());
    await browser.close();
  } catch (e) {
    console.error("Error:", e.message);
  }
})();
