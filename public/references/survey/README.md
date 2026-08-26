# Reference index — Community Survey

Standards and guidance this tool's methodology checklist draws on.

**HAVE** = the document is in this folder. **NEED** = freely available, download and drop it here.
**CITED** = referenced in reports but copyrighted or paywalled, so not redistributable.

| Status | Document | Publisher | What it governs | Location |
|---|---|---|---|---|
| NEED | Jung, Choi et al. - Sustainability 14(6):3460 (2022) | MDPI - open access, CC-BY | Post-occupancy evaluation of two Dubai neighbourhood parks: 375 surveys, DM GIS data. Source of the access-priority finding and the children's-facilities gap. The most directly relevant paper in this library. | https://www.mdpi.com/2071-1050/14/6/3460 |

---

These documents are **not read by the application at runtime** — they run to megabytes,
far beyond any practical prompt budget. Each has been distilled into a coverage checklist
in `src/utils/methodology.js`, which tells the analysis *what a competent study must cover*
— never a value, threshold or formula.

That distinction is deliberate. The checklist supplies **scope**; the AI establishes the
**content** that actually governs at the user's location. A site in Toronto is therefore
checked for flood risk, because that is universally expected — but reports Ontario sources.