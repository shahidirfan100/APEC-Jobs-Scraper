// APEC Jobs scraper - API-first with HTML fallback
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { load as cheerioLoad } from 'cheerio';
import { gotScraping } from 'got-scraping';
import { HeaderGenerator } from 'header-generator';

await Actor.init();

// ---- Configuration helpers -------------------------------------------------
const API_PAGE_SIZE = 20;

const headerGenerator = new HeaderGenerator({
    browsers: [{ name: 'chrome', minVersion: 112 }],
    devices: ['desktop'],
    operatingSystems: ['windows', 'macos'],
    locales: ['fr-FR', 'fr', 'en-US'],
});

const buildHeaders = () => {
    const generated = headerGenerator.getHeaders({
        httpVersion: '2',
        browsers: ['chrome'],
    });
    return {
        ...generated,
        Accept: generated.Accept || 'application/json, text/plain, */*',
        'Accept-Language': generated['Accept-Language'] || 'fr-FR,fr;q=0.9,en-US;q=0.8',
        'Content-Type': 'application/json',
        'User-Agent': generated['User-Agent'] || generated['user-agent'],
    };
};

const toAbs = (href, base = 'https://www.apec.fr') => {
    if (!href) return null;
    try {
        return new URL(href, base).href;
    } catch {
        return null;
    }
};

const normalizeArray = (value) => {
    if (Array.isArray(value)) return value.filter(Boolean).map(String);
    if (typeof value === 'string') {
        return value.split(',').map((s) => s.trim()).filter(Boolean);
    }
    return [];
};

const cleanText = (html) => {
    if (!html) return '';
    const $ = cheerioLoad(html);
    $('script, style, noscript, iframe').remove();
    return $.root().text().replace(/\s+/g, ' ').trim();
};

const parseSearchFromUrl = (urlStr) => {
    const res = {};
    try {
        const u = new URL(urlStr);
        res.motsCles = u.searchParams.get('motsCles') || u.searchParams.get('keyword') || undefined;
        res.lieux = u.searchParams.get('lieux') || u.searchParams.get('location') || undefined;
        const tc = [
            ...u.searchParams.getAll('typesConvention'),
            ...(u.searchParams.get('typesConvention') ? u.searchParams.get('typesConvention').split(',') : []),
        ].filter(Boolean);
        const tele = [
            ...u.searchParams.getAll('teletravail'),
            ...(u.searchParams.get('teletravail') ? u.searchParams.get('teletravail').split(',') : []),
        ].filter(Boolean);
        if (tc.length) res.typesConvention = tc;
        if (tele.length) res.teletravail = tele;
    } catch {
        // ignore
    }
    return res;
};

const buildSearchParams = (input, urlDerived = {}) => {
    const params = {
        motsCles: input.keyword?.trim() || urlDerived.motsCles,
        lieux: input.location?.trim() || input.department?.trim() || urlDerived.lieux,
        typesConvention: normalizeArray(input.contractType || urlDerived.typesConvention),
        teletravail: normalizeArray(input.remoteWork || urlDerived.teletravail),
    };
    return params;
};

const buildSearchUrl = (searchParams) => {
    const u = new URL('https://www.apec.fr/candidat/recherche-emploi.html/emploi');
    if (searchParams.motsCles) u.searchParams.set('motsCles', searchParams.motsCles);
    if (searchParams.lieux) u.searchParams.set('lieux', searchParams.lieux);
    (searchParams.typesConvention || []).forEach((tc) => u.searchParams.append('typesConvention', tc));
    (searchParams.teletravail || []).forEach((t) => u.searchParams.append('teletravail', t));
    return u.href;
};

// ---- API handling ----------------------------------------------------------
const API_ENDPOINTS = [
    { method: 'POST', url: 'https://www.apec.fr/cms/webapi/content/offers/search' },
    { method: 'POST', url: 'https://www.apec.fr/cms/webapi/content/offer-search' },
    { method: 'GET', url: 'https://www.apec.fr/cms/webapi/content/offer-search' },
];

const normalizeApiResponse = (body) => {
    const container = body?.result || body;
    const offers = container?.offers || container?.offres || container?.items || [];
    const total = container?.totalCount || container?.total || container?.totalElements || offers.length || 0;
    return { offers: Array.isArray(offers) ? offers : [], total };
};

