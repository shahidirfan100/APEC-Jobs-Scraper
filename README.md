# APEC Jobs Scraper

Extract comprehensive job listings from APEC.fr, France's premier employment platform for executives, managers, and professionals. This scraper efficiently collects detailed job information including titles, companies, salaries, contract types, locations, and full descriptions.

## What is APEC?

APEC (Association Pour l'Emploi des Cadres) is France's leading job board specializing in executive and managerial positions. It serves as the primary platform for cadres (executives and professionals) to find qualified career opportunities across all sectors.

## Key Features

✓ **Dual Extraction Methods** - Intelligently uses JSON API for speed, falls back to HTML parsing for reliability  
✓ **Comprehensive Data** - Extracts job titles, companies, salaries, contract types, locations, experience requirements, and full descriptions  
✓ **Smart Filtering** - Search by keywords, departments, salary ranges, contract types, and remote work options  
✓ **Pagination Support** - Automatically navigates through multiple result pages to collect all matching jobs  
✓ **French Job Market Focus** - Optimized for French employment terms, locations, and contract types  
✓ **Structured Output** - Clean, consistent JSON format ready for analysis or integration

## Use Cases

- **Job Market Research** - Analyze salary trends, skill demands, and hiring patterns in the French executive market
- **Recruitment Intelligence** - Monitor competitor hiring, identify talent pools, and track market opportunities
- **Career Planning** - Aggregate job opportunities matching specific criteria across departments and industries
- **Data Analytics** - Build datasets for employment trend analysis, salary benchmarking, and market insights
- **Job Aggregation** - Integrate APEC listings into job boards, career platforms, or HR systems

## Input Parameters

### Search Criteria

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `keyword` | string | Job title or skills to search | `"ingénieur logiciel"` |
| `department` | string | French department number | `"75"` (Paris), `"27"` (Eure) |
| `contractType` | array | Contract type codes | `["143684", "143685"]` |
| `remoteWork` | array | Remote work filter options | `["partiel", "total"]` |

### Scraping Configuration

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `startUrl` | string | Direct APEC search URL to scrape | - |
| `results_wanted` | integer | Maximum jobs to extract | `100` |
| `max_pages` | integer | Maximum result pages to process | `20` |
| `collectDetails` | boolean | Visit detail pages for full descriptions | `true` |
| `useApi` | boolean | Try API method first | `true` |
| `proxyConfiguration` | object | Apify Proxy settings | Residential |

### Common Contract Type Codes

- `143684` - Entreprise (Direct Company)
- `143685` - Cabinet de recrutement (Recruitment Agency)
- `143686` - Agence d'emploi (Employment Agency)
- `143687` - SSII/ESN (IT Services Company)
- `143706` - Other organization types

## Output Format

Each job listing includes:

```json
{
  "title": "Chef de Projet SI Finance",
  "company": "NEOVITY",
  "location": "Val-de-Reuil - 27",
  "salary": "55 - 65 k€ brut annuel",
  "job_type": "CDI",
  "date_posted": "05/12/2025",
  "experience": "5-10 ans",
  "remote_work": "Télétravail partiel possible",
  "description_text": "Au sein d'une DSI d'environ 60 collaborateurs...",
  "description_html": "<p>Au sein d'une DSI...</p>",
  "url": "https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/..."
}
```

## Configuration Examples

### Example 1: Search Software Engineers in Paris

```json
{
  "keyword": "ingénieur logiciel",
  "department": "75",
  "contractType": ["143684"],
  "results_wanted": 50,
  "collectDetails": true
}
```

### Example 2: Remote Project Managers Nationwide

```json
{
  "keyword": "chef de projet",
  "remoteWork": ["total"],
  "results_wanted": 100,
  "max_pages": 10
}
```

### Example 3: Use Direct URL

```json
{
  "startUrl": "https://www.apec.fr/candidat/recherche-emploi.html/emploi?lieux=27&typesConvention=143684",
  "results_wanted": 100
}
```

## How It Works

1. **Search Initialization** - Builds search URL from parameters or uses provided URL
2. **API Attempt** - If enabled, queries APEC's JSON API for fast data retrieval
3. **HTML Fallback** - Parses HTML when API is unavailable, extracting job cards
4. **Detail Collection** - Optionally visits each job page for complete descriptions
5. **Data Extraction** - Prioritizes JSON-LD structured data, falls back to CSS selectors
6. **Pagination** - Automatically navigates to next pages until limit reached
7. **Output** - Saves structured data to Apify dataset

### CSS Selectors Used

**Listing Page:**
- `itemContainer`: `article.card-offre`
- `title`: `h2.card-title a`
- `link`: `h2.card-title a` (extract `href` attribute)
- `company`: `p.card-company`
- `location`: `span.card-location`
- `salary`: `span.card-salary`
- `pagination`: `a.pagination__next`

**Detail Page:**
- `description`: `div.job-description-content`
- `specifications`: `ul.job-details-list` (for extracting additional structured details)

## Performance Tips

- **Use API Method** - Keep `useApi: true` for 3-5x faster extraction
- **Limit Results** - Set realistic `results_wanted` to control runtime and costs
- **Use Proxies** - Enable Apify Proxy to prevent rate limiting and blocking
- **Skip Details** - Set `collectDetails: false` to only extract listing cards (faster)
- **Targeted Searches** - Use specific keywords and filters to reduce result volume

## Limitations & Best Practices

- **Rate Limiting** - APEC may throttle requests; use proxies and reasonable delays
- **Dynamic Content** - Some elements load via JavaScript; API method handles this best
- **Contract Codes** - Contract type codes may change; verify current codes on APEC.fr
- **French Language** - Job content is in French; use appropriate keywords
- **Data Freshness** - Job listings update frequently; schedule regular runs for current data

## Support & Resources

- Department codes reference: [French departments list](https://en.wikipedia.org/wiki/Departments_of_France)
- APEC official site: [www.apec.fr](https://www.apec.fr)
- Contract types: Available in APEC's advanced search filters

## Output Integration

The structured output is compatible with:
- CSV/Excel export for spreadsheet analysis
- JSON APIs for application integration  
- Database import for data warehousing
- BI tools (Tableau, Power BI) for visualization
- Machine learning pipelines for predictive modeling

---

**Note**: This scraper respects website terms of service. Use responsibly and ensure compliance with APEC's usage policies and applicable data protection regulations (GDPR).
