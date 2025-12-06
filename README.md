# APEC Jobs Scraper (Playwright)

Playwright-powered Apify actor that extracts executive and managerial jobs from APEC.fr (SPA). Renders pages, paginates, and collects full job details.

## What it does
- Uses `PlaywrightCrawler` to render APEC’s SPA search listings and detail pages.
- Extracts title, company, location, salary from listings; enriches with description + metadata from detail pages.
- Paginates by clicking the “next” button until limits are hit.
- Proxy-ready (Apify residential recommended) with headless Chrome user agent.

## Inputs (simplified)

| Field | Type | Notes |
| --- | --- | --- |
| `startUrl` | string | APEC search URL to scrape (overrides keyword/location/department). |
| `keyword` | string | e.g., `ingenieur logiciel`, `chef de projet`. |
| `location` | string | City/region (overrides department if set). |
| `department` | string | Department code (e.g., `75`, `27`, `69`). |
| `collectDetails` | boolean | Visit detail pages for full descriptions. |
| `results_wanted` | integer | Max jobs to collect. |
| `max_pages` | integer | Max listing pages to traverse. |
| `maxConcurrency` | integer | Concurrency tuning (speed vs. blocking risk). |
| `proxyConfiguration` | object | Use Apify Proxy (RESIDENTIAL recommended). |

### Example: Software engineers in Paris
```json
{
  "keyword": "ingenieur logiciel",
  "location": "Paris",
  "results_wanted": 40,
  "collectDetails": true
}
```

### Example: Direct URL
```json
{
  "startUrl": "https://www.apec.fr/candidat/recherche-emploi.html/emploi?lieux=75&motsCles=data",
  "results_wanted": 30,
  "collectDetails": false
}
```

## How it works
1) Build search URL (keyword + city/department).  
2) Render listing page with Playwright; extract jobs and enqueue detail pages.  
3) Click through pagination until limits.  
4) On detail pages, extract description and metadata; merge with listing data.  
5) Save to dataset.

## Output fields
- `title`, `company`, `location`, `salary`, `job_type`, `experience`, `remote_work`, `date_posted`
- `description_text`, `description_html`, `url`, `source`, `fetched_at`

## Tips
- Use Apify residential proxies for best reliability.
- If throttled, lower `maxConcurrency` (default 2) and keep `max_pages` modest for smoke tests (1–2).
- Ensure `startUrl` is a valid APEC search URL or provide keyword/department to build one.