const mapApiJob = (job) => ({
    title: job.intitule || job.title || job.libelle || null,
    company: job.entreprise?.nom || job.company || job.recruteur || null,
    location: job.lieuTravail?.libelle || job.lieuTravail || job.location || job.lieu || null,
    salary: job.salaire?.libelle || job.salary || null,
    job_type: job.typeContrat?.libelle || job.contrat?.libelle || job.job_type || null,
    date_posted: job.datePublication || job.dateDePublication || job.datePosted || null,
    description_text: job.description || job.desc || null,
    description_html: job.descriptionHtml || job.description_html || null,
    url: toAbs(job.url || job.lien || job.link || `/candidat/recherche-emploi.html/emploi/detail-offre/${job.id || job.reference}`),
    experience: job.experience?.libelle || job.experience || null,
    remote_work: job.teletravail || job.remote || null,
    source: 'api',
    fetched_at: new Date().toISOString(),
});

const fetchJobsViaApi = async (pageNum, searchParams, proxyConf) => {
    for (const endpoint of API_ENDPOINTS) {
        try {
            let url = endpoint.url;
            const payload = {
                pageNumber: pageNum,
                page: pageNum,
                pageSize: API_PAGE_SIZE,
                size: API_PAGE_SIZE,
                motsCles: searchParams.motsCles || undefined,
                lieux: searchParams.lieux || undefined,
                typesConvention: searchParams.typesConvention || undefined,
                teletravail: searchParams.teletravail || undefined,
            };

            const reqOptions = {
                url,
                method: endpoint.method,
                headers: buildHeaders(),
                responseType: 'json',
                timeout: { request: 20000 },
                proxyUrl: proxyConf?.newUrl ? await proxyConf.newUrl() : undefined,
            };

            if (endpoint.method === 'POST') {
                reqOptions.json = payload;
            } else {
                const u = new URL(url);
                u.searchParams.set('page', String(pageNum));
                u.searchParams.set('size', String(API_PAGE_SIZE));
                if (searchParams.motsCles) u.searchParams.set('motsCles', searchParams.motsCles);
                if (searchParams.lieux) u.searchParams.set('lieux', searchParams.lieux);
                (searchParams.typesConvention || []).forEach((tc) => u.searchParams.append('typesConvention', tc));
                (searchParams.teletravail || []).forEach((t) => u.searchParams.append('teletravail', t));
                reqOptions.url = u.href;
            }

            const res = await gotScraping(reqOptions);
            const { offers, total } = normalizeApiResponse(res.body);
            if (offers.length) {
                return {
                    jobs: offers.map(mapApiJob),
                    totalCount: total,
                };
            }
        } catch (err) {
            log.debug(`API endpoint ${endpoint.url} failed: ${err.message}`);
        }
    }
    return { jobs: [], totalCount: 0 };
};

// ---- HTML parsing helpers --------------------------------------------------
const extractFromJsonLd = ($) => {
    const scripts = $('script[type="application/ld+json"]');
    for (let i = 0; i < scripts.length; i++) {
        try {
            const parsed = JSON.parse($(scripts[i]).html() || '');
            const arr = Array.isArray(parsed) ? parsed : [parsed];
            for (const e of arr) {
                if (!e) continue;
                const t = e['@type'] || e.type;
                const isJob = t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'));
                if (isJob) {
                    return {
                        title: e.title || e.name || null,
                        company: e.hiringOrganization?.name || null,
                        date_posted: e.datePosted || null,
                        description_html: e.description || null,
                        location:
                            e.jobLocation?.address?.addressLocality ||
                            e.jobLocation?.address?.addressRegion ||
                            null,
                        salary: e.baseSalary?.value?.value || e.baseSalary?.value || null,
                        job_type: e.employmentType || null,
                    };
                }
            }
        } catch {
            // ignore
        }
    }
    return null;
};

const extractJobsFromCards = ($, baseUrl) => {
    const jobs = [];
    $('article.card-offre, article[data-offer-id]').each((_, card) => {
        const $card = $(card);
        const link = $card.find('a[href*="/detail-offre/"], h2 a').first();
        const jobUrl = toAbs(link.attr('href'), baseUrl);
        if (!jobUrl) return;
        const title = link.text().trim();
        const company =
            $card.find('.card-company, [class*="company"], [class*="entreprise"]').first().text().trim() || null;
        const location =
            $card.find('.card-location, [class*="location"], [class*="lieu"]').first().text().trim() || null;
        const salary = $card.find('.card-salary, [class*="salaire"]').first().text().trim() || null;
        const contract = $card.find('[class*="contract"], [class*="contrat"]').first().text().trim() || null;
        const date = $card.find('[class*="date"]').first().text().trim() || null;

        jobs.push({
            url: jobUrl,
            title: title || null,
            company,
            location,
            salary,
            job_type: contract,
            date_posted: date,
            source: 'html-listing',
            fetched_at: new Date().toISOString(),
        });
    });
    return jobs;
};

