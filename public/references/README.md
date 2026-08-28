# Reference library

Published standards and guidance underpinning the tools' **methodology coverage checklists**,
organised by tool. Each folder has a `README.md` listing what governs that tool, what is
present, and where to obtain what is missing.

**They are not read by the application at runtime.** They run to megabytes — far beyond any
practical prompt budget. Each has been distilled into a coverage checklist in
`src/utils/methodology.js`, which tells the analysis *what a competent study must cover*
— never a value, threshold or formula.

That distinction is what keeps the tools location-generic. The checklist supplies **scope**;
the AI establishes the **content** that actually governs at the user's location.

| Folder | Tool |
|---|---|
| `site-context/` | Site Context & Accessibility |
| `solar/` | Solar Exposure |
| `wind/` | Wind Exposure |
| `vegetation/` | Vegetation, Terrain & Soil |
| `survey/` | Community Survey |
| `concept/` | Concept Generation |
| `budget/` | Cost & Feasibility |
| `cross-cutting/` | Applies to several tools |

Some documents are copyrighted or paywalled and cannot be redistributed. Those are marked
**CITED** — referenced in reports with full attribution, but not included here.
