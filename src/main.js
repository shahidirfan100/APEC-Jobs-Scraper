// APEC Jobs scraper - CheerioCrawler implementation with API support
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { load as cheerioLoad } from 'cheerio';
import { gotScraping } from 'got-scraping';

// Single-entrypoint main
await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            keyword = '', location = '', department = '',
            results_wanted: RESULTS_WANTED_RAW = 100, max_pages: MAX_PAGES_RAW = 999,
            collectDetails = true, startUrl, startUrls, url, proxyConfiguration,
        } = input;

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : Number.MAX_SAFE_INTEGER;
        const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 999;

        const toAbs = (href, base = 'https://www.apec.fr') => {
            try { return new URL(href, base).href; } catch { return null; }
        };

        const cleanText = (html) => {
            if (!html) return '';
            const $ = cheerioLoad(html);
            $('script, style, noscript, iframe').remove();
            return $.root().text().replace(/\s+/g, ' ').trim();
        };

        // Build APEC search URL
        const buildStartUrl = (kw, loc, dept) => {
            const u = new URL('https://www.apec.fr/candidat/recherche-emploi.html/emploi');
            if (kw) u.searchParams.set('motsCles', String(kw).trim());
            if (dept) u.searchParams.set('lieux', String(dept).trim());
            
            return u.href;
        };

        // Try to fetch jobs via API first (JSON)
        async function fetchJobsViaAPI(pageNum, searchParams) {
            try {
                const apiUrl = new URL('https://www.apec.fr/cms/webapi/content/offer-search');
                apiUrl.searchParams.set('page', pageNum);
                apiUrl.searchParams.set('size', '20'); // APEC default page size
                
                // Transfer search params
                if (searchParams.motsCles) apiUrl.searchParams.set('motsCles', searchParams.motsCles);
                if (searchParams.lieux) apiUrl.searchParams.set('lieux', searchParams.lieux);
                
                const response = await gotScraping({
                    url: apiUrl.href,
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    },
                    responseType: 'json',
                    proxyUrl: proxyConf?.newUrl ? await proxyConf.newUrl() : undefined,
                });

                if (response.body && response.body.result) {
                    return {
                        jobs: response.body.result.offers || [],
                        totalCount: response.body.result.totalCount || 0,
                    };
                }
            } catch (err) {
                log.warning(`API fetch failed: ${err.message}, falling back to HTML parsing`);
            }
            return null;
        }

        const initial = [];
        if (Array.isArray(startUrls) && startUrls.length) initial.push(...startUrls);
        if (startUrl) initial.push(startUrl);
        if (url) initial.push(url);
        if (!initial.length) initial.push(buildStartUrl(keyword, location, department));

        const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;

        let saved = 0;

        // Extract structured data from JSON-LD
        function extractFromJsonLd($) {
            const scripts = $('script[type="application/ld+json"]');
            for (let i = 0; i < scripts.length; i++) {
                try {
                    const parsed = JSON.parse($(scripts[i]).html() || '');
                    const arr = Array.isArray(parsed) ? parsed : [parsed];
                    for (const e of arr) {
                        if (!e) continue;
                        const t = e['@type'] || e.type;
                        if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) {
                            return {
                                title: e.title || e.name || null,
                                company: e.hiringOrganization?.name || null,
                                date_posted: e.datePosted || null,
                                description_html: e.description || null,
                                location: (e.jobLocation && e.jobLocation.address && 
                                          (e.jobLocation.address.addressLocality || e.jobLocation.address.addressRegion)) || null,
                                salary: e.baseSalary?.value?.value || e.baseSalary?.value || null,
                                job_type: e.employmentType || null,
                            };
                        }
                    }
                } catch (e) { /* ignore parsing errors */ }
            }
            return null;
        }

        // Find job links on listing page
        function findJobLinks($, base) {
            const links = new Set();
            
            // Use specific APEC selector for job links
            $('article.card-offre h2.card-title a').each((_, a) => {
                const href = $(a).attr('href');
                if (href) {
                    const abs = toAbs(href, base);
                    if (abs) links.add(abs);
                }
            });
            
            // Fallback to general selector if specific selector doesn't work
            if (links.size === 0) {
                $('a[href*="/emploi/detail-offre/"]').each((_, a) => {
                    const href = $(a).attr('href');
                    if (href) {
                        const abs = toAbs(href, base);
                        if (abs) links.add(abs);
                    }
                });
            }
            
            return [...links];
        }

        // Extract job data from listing cards (without visiting detail page)
        function extractJobsFromCards($) {
            const jobs = [];
            
            // Use specific APEC selectors for job cards
            $('article.card-offre').each((_, card) => {
                const $card = $(card);
                
                // Find job link using specific selector
                const link = $card.find('h2.card-title a').first();
                if (!link.length) return;
                
                const jobUrl = toAbs(link.attr('href'));
                if (!jobUrl) return;
                
                // Extract data using specific selectors
                const title = $card.find('h2.card-title a').first().text().trim();
                const company = $card.find('p.card-company').first().text().trim();
                const location = $card.find('span.card-location').first().text().trim();
                const salary = $card.find('span.card-salary').first().text().trim();
                
                // Extract contract type and date from specifications if available
                const contractType = $card.find('[class*="contract"], [class*="contrat"]').first().text().trim();
                const datePosted = $card.find('[class*="date"]').first().text().trim();
                
                jobs.push({
                    url: jobUrl,
                    title: title || null,
                    company: company || null,
                    location: location || null,
                    salary: salary || null,
                    job_type: contractType || null,
                    date_posted: datePosted || null,
                });
            });
            
            return jobs;
        }

        // Find next page link
        function findNextPage($, currentUrl, currentPage) {
            // Try specific APEC pagination selector first
            const nextBtn = $('a.pagination__next').first();
            if (nextBtn.length) {
                const href = nextBtn.attr('href');
                if (href) return toAbs(href, currentUrl);
            }
            
            // Fallback to general pagination controls
            const rel = $('a[rel="next"]').attr('href');
            if (rel) return toAbs(rel, currentUrl);
            
            const next = $('a').filter((_, el) => {
                const text = $(el).text().toLowerCase();
                return text.includes('next') || text.includes('suivant') || text === '›' || text === '»';
            }).first().attr('href');
            if (next) return toAbs(next, currentUrl);
            
            // Try to build next page URL
            try {
                const u = new URL(currentUrl);
                const page = parseInt(u.searchParams.get('page') || '0');
                u.searchParams.set('page', String(page + 1));
                return u.href;
            } catch (e) {
                return null;
            }
        }

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            useSessionPool: true,
            maxConcurrency: 5,
            requestHandlerTimeoutSecs: 90,
            async requestHandler({ request, $, enqueueLinks, log: crawlerLog }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 0;

                if (label === 'LIST') {
                    crawlerLog.info(`Processing LIST page ${pageNo}: ${request.url}`);
                    
                    // Try API first
                    if (pageNo === 0) {
                        const searchUrl = new URL(request.url);
                        const apiData = await fetchJobsViaAPI(pageNo, Object.fromEntries(searchUrl.searchParams));
                        
                        if (apiData && apiData.jobs.length > 0) {
                            crawlerLog.info(`API returned ${apiData.jobs.length} jobs`);
                            
                            for (const job of apiData.jobs) {
                                if (saved >= RESULTS_WANTED) break;
                                
                                const item = {
                                    title: job.title || job.intitule || null,
                                    company: job.entreprise?.nom || job.company || null,
                                    location: job.lieuTravail || job.location || null,
                                    salary: job.salaire?.libelle || job.salary || null,
                                    job_type: job.typeContrat?.libelle || job.contractType || null,
                                    date_posted: job.datePublication || job.datePosted || null,
                                    description_text: job.description || null,
                                    url: toAbs(job.url || `/candidat/recherche-emploi.html/emploi/detail-offre/${job.id}`) || null,
                                    experience: job.experience?.libelle || null,
                                    remote_work: job.teletravail || null,
                                };
                                
                                await Dataset.pushData(item);
                                saved++;
                            }
                            
                            // Continue to next page if needed
                            if (saved < RESULTS_WANTED && pageNo < MAX_PAGES - 1 && apiData.jobs.length === 20) {
                                const nextUrl = findNextPage($, request.url, pageNo);
                                if (nextUrl) {
                                    await enqueueLinks({ urls: [nextUrl], userData: { label: 'LIST', pageNo: pageNo + 1 } });
                                }
                            }
                            return;
                        }
                    }
                    
                    // Fall back to HTML parsing
                    if (!collectDetails) {
                        // Extract jobs directly from listing cards
                        const jobs = extractJobsFromCards($);
                        crawlerLog.info(`HTML parsing found ${jobs.length} job cards`);
                        
                        const remaining = RESULTS_WANTED - saved;
                        const toPush = jobs.slice(0, Math.max(0, remaining));
                        
                        if (toPush.length) {
                            await Dataset.pushData(toPush);
                            saved += toPush.length;
                        }
                    } else {
                        // Enqueue detail pages
                        const links = findJobLinks($, request.url);
                        crawlerLog.info(`Found ${links.length} job links`);
                        
                        const remaining = RESULTS_WANTED - saved;
                        const toEnqueue = links.slice(0, Math.max(0, remaining));
                        
                        if (toEnqueue.length) {
                            await enqueueLinks({ urls: toEnqueue, userData: { label: 'DETAIL' } });
                        }
                    }

                    // Navigate to next page
                    if (saved < RESULTS_WANTED && pageNo < MAX_PAGES) {
                        const next = findNextPage($, request.url, pageNo);
                        if (next) {
                            crawlerLog.info(`Enqueuing next page: ${next}`);
                            await enqueueLinks({ urls: [next], userData: { label: 'LIST', pageNo: pageNo + 1 } });
                        }
                    }
                    return;
                }

                if (label === 'DETAIL') {
                    if (saved >= RESULTS_WANTED) return;
                    
                    try {
                        crawlerLog.info(`Processing DETAIL: ${request.url}`);
                        
                        // Try JSON-LD first
                        const json = extractFromJsonLd($);
                        const data = json || {};
                        
                        // Fallback to HTML selectors
                        if (!data.title) {
                            data.title = $('h1, .offer-title, [class*="title"]').first().text().trim() || null;
                        }
                        
                        if (!data.company) {
                            data.company = $('.company-name, [class*="company"], [class*="entreprise"]').first().text().trim() || null;
                        }
                        
                        if (!data.location) {
                            data.location = $('.job-location, [class*="location"], [class*="lieu"]').first().text().trim() || null;
                        }
                        
                        if (!data.salary) {
                            data.salary = $('.salary, [class*="salary"], [class*="salaire"]').first().text().trim() || null;
                        }
                        
                        if (!data.job_type) {
                            data.job_type = $('.contract-type, [class*="contract"], [class*="contrat"]').first().text().trim() || null;
                        }
                        
                        if (!data.date_posted) {
                            data.date_posted = $('.date-posted, [class*="date"]').first().text().trim() || null;
                        }
                        
                        // Extract description using specific selector
                        if (!data.description_html) {
                            const desc = $('div.job-description-content').first();
                            if (desc && desc.length) {
                                data.description_html = String(desc.html()).trim();
                            } else {
                                // Fallback to general selectors
                                const fallbackDesc = $('.job-description, .description, [class*="description"], .content, .offer-content').first();
                                if (fallbackDesc && fallbackDesc.length) {
                                    data.description_html = String(fallbackDesc.html()).trim();
                                }
                            }
                        }
                        
                        data.description_text = data.description_html ? cleanText(data.description_html) : null;
                        
                        // Extract additional fields from specifications
                        const experience = $('ul.job-details-list li').filter((_, el) => {
                            const text = $(el).text().toLowerCase();
                            return text.includes('expérience') || text.includes('experience');
                        }).first().text().trim() || 
                        $('.experience, [class*="experience"]').first().text().trim();
                        
                        const remoteInfo = $('ul.job-details-list li').filter((_, el) => {
                            const text = $(el).text().toLowerCase();
                            return text.includes('télétravail') || text.includes('remote');
                        }).first().text().trim() || 
                        $('.remote, [class*="teletravail"], [class*="remote"]').first().text().trim();

                        const item = {
                            title: data.title || null,
                            company: data.company || null,
                            location: data.location || null,
                            salary: data.salary || null,
                            job_type: data.job_type || null,
                            date_posted: data.date_posted || null,
                            description_html: data.description_html || null,
                            description_text: data.description_text || null,
                            experience: experience || null,
                            remote_work: remoteInfo || null,
                            url: request.url,
                        };

                        await Dataset.pushData(item);
                        saved++;
                        crawlerLog.info(`Saved job: ${item.title} at ${item.company} (${saved}/${RESULTS_WANTED})`);
                    } catch (err) {
                        crawlerLog.error(`DETAIL ${request.url} failed: ${err.message}`);
                    }
                }
            }
        });

        await crawler.run(initial.map(u => ({ url: u, userData: { label: 'LIST', pageNo: 0 } })));
        log.info(`Finished. Saved ${saved} items`);
    } finally {
        await Actor.exit();
    }
}

main().catch(err => { console.error(err); process.exit(1); });
