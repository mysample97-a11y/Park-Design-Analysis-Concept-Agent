# Reference index — Vegetation, Terrain & Soil

Standards and guidance this tool's methodology checklist draws on.

**HAVE** = the document is in this folder. **NEED** = freely available, download and drop it here.
**CITED** = referenced in reports but copyrighted or paywalled, so not redistributable.

| Status | Document | Publisher | What it governs | Location |
|---|---|---|---|---|
| **HAVE** | Park Design Guidelines - planting sections | Delhi Urban Art Commission | Planting, canopy and softscape guidance. | Delhi-UAC-Park-Design-Guidelines.pdf |
| NEED | The benefits of large species trees in urban landscapes (C712) | CIRIA | Rootable soil volume, canopy value, retention of existing trees. Free to CIRIA members; registration required. | https://www.ciria.org — search C712 |
| NEED | Dubai Municipality afforestation planting programme | Dubai Municipality | Regional species palette: Ghaf, Sidr, Samar and other native/adaptive species. | Project-issued document |

---

These documents are **not read by the application at runtime** — they run to megabytes,
far beyond any practical prompt budget. Each has been distilled into a coverage checklist
in `src/utils/methodology.js`, which tells the analysis *what a competent study must cover*
— never a value, threshold or formula.

That distinction is deliberate. The checklist supplies **scope**; the AI establishes the
**content** that actually governs at the user's location. A site in Toronto is therefore
checked for flood risk, because that is universally expected — but reports Ontario sources.