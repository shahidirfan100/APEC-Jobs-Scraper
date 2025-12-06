// APEC Jobs scraper - PlaywrightCrawler (SPA) implementation
import { Actor, log } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';
import { load as cheerioLoad } from 'cheerio';

const SELECTORS = {
    listItem: 'li.list-annonce__item',
    titleLink: 'h2.list-annonce__title a',
    company: 'p.list-annonce__entreprise',
    location: 'p.list-annonce__localisation',
    salary: 'span.list-annonce__salaire',
    date: 'time.list-annonce__date, span.list-annonce__date',
    paginationNext: 'button.pagination__btn--next',
    listFallbackItem: 'article.card-offre',
    listFallbackTitleLink: 'article.card-offre h2 a, article.card-offre h2.card-title a',
    listFallbackCompany: 'article.card-offre .card-company, article.card-offre [class*="company"]',
    listFallbackLocation: 'article.card-offre .card-location, article.card-offre [class*="location"]',
    listFallbackSalary: 'article.card-offre .card-salary, article.card-offre [class*="salaire"]',
    detailDescription: 'div.offre-description__content',
    detailMetadata: 'div.offre-informations__meta',
};

const buildSearchUrl = ({ keyword, location, department }) => {
    const u = new URL('https://www.apec.fr/candidat/recherche-emploi.html/emploi');
    if (keyword) u.searchParams.set('motsCles', keyword);
    if (location) u.searchParams.set('lieux', location);
    else if (department) u.searchParams.set('lieux', department);
    return u.href;
};

const defaultUserAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36';

const cleanText = (html) => {
    if (!html) return null;
    const $ = cheerioLoad(html);
    $('script, style, noscript').remove();
    return $.root().text().replace(/\s+/g, ' ').trim();
};

await Actor.init();

