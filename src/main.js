// APEC Jobs scraper - HTTP + JSON API first, HTML fallback
import { Actor, log } from 'apify';
import { Dataset, gotScraping } from 'crawlee';
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

const autocompleteLieu = async (query, proxyConfiguration) => {
    const res = await gotScraping({
        url: `${API_LIEU_AUTOCOMPLETE}?q=${encodeURIComponent(query)}`,
        responseType: 'json',
        proxyUrl: await pickProxyUrl(proxyConfiguration),
        headers: DEFAULT_HEADERS,
        timeout: { request: 20000 },
        throwHttpErrors: false,
    });

    if (res.statusCode !== 200) {
        log.warning(`Lieu autocomplete failed (${res.statusCode}): ${res.body}`);
        return [];
    }
    return Array.isArray(res.body) ? res.body : [];
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

    if (res.statusCode !== 200) {
        const errorText = typeof res.body === 'string' ? res.body : res.body?.message;
        throw new Error(`Search API status ${res.statusCode}: ${errorText || 'Unknown error'}`);
    }
    return res.body;
};

const fetchDetail = async (numeroOffre, proxyConfiguration) => {
    const res = await gotScraping({
        url: `${API_DETAIL_URL}?numeroOffre=${encodeURIComponent(numeroOffre)}`,
        responseType: 'json',
        headers: DEFAULT_HEADERS,
        proxyUrl: await pickProxyUrl(proxyConfiguration),
        timeout: { request: 30000 },
        throwHttpErrors: false,
    });

    if (res.statusCode !== 200) {
        throw new Error(`Detail API status ${res.statusCode} for ${numeroOffre}`);
    }
    return res.body;
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
    const res = await gotScraping({
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

    if (res.statusCode >= 400) {
        log.warning(`HTML fallback failed (${res.statusCode})`);
        return 0;
    }

    const $ = cheerioLoad(res.body);
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
                    const detailRes = await gotScraping({
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
                    detailData = detailRes.statusCode === 200 ? parseHtmlDetail(detailRes.body, link) : null;
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

await Actor.main(async () => {
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
    let apiFailed = false;

    for (let page = 0; page < maxPages && saved < resultsWanted; page += 1) {
        const criteria = { ...criteriaBase, pagination: { ...criteriaBase.pagination, startIndex: page * pageSize } };
        let resultats = [];
        let totalCount = 0;

        try {
            const body = await fetchSearchPage(criteria, proxyConf);
            resultats = body?.resultats || [];
            totalCount = body?.totalCount || 0;
            log.info(`API page ${page + 1}: ${resultats.length} results (total ${totalCount})`);
        } catch (err) {
            apiFailed = true;
            log.warning(`API search failed on page ${page + 1}: ${err.message}`);
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
                        detail = await fetchDetail(listing.numeroOffre, proxyConf);
                    }
                    const job = buildJob({ listing, detail, source: 'api' });
                    await Dataset.pushData(job);
                    saved += 1;
                } catch (err) {
                    log.warning(`Failed to process ${listing.numeroOffre || listing.id}: ${err.message}`);
                }
            }),
        );

        await Promise.all(detailPromises);

        if (saved >= totalCount) break;
    }

    if (saved < resultsWanted) {
        const remaining = resultsWanted - saved;
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

    log.info(`Finished. Saved ${saved} items.`);
});
