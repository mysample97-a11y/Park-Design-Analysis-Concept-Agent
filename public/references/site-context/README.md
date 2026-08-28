# Reference index — Site Context & Accessibility

Standards and guidance this tool's methodology checklist draws on.

**HAVE** = the document is in this folder. **NEED** = freely available, download and drop it here.
**CITED** = referenced in reports but copyrighted or paywalled, so not redistributable.

| Status | Document | Publisher | What it governs | Location |
|---|---|---|---|---|
| **HAVE** | ARCON Comprehensive Guide to Site Analysis | Architects Registration Council of Nigeria | Scope of a professional site analysis: physical, environmental, regulatory, hazard and contextual factors. Source of the 14-point coverage checklist. | ARCON-Site-Analysis-Checklist.txt |
| NEED | Dubai Universal Design Code | Dubai Municipality | Accessibility thresholds: path and ramp widths, gradients, cross-fall, handrails. | https://www.dm.gov.ae — search 'Universal Design Code' |
| NEED | Dubai Building Code (2021) | Dubai Development Authority | General built-environment requirements including accessibility provisions. | https://dda.gov.ae/-/media/Project/TECOM/Media/DDA/Planning-and-development/Design/pdf/Dubai-Building-Code_English_2021-Edition.pdf |

---

These documents are **not read by the application at runtime** — they run to megabytes,
far beyond any practical prompt budget. Each has been distilled into a coverage checklist
in `src/utils/methodology.js`, which tells the analysis *what a competent study must cover*
— never a value, threshold or formula.

That distinction is deliberate. The checklist supplies **scope**; the AI establishes the
**content** that actually governs at the user's location. A site in Toronto is therefore
checked for flood risk, because that is universally expected — but reports Ontario sources.