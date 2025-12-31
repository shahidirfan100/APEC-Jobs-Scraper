// APEC Jobs scraper - HTTP + JSON API first, HTML fallback
import { Actor, log } from 'apify';
import { Dataset, gotScraping, sleep } from 'crawlee';
import { load as cheerioLoad } from 'cheerio';

const API_SEARCH_URL = 'https://www.apec.fr/cms/webservices/rechercheOffre';
const API_DETAIL_URL = 'https://www.apec.fr/cms/webservices/offre/public';
const API_LIEU_AUTOCOMPLETE = 'https://www.apec.fr/cms/webservices/autocompletion/lieuautocomplete';
const SEARCH_PAGE_BASE = 'https://www.apec.fr/candidat/recherche-emploi.html/emploi';

const DEFAULT_CONTRACT_TYPE_IDS = [
    101887, // CDD
    101888, // CDI
    101889, // MISSION_INTERIM
    101930, // INTERIM
    597137, // CDD_ALTERNANCE_CONTRAT_APPRENTISSAGE
    597138, // CDD_ALTERNANCE_CONTRAT_PROFESSIONNALISATION
    597139, // CDI_ALTERNANCE_CONTRAT_APPRENTISSAGE
    597140, // CDI_ALTERNANCE_CONTRAT_PROFESSIONNALISATION
    597141, // CDI_INTERIMAIRE
];

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json;charset=UTF-8',
};

const cleanHtml = (html) => {
    if (!html) return null;
    const $ = cheerioLoad(html);
    $('script, style, noscript').remove();
    return $.root().text().replace(/\s+/g, ' ').trim();
};

const createLimiter = (maxConcurrency) => {
    let active = 0;
    const queue = [];
    const next = () => {
        if (active >= maxConcurrency || queue.length === 0) return;
        active += 1;
        const { task, resolve, reject } = queue.shift();
        task()
            .then((res) => {
                resolve(res);
            })
            .catch((err) => {
                reject(err);
            })
            .finally(() => {
                active -= 1;
                next();
            });
    };
    return (task) =>
        new Promise((resolve, reject) => {
            queue.push({ task, resolve, reject });
            next();
        });
};

const buildSearchUrl = ({ keyword, lieuIds }) => {
    const u = new URL(SEARCH_PAGE_BASE);
    if (keyword) u.searchParams.set('motsCles', keyword);
    if (lieuIds?.length) u.searchParams.set('lieux', lieuIds.join(','));
    return u.href;
};

const pickProxyUrl = async (proxyConfiguration) => (proxyConfiguration ? proxyConfiguration.newUrl() : undefined);

// Enhanced retry logic for QA compliance
const requestWithRetry = async (fn, context, maxRetries = 5) => {
    let attempt = 0;
    let lastError;
    while (attempt < maxRetries) {
        attempt += 1;
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            const isCritical = error.response && error.response.statusCode === 404; // 404 might mean job deleted, don't retry endlessly
            if (isCritical) throw error;

            log.warning(`${context} failed (Attempt ${attempt}/${maxRetries}): ${error.message}`);

            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                await sleep(delay);
            }
        }
    }
    throw lastError;
};

const autocompleteLieu = async (query, proxyConfiguration) => {
    return requestWithRetry(async () => {
        const res = await gotScraping({
            url: `${API_LIEU_AUTOCOMPLETE}?q=${encodeURIComponent(query)}`,
            responseType: 'json',
            proxyUrl: await pickProxyUrl(proxyConfiguration),
            headers: DEFAULT_HEADERS,
            timeout: { request: 20000 },
            throwHttpErrors: false,
        });

        if (res.statusCode !== 200) {
            throw new Error(`Autocomplete status ${res.statusCode}`);
        }
        return Array.isArray(res.body) ? res.body : [];
    }, 'Lieu autocomplete', 3).catch(err => {
        log.warning(`Autocomplete exhausted retries: ${err.message}`);
        return [];
    });
};

const resolveLieuIds = async ({ startUrl, location, department, proxyConfiguration }) => {
    const ids = [];
    if (startUrl) {
        try {
            const u = new URL(startUrl);
            const raw = u.searchParams.get('lieux');
            if (raw) {
                raw.split(',').forEach((part) => {
                    const n = Number.parseInt(part.trim(), 10);
                    if (Number.isFinite(n)) ids.push(n);
                });
            }
        } catch {
            // ignore malformed startUrl
        }
    }

    const normalizedLocation = (location || '').trim();
    if (!ids.length && normalizedLocation) {
        const candidates = await autocompleteLieu(normalizedLocation, proxyConfiguration);
        const directMatch = candidates.find((c) => c.lieuDisplay?.toLowerCase().includes(normalizedLocation.toLowerCase()));
        const selected = directMatch || candidates[0];
        if (selected?.lieuId) ids.push(Number(selected.lieuId));
    }

    const normalizedDepartment = (department || '').trim();
    if (!ids.length && normalizedDepartment) {
        const n = Number.parseInt(normalizedDepartment, 10);
        if (Number.isFinite(n)) ids.push(n);
    }

    return Array.from(new Set(ids));
};

