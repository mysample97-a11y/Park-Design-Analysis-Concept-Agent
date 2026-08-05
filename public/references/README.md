# Reference library

These are the published documents the tools' **methodology coverage checklists** were
distilled from. They are stored here for **provenance** — so any figure or expectation
the app relies on can be traced to a real, retrievable source.

**They are not read by the application at runtime.** They run to megabytes; sending them
to a language model is not viable within any practical prompt budget. Instead each has
been distilled into a coverage checklist in `src/utils/methodology.js`, which tells the
analysis *what a competent study must cover* — never a value, threshold or formula.

That distinction is deliberate. The checklist supplies **scope**; the AI establishes the
**content** that actually governs at the user's location. A site in Toronto is therefore
checked for flood risk (universally expected) but reports Ontario sources.

| File | Source | Informs |
|---|---|---|
| ARCON-Site-Analysis-Checklist.txt | Architects Registration Council of Nigeria | Site Context coverage: hazards, adjacencies, ground conditions |
| Delhi-UAC-Park-Design-Guidelines.pdf | Delhi Urban Art Commission | Shade coverage targets, play/vehicle separation, spatial organisation |
| City-of-Ottawa-Wind-Analysis-ToR.pdf | City of Ottawa | Pedestrian wind comfort and safety criteria, wind rose method, mitigation |

Additional sources cited in reports but not stored here (freely available online):

- NOAA Global Monitoring Laboratory — General Solar Position Calculations
- ASHRAE Handbook of Fundamentals — clear-sky irradiance model
- RICS NRM 1 — Order of Cost Estimating and Cost Planning
