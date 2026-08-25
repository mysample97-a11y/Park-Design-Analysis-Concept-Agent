# Reference index — Concept Generation

Standards and guidance this tool's methodology checklist draws on.

**HAVE** = the document is in this folder. **NEED** = freely available, download and drop it here.
**CITED** = referenced in reports but copyrighted or paywalled, so not redistributable.

| Status | Document | Publisher | What it governs | Location |
|---|---|---|---|---|
| **HAVE** | Park Design Guidelines - spatial organisation | Delhi Urban Art Commission | Spatial organisation, play/vehicle separation (45 m or 1.2 m barrier), leasable area guidance. | Delhi-UAC-Park-Design-Guidelines.pdf |
| NEED | Neighborhood Parks Manual | Dubai Municipality | Capacity bands, 1,000 m attraction radius, 30,000 m2 classification threshold, 15% leasable target. | Project-issued document |

---

These documents are **not read by the application at runtime** — they run to megabytes,
far beyond any practical prompt budget. Each has been distilled into a coverage checklist
in `src/utils/methodology.js`, which tells the analysis *what a competent study must cover*
— never a value, threshold or formula.

That distinction is deliberate. The checklist supplies **scope**; the AI establishes the
**content** that actually governs at the user's location. A site in Toronto is therefore
checked for flood risk, because that is universally expected — but reports Ontario sources.