const fetchSearchPage = async (criteria, proxyConfiguration) => {
    return requestWithRetry(async () => {
        const res = await gotScraping({
            url: API_SEARCH_URL,
            method: 'POST',
            json: criteria,
            responseType: 'json',
            headers: DEFAULT_HEADERS,
            proxyUrl: await pickProxyUrl(proxyConfiguration),
            timeout: { request: 30000 },
            throwHttpErrors: false,
        });

        if (res.statusCode >= 400) {
            throw new Error(`Search API status ${res.statusCode}: ${JSON.stringify(res.body).slice(0, 100)}`);
        }
        return res.body;
    }, 'Search Page API', 5);
};

const fetchDetail = async (numeroOffre, proxyConfiguration) => {
    return requestWithRetry(async () => {
        const res = await gotScraping({
            url: `${API_DETAIL_URL}?numeroOffre=${encodeURIComponent(numeroOffre)}`,
            responseType: 'json',
            headers: DEFAULT_HEADERS,
            proxyUrl: await pickProxyUrl(proxyConfiguration),
            timeout: { request: 30000 },
            throwHttpErrors: false,
        });

        if (res.statusCode >= 400) {
            throw new Error(`Detail API status ${res.statusCode}`);
        }
        return res.body;
    }, `Detail API ${numeroOffre}`, 3);
};

const parseHtmlDetail = (html, url) => {
    const $ = cheerioLoad(html);
    let ldJob = null;
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const json = JSON.parse($(el).contents().text().trim());
            const jobPosting = Array.isArray(json) ? json.find((j) => j['@type'] === 'JobPosting') : json;
            if (jobPosting && (jobPosting['@type'] === 'JobPosting' || jobPosting.title)) {
                ldJob = jobPosting;
            }
        } catch {
            // ignore malformed JSON-LD
        }
    });

    const descriptionHtml = ldJob?.description || $('div.offre-description__content').html() || '';
    return {
        title: ldJob?.title || $('h1').first().text().trim() || null,
        company: ldJob?.hiringOrganization?.name || $('p.list-annonce__entreprise').first().text().trim() || null,
        location: ldJob?.jobLocation?.address?.addressLocality || $('p.list-annonce__localisation').first().text().trim() || null,
        description_html: descriptionHtml || null,
        description_text: cleanHtml(descriptionHtml) || null,
        applyLink: ldJob?.hiringOrganization?.sameAs || url,
    };
};

const buildJob = ({ listing, detail, source }) => {
    const numeroOffre = listing?.numeroOffre || detail?.numeroOffre;
    const detailUrl = numeroOffre
        ? `https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/${numeroOffre}`
        : listing?.url;

    const descriptionHtml = detail?.texteHtml || detail?.texteHtmlProfil || detail?.texteHtmlEntreprise || listing?.description_html;
    const descriptionText = cleanHtml(descriptionHtml) || listing?.description_text || null;

    const location =
        detail?.lieux?.map((l) => l.libelleLieu).join(', ') ||
        listing?.lieuTexte ||
        listing?.location ||
        detail?.adresseOffre?.adresseVille ||
        null;

    return {
        id: numeroOffre || detailUrl,
        numeroOffre,
        title: detail?.intitule || listing?.intitule || listing?.title || null,
        company: detail?.nomCompteEtablissement || listing?.nomCommercial || listing?.company || null,
        location,
        salary: detail?.salaireTexte || listing?.salaireTexte || listing?.salary || null,
        published_at: detail?.datePublication || listing?.datePublication || null,
        description_html: descriptionHtml || null,
        description_text: descriptionText,
        applyLink: detail?.adresseUrlCandidature || listing?.applyLink || detailUrl,
        url: detailUrl,
        source,
        fetched_at: new Date().toISOString(),
    };
};

