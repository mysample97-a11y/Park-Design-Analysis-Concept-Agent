# Reference index — Cost & Feasibility

Standards and guidance this tool's methodology checklist draws on.

**HAVE** = the document is in this folder. **NEED** = freely available, download and drop it here.
**CITED** = referenced in reports but copyrighted or paywalled, so not redistributable.

| Status | Document | Publisher | What it governs | Location |
|---|---|---|---|---|
| NEED | NRM 1: Order of Cost Estimating and Cost Planning (3rd edition, 2021) | RICS | The cascading cost structure implemented in the tool: measured works, preliminaries, overheads and profit, risk, inflation. | https://www.rics.org/content/dam/ricsglobal/documents/standards/october_2021_nrm_1.pdf |
| NEED | International Construction Market Survey (latest) | Turner & Townsend | Regional construction cost benchmarks used to sanity-check researched unit rates. | https://www.turnerandtownsend.com — search ICMS, free download |

---

These documents are **not read by the application at runtime** — they run to megabytes,
far beyond any practical prompt budget. Each has been distilled into a coverage checklist
in `src/utils/methodology.js`, which tells the analysis *what a competent study must cover*
— never a value, threshold or formula.

That distinction is deliberate. The checklist supplies **scope**; the AI establishes the
**content** that actually governs at the user's location. A site in Toronto is therefore
checked for flood risk, because that is universally expected — but reports Ontario sources.