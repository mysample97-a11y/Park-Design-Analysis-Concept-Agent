# Reference index — Wind Exposure

Standards and guidance this tool's methodology checklist draws on.

**HAVE** = the document is in this folder. **NEED** = freely available, download and drop it here.
**CITED** = referenced in reports but copyrighted or paywalled, so not redistributable.

| Status | Document | Publisher | What it governs | Location |
|---|---|---|---|---|
| **HAVE** | Wind Analysis - Terms of Reference | City of Ottawa | A clearly published implementation of pedestrian wind comfort and safety criteria, used as the reference case. Also the source of the site-design mitigation measures. | City-of-Ottawa-Wind-Analysis-ToR.pdf |
| CITED | Lawson / Davenport pedestrian comfort criteria | International practice | The underlying criteria family the thresholds belong to, also reflected in NEN 8100. Where a project location publishes its own criteria, those govern instead. | Cited only |
| NEED | NEN 8100 - Wind comfort and wind danger in the built environment | NEN (Netherlands) | A formal national standard for pedestrian wind comfort. Paywalled - cite unless you have access. | https://www.nen.nl — search NEN 8100 |

---

These documents are **not read by the application at runtime** — they run to megabytes,
far beyond any practical prompt budget. Each has been distilled into a coverage checklist
in `src/utils/methodology.js`, which tells the analysis *what a competent study must cover*
— never a value, threshold or formula.

That distinction is deliberate. The checklist supplies **scope**; the AI establishes the
**content** that actually governs at the user's location. A site in Toronto is therefore
checked for flood risk, because that is universally expected — but reports Ontario sources.