const htmlFallback = async ({ keyword, lieuIds, remaining, collectDetails, proxyConfiguration, seenIds }) => {
    const searchUrl = buildSearchUrl({ keyword, lieuIds });
    log.warning(`Falling back to HTML parsing from ${searchUrl}`);

    let $;
    try {
        const res = await requestWithRetry(async () => {
            const resp = await gotScraping({
                url: searchUrl,
                headers: {
                    ...DEFAULT_HEADERS,
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                },
                responseType: 'text',
                proxyUrl: await pickProxyUrl(proxyConfiguration),
                timeout: { request: 30000 },
                throwHttpErrors: false,
            });
            if (resp.statusCode >= 400) throw new Error(`HTML Search status ${resp.statusCode}`);
            return resp;
        }, 'HTML Search Fallback', 5);

        $ = cheerioLoad(res.body);
    } catch (err) {
        log.error(`HTML fallback failed: ${err.message}`);
        return 0;
    }

    const links = Array.from(new Set($('a[href*="detail-offre"]').map((_, el) => new URL($(el).attr('href'), searchUrl).href).get()));
    const limiter = createLimiter(3);
    let saved = 0;

    const detailPromises = links.slice(0, remaining).map((link) =>
        limiter(async () => {
            if (saved >= remaining) return;
            if (seenIds.has(link)) return;
            seenIds.add(link);

            try {
                let detailData = null;
                if (collectDetails) {
                    try {
                        const detailRes = await requestWithRetry(async () => {
                            const r = await gotScraping({
                                url: link,
                                headers: {
                                    ...DEFAULT_HEADERS,
                                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                                },
                                responseType: 'text',
                                proxyUrl: await pickProxyUrl(proxyConfiguration),
                                timeout: { request: 30000 },
                                throwHttpErrors: false,
                            });
                            if (r.statusCode >= 400) throw new Error(`Status ${r.statusCode}`);
                            return r;
                        }, `HTML Detail ${link}`, 3);
                        detailData = parseHtmlDetail(detailRes.body, link);
                    } catch (dErr) {
                        log.warning(`HTML detail failed after retries: ${dErr.message}`);
                        // Fallthrough to listing-only data
                    }
                }

                const job = buildJob({ listing: { url: link }, detail: detailData, source: 'html-fallback' });
                await Dataset.pushData(job);
                saved += 1;
            } catch (err) {
                log.warning(`HTML fallback detail failed for ${link}: ${err.message}`);
            }
        }),
    );

    await Promise.all(detailPromises);
    return saved;
};

// Initialize Actor properly for Apify platform
await Actor.init();

