# Reference index — Solar Exposure

Standards and guidance this tool's methodology checklist draws on.

**HAVE** = the document is in this folder. **NEED** = freely available, download and drop it here.
**CITED** = referenced in reports but copyrighted or paywalled, so not redistributable.

| Status | Document | Publisher | What it governs | Location |
|---|---|---|---|---|
| NEED | General Solar Position Calculations | NOAA Global Monitoring Laboratory | The exact algorithm implemented in the tool: declination, equation of time, hour angle, azimuth, elevation. US Government - public domain. | https://gml.noaa.gov/grad/solcalc/solareqns.PDF |
| NEED | Solar Calculator - calculation details | NOAA GML | Meeus-based derivation underlying the above. Save the page as PDF. | https://gml.noaa.gov/grad/solcalc/calcdetails.html |
| **HAVE** | Park Design Guidelines | Delhi Urban Art Commission | Shade coverage targets: 80% primary walkways, 60% secondary, 100% play structures, 80% gathering, 40% informal play and parking. | Delhi-UAC-Park-Design-Guidelines.pdf |
| CITED | ASHRAE clear-sky irradiance model | ASHRAE Handbook of Fundamentals | The A/B/C coefficient method used to compute kWh/m2. Copyrighted and not redistributable - the method is documented in the tool's source code. | Cited only |

---

These documents are **not read by the application at runtime** — they run to megabytes,
far beyond any practical prompt budget. Each has been distilled into a coverage checklist
in `src/utils/methodology.js`, which tells the analysis *what a competent study must cover*
— never a value, threshold or formula.

That distinction is deliberate. The checklist supplies **scope**; the AI establishes the
**content** that actually governs at the user's location. A site in Toronto is therefore
checked for flood risk, because that is universally expected — but reports Ontario sources.