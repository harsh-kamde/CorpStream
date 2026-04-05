/**
 * packages/apify-actors/mca-scraper/src/main.js
 *
 * Apify Actor — MCA India company scraper
 * Scrapes Ministry of Corporate Affairs portal for newly registered companies
 * Deploy: apify push (from this directory)
 * Free tier: 5 compute units/month (~1 hour of runtime)
 */

import { Actor } from "apify";
import { PuppeteerCrawler, sleep } from "crawlee";

await Actor.init();

const input = await Actor.getInput() ?? {};
const {
  startDate    = new Date(Date.now() - 86_400_000).toISOString().split("T")[0],
  endDate      = new Date().toISOString().split("T")[0],
  maxResults   = 100,
  proxyConfig  = { useApifyProxy: true },
} = input;

console.log(`Scraping MCA companies from ${startDate} to ${endDate}, max ${maxResults}`);

const dataset = await Actor.openDataset();
let scraped = 0;

const crawler = new PuppeteerCrawler({
  proxyConfiguration: await Actor.createProxyConfiguration(proxyConfig),
  maxConcurrency: 1,          // MCA blocks concurrent requests
  requestHandlerTimeoutSecs: 60,

  launchContext: {
    launchOptions: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  },

  async requestHandler({ page, request }) {
    // MCA company search URL
    const url = `https://www.mca.gov.in/mcafoportal/viewRecentFilings.do`;

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });
    await sleep(2000);

    // Check for CAPTCHA
    const captcha = await page.$("iframe[src*='recaptcha']");
    if (captcha) {
      console.warn("CAPTCHA detected — skipping this request");
      return;
    }

    // ── Try the MCA API endpoint (more reliable than scraping HTML) ────────
    // MCA21 has an undocumented JSON API used by their own frontend
    const apiResponse = await page.evaluate(async (startDate, endDate, maxResults) => {
      try {
        const res = await fetch(
          `/mcafoportal/getLatestFilings.do?startDate=${startDate}&endDate=${endDate}&rows=${maxResults}`,
          {
            headers: {
              "X-Requested-With": "XMLHttpRequest",
              "Accept": "application/json",
            },
            credentials: "include",
          }
        );
        if (res.ok) return res.json();
        return null;
      } catch {
        return null;
      }
    }, startDate, endDate, maxResults);

    if (apiResponse?.data?.length > 0) {
      for (const company of apiResponse.data) {
        await dataset.pushData({
          cin:                  company.cin ?? company.CIN,
          companyName:          company.companyName ?? company.COMPANY_NAME,
          dateOfIncorporation:  company.dateOfIncorporation ?? company.DATE_OF_INC,
          companyClass:         company.companyClass ?? company.CLASS_OF_COMPANY,
          companyCategory:      company.companyCategory,
          companySubCategory:   company.companySubCategory,
          authorizedCapital:    company.authorizedCapital,
          paidUpCapital:        company.paidUpCapital,
          registeredState:      company.state ?? company.REGISTERED_STATE,
          registeredAddress:    company.registeredAddress,
          email:                company.email,
          companyStatus:        company.companyStatus ?? "Active",
          registrarOfCompanies: company.rocCode,
          nicCode:              company.nicCode,
          scrapedAt:            new Date().toISOString(),
        });
        scraped++;
      }
      console.log(`Scraped ${scraped} companies via MCA JSON API`);
      return;
    }

    // ── Fallback: scrape HTML table ────────────────────────────────────────
    // Navigate to the new companies list page
    await page.goto(
      `https://www.mca.gov.in/mcafoportal/viewNewlyRegisteredCompanies.do`,
      { waitUntil: "networkidle2", timeout: 30_000 }
    );
    await sleep(1500);

    const rows = await page.$$eval("table.tablesorter tbody tr", (trs) =>
      trs.map((tr) => {
        const tds = Array.from(tr.querySelectorAll("td"));
        return {
          cin:                 tds[0]?.textContent?.trim() ?? "",
          companyName:         tds[1]?.textContent?.trim() ?? "",
          dateOfIncorporation: tds[2]?.textContent?.trim() ?? "",
          companyClass:        tds[3]?.textContent?.trim() ?? "",
          registeredState:     tds[4]?.textContent?.trim() ?? "",
          companyStatus:       "Active",
          scrapedAt:           new Date().toISOString(),
        };
      }).filter((r) => r.cin.length > 5)
    );

    for (const row of rows.slice(0, maxResults - scraped)) {
      await dataset.pushData(row);
      scraped++;
    }

    console.log(`Scraped ${scraped} companies via HTML fallback`);
  },

  failedRequestHandler({ request, error }) {
    console.error(`Request ${request.url} failed: ${error.message}`);
  },
});

await crawler.run([{
  url: "https://www.mca.gov.in/mcafoportal/viewNewlyRegisteredCompanies.do",
  userData: { startDate, endDate },
}]);

console.log(`Actor finished. Total companies scraped: ${scraped}`);
await Actor.exit();