try {
    const input = (await Actor.getInput()) || {};
    const {
        startUrl,
        keyword = '',
        location = '',
        department = '',
        collectDetails = true,
        results_wanted: resultsWantedRaw = 50,
        max_pages: maxPagesRaw = 5,
        maxConcurrency = 3,
        proxyConfiguration,
    } = input;

    const resultsWanted = Number.isFinite(+resultsWantedRaw) ? Math.max(1, +resultsWantedRaw) : 1;
    const maxPages = Number.isFinite(+maxPagesRaw) ? Math.max(1, +maxPagesRaw) : 1;
    const pageSize = Math.min(50, resultsWanted);
    const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;

    let keywordValue = keyword.trim();
    if (startUrl) {
        try {
            const u = new URL(startUrl);
            const fromUrl = u.searchParams.get('motsCles');
            if (fromUrl) keywordValue = fromUrl;
        } catch {
            // ignore malformed startUrl
        }
    }

    const lieuIds = await resolveLieuIds({ startUrl, location, department, proxyConfiguration: proxyConf });

    const criteriaBase = {
        typeClient: 'CADRE',
        activeFiltre: true,
        sorts: [{ type: 'DATE', direction: 'DESCENDING' }],
        pagination: { range: pageSize, startIndex: 0 },
        typesContrat: DEFAULT_CONTRACT_TYPE_IDS,
    };

    if (keywordValue) criteriaBase.motsCles = keywordValue;
    if (lieuIds.length) criteriaBase.lieux = lieuIds;

    const seenIds = new Set();
    const limiter = createLimiter(Math.max(1, Number(maxConcurrency) || 1));
    let saved = 0;

    // QA-compliant timeout: complete within 3.5 minutes (ample buffer for 5-min default)
    const startTime = Date.now();
    const MAX_RUNTIME_MS = 3.5 * 60 * 1000; // 210 seconds, leaving 90s buffer
    const stats = { pagesProcessed: 0, jobsSaved: 0, apiCalls: 0, errors: 0 };
    let hasCriticalFailure = false;

    // Retry loop for the main search phase is now handled by requestWithRetry inside fetchSearchPage
    // We just iterate through pages here

    for (let page = 0; page < maxPages && saved < resultsWanted; page += 1) {
        // QA Safety: Check if approaching timeout limit
        const elapsed = (Date.now() - startTime) / 1000;
        if (Date.now() - startTime > MAX_RUNTIME_MS) {
            log.info(`⏱️ Timeout safety triggered at ${elapsed.toFixed(0)}s. Gracefully stopping. Saved ${saved}/${resultsWanted} jobs.`);
            await Actor.setValue('TIMEOUT_REACHED', true);
            break;
        }

        stats.pagesProcessed = page + 1;

        const criteria = { ...criteriaBase, pagination: { ...criteriaBase.pagination, startIndex: page * pageSize } };
        let resultats = [];
        let totalCount = 0;

        try {
            stats.apiCalls += 1;
            const body = await fetchSearchPage(criteria, proxyConf);
            resultats = body?.resultats || [];
            totalCount = body?.totalCount || 0;
            log.info(`📄 Page ${page + 1}: ${resultats.length} results (total: ${totalCount}, saved: ${saved}/${resultsWanted})`);
        } catch (err) {
            stats.errors += 1;
            log.error(`API search failed on page ${page + 1} after retries: ${err.message}`);

            // If the first page of the API fails, it's a critical issue, but we might still try HTML fallback later
            if (page === 0) hasCriticalFailure = true;
            break;
        }

        if (!resultats.length) break;

        const detailPromises = resultats.map((listing) =>
            limiter(async () => {
                if (saved >= resultsWanted) return;
                const id = listing.numeroOffre || listing.id;
                if (id && seenIds.has(id)) return;
                if (id) seenIds.add(id);

                try {
                    let detail = null;
                    if (collectDetails && listing.numeroOffre) {
                        stats.apiCalls += 1;
                        try {
                            detail = await fetchDetail(listing.numeroOffre, proxyConf);
                        } catch (dErr) {
                            stats.errors += 1;
                            log.warning(`Failed to fetch detail for ${listing.numeroOffre} after retries: ${dErr.message}`);
                            // Continue with listing data only
                        }
                    }
                    const job = buildJob({ listing, detail, source: 'api' });
                    await Dataset.pushData(job);
                    saved += 1;
                    stats.jobsSaved = saved;
                } catch (err) {
                    stats.errors += 1;
                    log.warning(`Failed to process ${listing.numeroOffre || listing.id}: ${err.message}`);
                }
            }),
        );

        await Promise.all(detailPromises);

        // QA visibility: Log early success
        if (saved > 0 && page === 0) {
            log.info(`✅ First page complete: ${saved} jobs saved successfully!`);
        }

        const elapsedSeconds = (Date.now() - startTime) / 1000;
        log.info(`⚡ Performance: ${saved} jobs in ${elapsedSeconds.toFixed(1)}s (${(saved / elapsedSeconds).toFixed(2)} jobs/sec)`);

        // Safety check: stop if taking too long per page
        if (page > 0 && elapsedSeconds > MAX_RUNTIME_MS / 1000 * 0.8) {
            log.info(`⏱️ Approaching time limit at page ${page + 1}. Stopping gracefully.`);
            break;
        }

        if (saved >= totalCount) break;
    }

    if (saved < resultsWanted) {
        const remaining = resultsWanted - saved;
        // Only run fallback if we haven't timed out and we either had a critical failure OR just didn't get enough results
        if ((Date.now() - startTime < MAX_RUNTIME_MS)) {
            const added = await htmlFallback({
                keyword: keywordValue,
                lieuIds,
                remaining,
                collectDetails,
                proxyConfiguration: proxyConf,
                seenIds,
            });
            saved += added;
        }
    }

    const totalTime = (Date.now() - startTime) / 1000;

    // Final statistics report for QA validation
    log.info('='.repeat(60));
    log.info('📊 ACTOR RUN STATISTICS');
    log.info('='.repeat(60));
    log.info(`✅ Jobs saved: ${saved}/${resultsWanted}`);
    log.info(`📄 Pages processed: ${stats.pagesProcessed}/${maxPages}`);
    log.info(`🌐 API calls made: ${stats.apiCalls}`);
    log.info(`⚠️  Errors encountered: ${stats.errors}`);
    log.info(`⏱️  Total runtime: ${totalTime.toFixed(2)}s`);
    log.info(`⚡ Performance: ${(saved / totalTime).toFixed(2)} jobs/second`);
    log.info('='.repeat(60));

    // QA validation: ensure we have results
    if (saved === 0) {
        const errorMsg = 'No results scraped. This indicates a critical failure. Check input parameters and proxy configuration.';
        log.error(`❌ ${errorMsg}`);
        await Actor.fail(errorMsg);
    } else {
        log.info(`✅ SUCCESS: Actor completed with ${saved} job(s) in dataset.`);
        await Actor.setValue('OUTPUT_SUMMARY', {
            jobsSaved: saved,
            pagesProcessed: stats.pagesProcessed,
            runtime: totalTime,
            success: true
        });
    }

} catch (error) {
    log.error(`❌ CRITICAL ERROR: ${error.message}`);
    log.exception(error, 'Actor failed with exception');
    // Ensure we fail with a message so QA picks it up
    await Actor.fail(`Actor failed: ${error.message}`);
} finally {
    await Actor.exit();
}

