# Reference index — Applies to several tools

Standards and guidance this tool's methodology checklist draws on.

**HAVE** = the document is in this folder. **NEED** = freely available, download and drop it here.
**CITED** = referenced in reports but copyrighted or paywalled, so not redistributable.

| Status | Document | Publisher | What it governs | Location |
|---|---|---|---|---|
| NEED | Dubai Green Building Regulations and Specifications (Al Sa'fat) | Dubai Municipality | TSE irrigation requirement and sustainability compliance framework. | https://www.dm.gov.ae — search Al Sa'fat |
| NEED | The SuDS Manual (C753) | CIRIA | Sustainable drainage: planning, design, landscape integration, water quality. Free with CIRIA registration. | https://www.ciria.org — search C753 |
| CITED | BS EN 1176 / BS EN 1177 | BSI | Playground equipment and impact-attenuating surfacing. Paywalled - cited, not redistributable. Confirm applicability with the local authority. | Cited only |

---

These documents are **not read by the application at runtime** — they run to megabytes,
far beyond any practical prompt budget. Each has been distilled into a coverage checklist
in `src/utils/methodology.js`, which tells the analysis *what a competent study must cover*
— never a value, threshold or formula.

That distinction is deliberate. The checklist supplies **scope**; the AI establishes the
**content** that actually governs at the user's location. A site in Toronto is therefore
checked for flood risk, because that is universally expected — but reports Ontario sources.