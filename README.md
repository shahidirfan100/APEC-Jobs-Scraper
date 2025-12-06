# APEC Jobs Scraper

Fast, production-ready Apify actor that extracts executive and managerial jobs from APEC.fr using an API-first strategy with an HTML fallback for robustness.

## What it does
- API-first search (multiple APEC endpoints tried) with automatic HTML fallback if the API returns nothing.
- Supports keyword, city/department, contract type codes, and remote-work filters.
- Optional full detail crawl (JSON-LD first, then CSS selectors) with cleaned text + HTML descriptions.
- Stealth mode: rotating realistic headers, optional delay + jitter, proxy ready (Apify residential recommended).
- Pagination with hard caps for `results_wanted` and `max_pages` to avoid runaway runs.

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
1) Build search parameters (keyword, city/department, contract type, remote).  
2) API attempt: POST/GET against known APEC endpoints with pagination; enqueue detail pages when needed.  
3) HTML fallback: HTTP + Cheerio; extract cards, paginate, and optionally visit detail pages.  
4) Detail parsing: JSON-LD first, then resilient selectors; produce both cleaned text and HTML.  
5) Output: normalized dataset with `source` (`api`, `html-listing`, `html-detail`) and `fetched_at`.

## Output fields
- `title`, `company`, `location`, `salary`, `job_type`, `experience`, `remote_work`, `date_posted`
- `description_text`, `description_html`, `url`, `source`, `fetched_at`

## Tips
- The actor automatically tries the JSON API first and falls back to HTML if needed.
- If you see throttling, lower `maxConcurrency` and use Apify residential proxies.
- For quick smoke tests, set `results_wanted` to 5–10 and `max_pages` to 1–2.
