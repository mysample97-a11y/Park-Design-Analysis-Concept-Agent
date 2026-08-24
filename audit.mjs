// audit.mjs — CAPABILITY AUDIT
//
// Not a dead-code scan. This asserts that each capability we CLAIM is wired all
// the way to the user: module exists → called → its output reaches the report,
// the UI, or the network call.
//
// Written because three separate features (Tesseract OCR, report provenance,
// retry-after) were each written, unit-tested, marked done, and wired to
// nothing. A passing unit test proves a function works, not that anything calls
// it. Run this before claiming a fix is complete.
//
//   node audit.mjs
import fs from "fs";
import path from "path";

const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const TOOLS = ["SiteContextAnalyzer","SolarAnalyzer","WindAnalyzer","VegetationAnalyzer",
               "SurveyAnalyzer","ConceptGenerator","BudgetTracker","CombinedDocumentGenerator"];
const A = Object.fromEntries(TOOLS.map((t) => [t, read(`src/analyzers/${t}.jsx`)]));
const F = {
  ai: read("src/utils/ai.jsx"),
  tokenMeter: read("src/utils/tokenMeter.js"),
  chunked: read("src/utils/chunkedGeneration.js"),
  report: read("src/utils/reportTemplate.js"),
  method: read("src/utils/methodology.js"),
  helpers: read("src/utils/helpers.js"),
  readExport: read("src/utils/readExport.js"),
  localDoc: read("src/utils/localDocRead.js"),
  session: read("src/utils/session.js"),
  bridge: read("src/utils/toolBridge.js"),
  rails: read("src/components/TokenRails.jsx"),
  settings: read("src/components/SettingsPanel.jsx"),
  app: read("src/App.jsx"),
  css: read("src/index.css"),
};

let pass = 0, fail = 0;
const results = [];
function check(group, claim, cond, detail = "") {
  const ok = !!cond;
  ok ? pass++ : fail++;
  results.push({ group, claim, ok, detail });
}
const everyTool = (fn) => TOOLS.filter((t) => !fn(A[t], t));

/* ---------------------------------------------------------------- 1. SOURCING */
check("Sourcing", "jurisdiction rule reaches the prompt",
  F.method.includes("JURISDICTION_RULE") && /checklistPrompt/.test(F.method));
check("Sourcing", "no jurisdiction-named source survives in any checklist",
  !/src:\s*"[^"]*(Delhi|Ottawa|ARCON|UAC)[^"]*"/.test(F.method));