const findJobLinks = ($, baseUrl) => {
    const links = new Set();
    $('a[href*="/detail-offre/"], article.card-offre h2 a').each((_, a) => {
        const href = $(a).attr('href');
        const abs = toAbs(href, baseUrl);
        if (abs) links.add(abs);
    });
    return [...links];
};

const findNextPage = ($, currentUrl, currentPage) => {
    const href =
        $('a.pagination__next, a[rel="next"], a[aria-label="Next"]').first().attr('href') ||
        $('button[aria-label="Next"], button[aria-label="Suivant"]').first().attr('data-href');
    if (href) return toAbs(href, currentUrl);

    try {
        const u = new URL(currentUrl);
        const next = currentPage + 1;
        u.searchParams.set('page', String(next));
        return u.href;
    } catch {
        return null;
    }
};

const parseDetailPage = ($, requestUrl, baseItem = {}) => {
    const json = extractFromJsonLd($) || {};
    const data = { ...baseItem, ...json };

    data.title =
        data.title ||
        $('h1, .offer-title, [class*="title"]').first().text().trim() ||
        null;
    data.company =
        data.company ||
        $('.company-name, [class*="company"], [class*="entreprise"]').first().text().trim() ||
        null;
    data.location =
        data.location ||
        $('.job-location, [class*="location"], [class*="lieu"]').first().text().trim() ||
        null;
    data.salary =
        data.salary ||
        $('.salary, [class*="salary"], [class*="salaire"]').first().text().trim() ||
        null;
    data.job_type =
        data.job_type ||
        $('.contract-type, [class*="contract"], [class*="contrat"]').first().text().trim() ||
        null;
    data.date_posted =
        data.date_posted ||
        $('.date-posted, [class*="date"]').first().text().trim() ||
        null;

    if (!data.description_html) {
        const desc =
            $('div.job-description-content, [class*="description"], .offer-content, .job-description').first();
        if (desc && desc.length) data.description_html = String(desc.html()).trim();
    }
    data.description_text = data.description_text || (data.description_html ? cleanText(data.description_html) : null);

    if (!data.experience) {
        data.experience =
            $('li:contains("experience"), li:contains("expérience"), .experience, [class*="experience"]')
                .first()
                .text()
                .trim() || null;
    }

    if (!data.remote_work) {
        data.remote_work =
            $('li:contains("télétravail"), li:contains("remote"), [class*="teletravail"], [class*="remote"]')
                .first()
                .text()
                .trim() || null;
    }

    return {
        ...data,
        url: requestUrl,
        source: data.source || 'html-detail',
        fetched_at: data.fetched_at || new Date().toISOString(),
    };
};

