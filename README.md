# APEC Jobs Scraper - Executive & Managerial Job Listings

> **Extract executive and managerial job listings from APEC.fr** - France's leading job board for senior professionals. Get comprehensive job data including salaries, descriptions, and company information.

[![Apify Actor](https://img.shields.io/badge/Apify-Actor-blue)](https://apify.com)
[![Jobs Data](https://img.shields.io/badge/Data-Jobs-green)](https://apify.com)
[![France](https://img.shields.io/badge/Country-France-red)](https://apify.com)

## 📋 What This Actor Does

APEC Jobs Scraper extracts high-quality job listings from **APEC.fr**, France's premier job platform for executive and managerial positions. Perfect for:

- **Job Market Research** - Analyze executive job trends and salary data
- **Recruitment Agencies** - Access comprehensive job listings and company information
- **Career Platforms** - Integrate French executive job data
- **Market Intelligence** - Track hiring patterns in French companies
- **HR Analytics** - Study executive compensation and job requirements

### ✨ Key Features

- **Comprehensive Data Extraction** - Title, company, location, salary, full descriptions
- **Executive Focus** - Specialized for managerial and senior positions
- **Multi-Search Options** - Keywords, locations, departments, or direct URLs
- **Flexible Configuration** - Control results volume and detail level
- **Fast & Reliable** - Optimized for speed with built-in rate limiting
- **Production Ready** - Handles large-scale data collection

## 🚀 Quick Start

### Basic Usage - Software Engineers in Paris

```json
{
  "keyword": "ingenieur logiciel",
  "location": "Paris",
  "results_wanted": 50
}
```

### Advanced Usage - Full Details Collection

```json
{
  "keyword": "chef de projet",
  "location": "Lyon",
  "results_wanted": 100,
  "collectDetails": true,
  "max_pages": 5
}
```

### Direct URL Scraping

```json
{
  "startUrl": "https://www.apec.fr/candidat/recherche-emploi.html/emploi?lieux=75&motsCles=data",
  "results_wanted": 25
}
```

## 📊 Input Parameters

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `startUrl` | string | Direct APEC search URL (overrides other parameters) | `"https://www.apec.fr/candidat/recherche-emploi.html/emploi?lieux=75&motsCles=data"` |
| `keyword` | string | Job title or skills to search | `"ingenieur logiciel"`, `"chef de projet"` |
| `location` | string | City or region name | `"Paris"`, `"Lyon"`, `"Toulouse"` |
| `department` | string | French department code | `"75"` (Paris), `"69"` (Rhône) |
| `collectDetails` | boolean | Extract full job descriptions and metadata | `true` / `false` |
| `results_wanted` | integer | Maximum jobs to collect (1-1000) | `50` |
| `max_pages` | integer | Maximum search pages to process | `5` |
| `maxConcurrency` | integer | Concurrent requests (1-10) | `3` |
| `proxyConfiguration` | object | Proxy settings for reliability | `{"useApifyProxy": true}` |

## 📈 Output Data Structure

Each job listing includes comprehensive information:

```json
{
  "id": "unique-job-identifier",
  "title": "Directeur Commercial H/F",
  "company": "TechCorp France",
  "location": "Paris (75)",
  "salary": "70k€ - 90k€ annuel",
  "published_at": "2024-01-15",
  "description_text": "Nous recherchons un Directeur Commercial expérimenté...",
  "description_html": "<p>Nous recherchons un Directeur Commercial...</p>",
  "applyLink": "https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/12345",
  "url": "https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/12345",
  "source": "api",
  "fetched_at": "2024-01-15T10:30:00.000Z"
}
```

### Output Fields

- **`id`** - Unique job identifier
- **`title`** - Job position title
- **`company`** - Hiring company name
- **`location`** - Job location (city/department)
- **`salary`** - Salary information when available
- **`published_at`** - Publication date
- **`description_text`** - Clean text description
- **`description_html`** - Full HTML description
- **`applyLink`** - Application URL
- **`url`** - Job detail page URL
- **`source`** - Data source (api/html-fallback)
- **`fetched_at`** - Extraction timestamp

## 🎯 Use Cases & Applications

### Recruitment & Staffing
- Build comprehensive job databases
- Monitor executive job market trends
- Identify high-demand skills and locations

### Market Research
- Analyze salary ranges by role and location
- Track hiring patterns in specific industries
- Study executive job market dynamics

### Business Intelligence
- Monitor competitor hiring activities
- Identify emerging job categories
- Analyze geographic hiring trends

### Career Platforms
- Integrate French executive job data
- Provide comprehensive job search features
- Enable salary comparison tools

## ⚡ Performance & Cost Optimization

### Recommended Settings for Different Use Cases

| Use Case | Results | Details | Pages | Concurrency | Est. Time |
|----------|---------|---------|-------|-------------|-----------|
| Quick Test | 10 | `false` | 1 | 3 | ~30 seconds |
| Basic Research | 50 | `false` | 3 | 3 | ~2 minutes |
| Full Analysis | 200 | `true` | 5 | 5 | ~5 minutes |
| Large Dataset | 500 | `true` | 10 | 3 | ~10 minutes |

### Cost Estimation

- **Free Tier**: Up to 100 jobs per run
- **Pay-per-Result**: ~$0.001 per job extracted
- **Proxy Costs**: Additional for residential proxies (recommended)

### Best Practices

- **Start Small**: Test with `results_wanted: 10` first
- **Use Proxies**: Enable Apify Proxy for reliability
- **Monitor Usage**: Track API calls and response times
- **Batch Processing**: Split large requests into multiple runs

## 🔧 Configuration Examples

### Entry-Level Executive Positions

```json
{
  "keyword": "junior manager",
  "location": "Paris",
  "results_wanted": 25,
  "collectDetails": true,
  "maxConcurrency": 2
}
```

### Senior Leadership Roles

```json
{
  "keyword": "directeur general",
  "department": "75",
  "results_wanted": 50,
  "collectDetails": true,
  "max_pages": 3
}
```

### Technology Sector Focus

```json
{
  "keyword": "CTO OR chief technology officer",
  "location": "France",
  "results_wanted": 30,
  "collectDetails": true
}
```

### Geographic Analysis

```json
{
  "keyword": "sales director",
  "location": "Provence-Alpes-Côte d'Azur",
  "results_wanted": 40,
  "max_pages": 4
}
```

## 📋 Requirements & Limitations

### Data Freshness
- Jobs updated in real-time from APEC.fr
- Listings typically available for 30-60 days
- Salary data available for ~60% of positions

### Geographic Coverage
- France-wide coverage
- All 101 departments supported
- Major cities: Paris, Lyon, Marseille, Toulouse, Nice, Nantes, Bordeaux

### Language Support
- Primary language: French
- Some international companies list in English
- Location names in French format

## 🆘 Troubleshooting

### Common Issues

**No Results Found**
- Check keyword spelling and relevance
- Try broader search terms
- Verify location/department codes

**Timeout Errors**
- Reduce `results_wanted` and `max_pages`
- Lower `maxConcurrency` setting
- Enable proxy configuration

**Incomplete Data**
- Set `collectDetails: true` for full descriptions
- Check if job listings are still active
- Some jobs may have limited information

### Support

For issues or questions:
- Check APEC.fr website for current search format
- Verify input parameters match APEC's search options
- Test with smaller result sets first

## 📄 License & Terms

This actor extracts publicly available job data from APEC.fr in accordance with their terms of service and applicable web scraping regulations.

---

**Keywords**: APEC jobs, French jobs, executive positions, managerial jobs, France employment, job scraping, recruitment data, salary data, career opportunities, job market analysis