async function main() {
    const input = (await Actor.getInput()) || {};
    const {
        startUrl,
        keyword = '',
        location = '',
        department = '',
        collectDetails = true,
        results_wanted: RESULTS_WANTED_RAW = 50,
        max_pages: MAX_PAGES_RAW = 5,
        maxConcurrency = 2,
        proxyConfiguration,
    } = input;

    const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : 1;
    const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 1;

    const initialUrl = startUrl || buildSearchUrl({ keyword: keyword.trim(), location: location.trim(), department: department.trim() });
    const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;

    const seenDetailUrls = new Set();
    const seenListingUrls = new Set();
    let saved = 0;

    const crawler = new PlaywrightCrawler({
        proxyConfiguration: proxyConf,
        maxRequestRetries: 2,
        maxConcurrency,
        headless: true,
        requestHandlerTimeoutSecs: 90,
        navigationTimeoutSecs: 45,
        launchContext: {
            useIncognitoPages: true,
            launchOptions: {
                headless: true,
            },
        },
        preNavigationHooks: [
            async ({ page, request }, gotoOptions) => {
                await page.setExtraHTTPHeaders({
                    'User-Agent': defaultUserAgent,
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8',
                    Referer: request.loadedUrl || request.url,
                });
                gotoOptions.waitUntil = 'networkidle';
            },
        ],
        async requestHandler({ request, page, enqueueLinks, log: crawlerLog }) {
            const label = request.userData?.label || 'LIST';
            const pageNo = request.userData?.pageNo || 0;

            if (label === 'LIST') {
                if (seenListingUrls.has(request.url)) return;
                seenListingUrls.add(request.url);

                crawlerLog.info(`LIST page ${pageNo}: ${request.url}`);

                try {
                    // Wait for either primary or fallback listing selectors
                    await page.waitForSelector(`${SELECTORS.listItem}, ${SELECTORS.listFallbackItem}`, { timeout: 20000 });
                } catch (e) {
                    crawlerLog.warning(`No listings found on page ${pageNo}, skipping. (${e.message})`);
                    return;
                }

                const jobsPrimary = await page.$$eval(SELECTORS.listItem, (items, selectors) => {
                    return items
                        .map((item) => {
                            const getText = (sel) => {
                                const el = item.querySelector(sel);
                                return el ? el.textContent.trim() : null;
                            };
                            const linkEl = item.querySelector(selectors.titleLink);
                            const url = linkEl ? linkEl.href : null;
                            const title = linkEl ? linkEl.textContent.trim() : null;
                            const company = getText(selectors.company);
                            const location = getText(selectors.location);
                            const salary = getText(selectors.salary);
                            const date_posted = getText(selectors.date);
                            return { url, title, company, location, salary, date_posted };
                        })
                        .filter((j) => j.url);
                }, SELECTORS);

                const jobsFallback = await page.$$eval(SELECTORS.listFallbackItem, (items, selectors) => {
                    return items
                        .map((item) => {
                            const getText = (sel) => {
                                const el = item.querySelector(sel);
                                return el ? el.textContent.trim() : null;
                            };
                            const linkEl = item.querySelector(selectors.listFallbackTitleLink);
                            const url = linkEl ? linkEl.href : null;
                            const title = linkEl ? linkEl.textContent.trim() : null;
                            const company = getText(selectors.listFallbackCompany);
                            const location = getText(selectors.listFallbackLocation);
                            const salary = getText(selectors.listFallbackSalary);
                            return { url, title, company, location, salary };
                        })
                        .filter((j) => j.url);
                }, SELECTORS);

                const jobs = [...jobsPrimary, ...jobsFallback];

                crawlerLog.info(`Found ${jobs.length} jobs on page ${pageNo}`);

                if (!jobs.length) return;

                for (const job of jobs) {
                    if (saved >= RESULTS_WANTED) break;
                    if (seenDetailUrls.has(job.url)) continue;
                    seenDetailUrls.add(job.url);

                    if (collectDetails) {
                        await enqueueLinks({
                            urls: [job.url],
                            userData: { label: 'DETAIL', jobData: job },
                        });
                    } else {
                        await Dataset.pushData({
                            ...job,
                            job_type: null,
                            description: null,
                            metadata: {},
                            fetched_at: new Date().toISOString(),
                            applyLink: job.url,
                            url: job.url,
                            id: job.url,
                            source: 'listing',
                        });
                        saved += 1;
                    }
                }

                if (saved >= RESULTS_WANTED) return;

                if (pageNo + 1 < MAX_PAGES) {
                    const nextButton = await page.$(SELECTORS.paginationNext);
                    if (nextButton) {
                        const disabled = await nextButton.getAttribute('disabled');
                        if (!disabled) {
                            await Promise.all([
                                page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => null),
                                nextButton.click(),
                            ]);
                            await page.waitForTimeout(1500);
                            const nextUrl = page.url();
                            if (!seenListingUrls.has(nextUrl)) {
                                await enqueueLinks({
                                    urls: [nextUrl],
                                    userData: { label: 'LIST', pageNo: pageNo + 1 },
                                });
                            }
                        }
                    }
                }
                return;
            }

            if (label === 'DETAIL') {
                if (saved >= RESULTS_WANTED) return;
                const base = request.userData?.jobData || {};

                await page.waitForSelector(`${SELECTORS.detailDescription}, ${SELECTORS.detailMetadata}`, { timeout: 20000 }).catch(() => null);

                const descriptionHtml = await page.$eval(SELECTORS.detailDescription, (el) => el.innerHTML).catch(() => null);
                const description = descriptionHtml ? cleanText(descriptionHtml) : null;

                const metadataPairs = await page.$$eval(SELECTORS.detailMetadata + ' *', (nodes) => {
                    const pairs = [];
                    nodes.forEach((node) => {
                        const key = node.querySelector('span, strong, b');
                        const val = node.querySelector('p, div, span:nth-child(2), span + span');
                        if (key && val) {
                            pairs.push([key.textContent.trim(), val.textContent.trim()]);
                        }
                    });
                    return pairs;
                }).catch(() => []);

                const metadata = {};
                for (const [k, v] of metadataPairs) {
                    if (k) metadata[k] = v;
                }

                const item = {
                    id: request.url,
                    title: base.title || null,
                    company: base.company || null,
                    location: base.location || null,
                    salary: base.salary || null,
                    job_type: metadata['Contrat'] || metadata['Type de contrat'] || null,
                    description: description || null,
                    metadata,
                    description_html: descriptionHtml || null,
                    description_text: description || null,
                    applyLink: request.url,
                    url: request.url,
                    fetched_at: new Date().toISOString(),
                    source: 'detail',
                };

                await Dataset.pushData(item);
                saved += 1;
                crawlerLog.info(`Saved job (${saved}/${RESULTS_WANTED}): ${item.title || 'Untitled'}`);
            }
        },
        failedRequestHandler({ request }) {
            log.warning(`Request failed: ${request.url}`);
        },
    });

    await crawler.run([{ url: initialUrl, userData: { label: 'LIST', pageNo: 0 } }]);
    log.info(`Finished. Saved ${saved} items.`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