// ---- Main ------------------------------------------------------------------
async function main() {
    const input = (await Actor.getInput()) || {};
    const {
        keyword = '',
        location = '',
        department = '',
        contractType = [],
        remoteWork = [],
        startUrl,
        startUrls = [],
        url,
        results_wanted: RESULTS_WANTED_RAW = 100,
        max_pages: MAX_PAGES_RAW = 5,
        collectDetails = true,
        useApi = true,
        logLevel = 'INFO',
        proxyConfiguration,
        maxConcurrency = 8,
        requestDelayMillis = 0,
    } = input;

    log.setLevel(String(logLevel).toLowerCase());

    const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : 1;
    const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 1;
    const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;

    const initialUrls = [];
    if (Array.isArray(startUrls) && startUrls.length) initialUrls.push(...startUrls.filter(Boolean));
    if (startUrl) initialUrls.push(startUrl);
    if (url) initialUrls.push(url);

    const derivedParams = initialUrls.length ? parseSearchFromUrl(initialUrls[0]) : {};
    const searchParams = buildSearchParams(
        { keyword, location, department, contractType, remoteWork },
        derivedParams,
    );
    if (!initialUrls.length) initialUrls.push(buildSearchUrl(searchParams));

    const seenUrls = new Set();
    let saved = 0;

    const requestQueue = await Actor.openRequestQueue();
    for (const u of initialUrls) {
        await requestQueue.addRequest({ url: u, userData: { label: 'LIST', pageNo: 0, searchParams, allowApi: true } });
    }

    const pushItem = async (item) => {
        const key = item.url || `${item.title || ''}-${item.company || ''}-${item.date_posted || ''}`;
        if (seenUrls.has(key)) return;
        seenUrls.add(key);
        await Dataset.pushData(item);
        saved += 1;
        log.debug(`Saved ${saved}/${RESULTS_WANTED}: ${item.title || 'Untitled'}`);
    };

    const crawler = new CheerioCrawler({
        requestQueue,
        proxyConfiguration: proxyConf,
        maxRequestRetries: 2,
        useSessionPool: true,
        maxConcurrency,
        requestHandlerTimeoutSecs: 70,
        async requestHandler({ request, $, log: crawlerLog }) {
            const label = request.userData?.label || 'LIST';
            const pageNo = request.userData?.pageNo || 0;
            const search = request.userData?.searchParams || searchParams;
            const allowApi = request.userData?.allowApi !== false;

            if (requestDelayMillis) {
                const jitter = Math.floor(requestDelayMillis * 0.25 * Math.random());
                await Actor.sleep(requestDelayMillis + jitter);
            }

            if (label === 'LIST') {
                crawlerLog.info(`LIST page ${pageNo}: ${request.url}`);

                // API first
                if (useApi && allowApi) {
                    const apiRes = await fetchJobsViaApi(pageNo, search, proxyConf);
                    crawlerLog.debug(`API page ${pageNo} returned ${apiRes.jobs.length} jobs (total ${apiRes.totalCount})`);

                    if (apiRes.jobs.length) {
                        const remaining = RESULTS_WANTED - saved;
                        const jobs = apiRes.jobs.slice(0, remaining);

                        for (const job of jobs) {
                            if (saved >= RESULTS_WANTED) break;
                            if (collectDetails && job.url) {
                                await requestQueue.addRequest({
                                    url: job.url,
                                    userData: { label: 'DETAIL', baseItem: job },
                                });
                            } else {
                                await pushItem(job);
                            }
                        }

                        const shouldContinue =
                            saved < RESULTS_WANTED &&
                            apiRes.jobs.length === API_PAGE_SIZE &&
                            pageNo + 1 < MAX_PAGES;
                        if (shouldContinue) {
                            await requestQueue.addRequest({
                                url: request.url,
                                userData: { label: 'LIST', pageNo: pageNo + 1, searchParams: search, allowApi: true },
                            });
                        }
                        return;
                    }
                    crawlerLog.info('API returned no jobs, falling back to HTML.');
                }

                // HTML fallback: either listing-only or enqueue details
                if (!collectDetails) {
                    const jobs = extractJobsFromCards($, request.url);
                    crawlerLog.info(`HTML listing found ${jobs.length} cards`);
                    const remaining = RESULTS_WANTED - saved;
                    for (const job of jobs.slice(0, remaining)) {
                        if (saved >= RESULTS_WANTED) break;
                        await pushItem(job);
                    }
                } else {
                    const links = findJobLinks($, request.url);
                    crawlerLog.info(`Found ${links.length} detail links`);
                    const remaining = RESULTS_WANTED - saved;
                    for (const link of links.slice(0, remaining)) {
                        await requestQueue.addRequest({ url: link, userData: { label: 'DETAIL' } });
                    }
                }

                if (saved >= RESULTS_WANTED) return;

                if (pageNo + 1 < MAX_PAGES) {
                    const next = findNextPage($, request.url, pageNo);
                    if (next) {
                        crawlerLog.info(`Enqueuing next page: ${next}`);
                        await requestQueue.addRequest({
                            url: next,
                            userData: { label: 'LIST', pageNo: pageNo + 1, searchParams: search, allowApi: !useApi ? false : allowApi },
                        });
                    }
                }
                return;
            }

            if (label === 'DETAIL') {
                if (saved >= RESULTS_WANTED) return;
                try {
                    const item = parseDetailPage($, request.url, request.userData?.baseItem || {});
                    await pushItem(item);
                } catch (err) {
                    crawlerLog.error(`DETAIL ${request.url} failed: ${err.message}`);
                }
            }
        },
        failedRequestHandler({ request }) {
            log.warning(`Request ${request.url} failed too many times.`);
        },
    });

    await crawler.run();
    log.info(`Finished. Saved ${saved} items`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