check("Sourcing", "narrative sanitiser is applied to findings, interpretation and conclusions",
  (F.report.match(/sanitiseNarrative\(/g) || []).length >= 4);
check("Sourcing", "provenance block is rendered in section 11",
  F.report.includes("provenanceLines(provenance)"));
{
  const miss = everyTool((s) => /provenance:\s*\{/.test(s));
  check("Sourcing", "every tool passes provenance to the report", miss.length === 0, miss.join(", "));
}
check("Sourcing", "grounding default follows the declared tier",
  /getLimits\("gemini"\)\.tier === "paid"/.test(F.settings));
check("Sourcing", "an explicit grounding-off choice persists",
  /GROUND_KEY, on \? "1" : "0"/.test(F.settings));

/* ------------------------------------------------------------- 2. TOKEN BUDGET */
check("Budget", "requests are counted at the fetch, not after success",
  /recordRequest\(provider\)/.test(F.ai) && F.ai.indexOf("recordRequest(provider)") < F.ai.indexOf("const response = await makeRequest()"));
check("Budget", "request counters are per provider",
  /function reqKey\(provider\)/.test(F.tokenMeter));
check("Budget", "capacity check considers requests before tokens",
  F.tokenMeter.indexOf("requests/day") < F.tokenMeter.indexOf("tokens/minute"));
{
  const miss = everyTool((s) => /countTokensExact\(/.test(s));
  check("Budget", "every tool can count exact tokens", miss.length === 0, miss.join(", "));
}
check("Budget", "rails receive a live estimate from the active tool",
  /estimate=\{activeTool\.estimate\}/.test(F.app));
check("Budget", "rails receive a working calculate handler",
  /onCalculate=\{activeTool\.calculate/.test(F.app));
check("Budget", "rails receive a working reset handler",
  /onReset=\{activeTool\.resetUsage/.test(F.app));
check("Budget", "estimate has its own separate clear control",
  /onClearEstimate/.test(F.app) && /Clear estimate/.test(F.rails));
{
  const miss = everyTool((s) => /setActiveTool\(/.test(s));
  check("Budget", "every tool registers with the rails bridge", miss.length === 0, miss.join(", "));
}
check("Budget", "a hidden tool cannot overwrite the visible estimate",
  /if \(active\.code !== code\) return;/.test(F.bridge));

/* ---------------------------------------------------------------- 3. RESILIENCE */
check("Resilience", "capacity failures get a longer, shorter-lived retry",
  /CAPACITY_STATUSES/.test(F.ai) && /maxAttempts: 2, baseDelay: 6000/.test(F.ai));
check("Resilience", "429 is never retried (it would burn the scarce resource)",
  !/RETRY_STATUSES = \[[^\]]*429/.test(F.ai));
check("Resilience", "retry attempts shrink as request headroom shrinks",
  /function attemptsAllowed\(provider\)/.test(F.ai));
check("Resilience", "the provider's own retry-after is honoured",
  /advised = retryAfterSeconds/.test(F.ai));
check("Resilience", "reading the retry hint does not consume the body",
  /response\.clone\(\)\.text\(\)/.test(F.ai));
check("Resilience", "every provider error names its provider",
  /attributeError\("gemini"/.test(F.ai) && /attributeError\("claude"/.test(F.ai));
check("Resilience", "the Gemini model default is pinned, not an alias",
  /gemini: "gemini-2\.5-flash"/.test(F.settings));

/* -------------------------------------------------------------- 4. CONTINUATION */
{
  const expect = TOOLS.filter((t) => t !== "ConceptGenerator");
  const miss = expect.filter((t) => !/buildChunkedPrompt\(/.test(A[t]));
  check("Continuation", "every applicable tool builds a chunked prompt", miss.length === 0, miss.join(", "));
  const miss2 = expect.filter((t) => !/mergeChunk\(/.test(A[t]));
  check("Continuation", "every applicable tool merges the reply", miss2.length === 0, miss2.join(", "));
  const miss3 = expect.filter((t) => !/savePartial\(/.test(A[t]));
  check("Continuation", "partial work survives a reload", miss3.length === 0, miss3.join(", "));
  const miss4 = expect.filter((t) => !/chunkProgress\.text/.test(A[t]));
  check("Continuation", "progress is shown to the user", miss4.length === 0, miss4.join(", "));
}
check("Continuation", "Concept Generator's own per-concept retry is documented as the reason it is excluded",
  /ONE AT A TIME/.test(A.ConceptGenerator));
check("Continuation", "merge refuses to overwrite longer content with shorter",
  /text\.length < existing\.length/.test(F.chunked));
check("Continuation", "a false completion claim is rejected",
  /Trust our own record/.test(F.chunked));

/* ------------------------------------------------------------ 5. DOCUMENT INPUT */
check("Documents", "images are downscaled before upload",
  /downscaleImage/.test(F.helpers));
check("Documents", "the encoder reports its own media type",
  /fileToImagePart/.test(F.helpers));
check("Documents", "text sufficiency is checked, not just presence",
  /assessTextSufficiency/.test(F.readExport));
check("Documents", "free browser OCR runs before paid AI vision",
  F.readExport.indexOf("ocrPagesLocally") > 0 &&
  F.readExport.indexOf("ocrPagesLocally") < F.readExport.indexOf('onRasterize === "function"'));
check("Documents", "the free path states it cost nothing",
  /no tokens and no request used/.test(F.readExport));
check("Documents", "the paid path discloses that it cost something",
  /used tokens and a request/.test(F.readExport));

/* ------------------------------------------------------------------ 6. REPORTS */
check("Reports", "the twelve-block structure is intact",
  ["[1] TITLE BLOCK","[2] DOCUMENT CONTROL","[3] PURPOSE","[4] METHODOLOGY","[5] INPUT RECORD",
   "[6] FINDINGS","[7] DATA VISUALISATIONS","[8] INTERPRETATION","[9] ASSUMPTIONS",
   "[10] CONCLUSIONS","[11] REFERENCES","APPENDIX A"].every((b) => F.report.includes(b)));
check("Reports", "live-research extras are added INSIDE findings, not as new blocks",
  /extraFindings/.test(F.report) && /6\.\$\{base \+ xi \+ 1\}/.test(F.report));
check("Reports", "conclusions are split into assessments and actions",
  /10\.1  ASSESSMENT AGAINST TARGETS/.test(F.report));
{
  const miss = everyTool((s) => /missingFields\(/.test(s) || /ONE AT A TIME/.test(s));
  check("Reports", "every tool guards against dropped schema fields", miss.length === 0, miss.join(", "));
}

/* -------------------------------------------------------------------- 7. STATE */
check("State", "tools stay mounted across tab switches",
  /display: activeTab === id \? "block" : "none"/.test(F.app));
check("State", "the component registry is inside the component (circular-import safety)",
  F.app.indexOf("const TOOL_PANELS") > F.app.indexOf("export default function"));
check("State", "session save and load are reachable in the UI",
  /saveAppSessionToFile/.test(F.rails) && /loadAppSessionFromFile/.test(F.rails));
check("State", "session export refuses to write API keys",
  /FORBIDDEN/.test(F.session));
check("State", "session import refuses foreign keys",
  /never write foreign keys/.test(F.session));

/* ------------------------------------------------------------------ 8. SECURITY */
check("Security", "no hardcoded API key anywhere in source",
  !/sk-ant-[A-Za-z0-9_-]{10,}/.test(Object.values(F).join("") + Object.values(A).join("")) &&
  !/AIza[0-9A-Za-z_-]{30,}/.test(Object.values(F).join("") + Object.values(A).join("")));
check("Security", "no VITE_ env var would inline a secret into the bundle",
  !/import\.meta\.env\.VITE_[A-Z_]*KEY/.test(Object.values(F).join("")));
check("Security", "the browser-access opt-in is explicit, not silent",
  /anthropic-dangerous-direct-browser-access/.test(F.ai));

/* -------------------------------------------------------------------- 9. THEME */
check("Theme", "the dark theme is scoped to the tool shell only",
  /\.as2p-tools-theme/.test(F.css) && /as2p-shell/.test(F.app));
check("Theme", "arbitrary colour classes are caught generically, not enumerated",
  /\[class\*="bg-\[#"\]/.test(F.css) && /\[class\*="text-\[#"\]/.test(F.css));
check("Theme", "every brand token is remapped",
  ["text-brand-text","text-brand-gold","bg-brand-warm","border-brand-border","text-brand-danger"]
    .every((c) => F.css.includes(c)));
check("Theme", "buttons have a pressed state",
  /button:active:not\(:disabled\)/.test(F.css));
check("Theme", "one source of horizontal offset (no double indent)",
  !/\.as2p-shell \.as2p-wide \{[^}]*margin-left: 0 !important/.test(F.css));


/* ------------------------------------------------- 10. UNDECLARED IDENTIFIERS
 * The bug class that produced "insight is not defined" and
 * "Cannot access 'chunkProgress' before initialization".
 *
 * Both were introduced by scripted edits that assumed every tool uses the same
 * variable names. They compile fine - JavaScript only fails at RUNTIME - so the
 * build never caught them. This asserts that any tool referencing one of these
 * names actually declares it, and declares it BEFORE first use.
 */
/*
 * The broad "is every state name declared and used after declaration" check
 * that lived here has been REMOVED, deliberately.
 *
 * It produced twelve failures and every one was a false alarm:
 *   - it tested for variables tools need not have (Solar has no `analysis`);
 *   - it stripped comments but NOT string literals, so it matched the word
 *     "insight" inside button labels like "Continue insight generation";
 *   - replacing comments with a single space shifted offsets, so its
 *     "declared before first use" positions were meaningless.
 *
 * An audit that cries wolf is worse than no audit - it teaches you to skim the
 * failures. The narrower Integrity check below asks the question that actually
 * caught real crashes, and the jsdom render harness catches the rest by
 * mounting each component for real.
 */



/* ------------------------------------------ 10. REFERENCED-VARIABLE INTEGRITY
 * The over-broad version of this check tested whether every tool declared a
 * fixed list of state names. Tools legitimately differ - Solar has no
 * `analysis`, Survey has no `insight` - so it produced eleven false alarms,
 * and an audit that cries wolf trains you to ignore it.
 *
 * This version asks the only question that matters: for the variables each tool
 * ACTUALLY references in its report options, is that variable declared in that
 * tool? Comments are stripped first, because the previous version matched the
 * word "analysis" inside a comment and reported a phantom declaration.
 *
 * This is the check that caught four real crashes: extraFindings referencing an
 * `insight` variable in tools that never had one.
 */
const decomment = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m) => " ".repeat(m.length));

for (const t of TOOLS) {
  const code = decomment(A[t]);
  const refs = new Set();
  for (const re of [/extraFindings:\s*\(?\s*([A-Za-z_$][\w$]*)\s*&&/g,
                    /mode:\s*\(\s*([A-Za-z_$][\w$]*)\s*&&/g]) {
    let m; while ((m = re.exec(code))) refs.add(m[1]);
  }
  for (const v of refs) {
    const declared = new RegExp(`const\\s*\\[\\s*${v}\\s*,|const\\s+${v}\\s*=`).test(code);
    check("Integrity", `${t}: referenced variable \`${v}\` is declared`, declared);
  }
}

/* --------------------------------------------------------------------- OUTPUT */
const groups = [...new Set(results.map((r) => r.group))];
for (const g of groups) {
  console.log(`\n${g.toUpperCase()}`);
  for (const r of results.filter((x) => x.group === g)) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.claim}${r.detail && !r.ok ? "  [" + r.detail + "]" : ""}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} checks`);
process.exit(fail ? 1 : 0);
