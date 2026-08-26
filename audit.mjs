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
  // The guard used to be a single-slot check. The bridge now keeps a MAP keyed
  // by tool code, so each tool writes only into its own entry and cross-tool
  // clobbering is impossible by construction rather than by a guard clause.
  /const tools = new Map\(\)/.test(F.bridge) && /entry\(code\)\.estimate = estimate/.test(F.bridge));
check("Budget", "the visible tool is chosen by the tab, not by mount order",
  // The original bug: every tool called setActiveTool on mount, so the LAST one
  // mounted won and the rails showed its data instead of the current tool's.
  /export function setActiveCode/.test(F.bridge) && /setActiveCode\(TAB_TOOL_CODE\[activeTab\]/.test(F.app));

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
  // Was `text.length < existing.length` - string-only, and dropping arrays was
  // what blanked the page. Now compares content VOLUME across any value type.
  /volume\(next\.sections\[k\]\) > vol/.test(F.chunked));
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


/* ------------------------------------------------- 11. THIS PASS'S FIXES */
check("Crash", "merged sections keep arrays and objects (the blank-page cause)",
  /const volume = \(v\) =>/.test(F.chunked) && !/typeof incoming\[k\] === "string" \? incoming\[k\]\.trim\(\) : ""/.test(F.chunked));
check("Crash", "size comparison uses content volume, not string length",
  /volume\(next\.sections\[k\]\) > vol/.test(F.chunked));
check("Crash", "an error boundary wraps every tool",
  /ToolErrorBoundary/.test(F.app) && fs.existsSync("src/components/ToolErrorBoundary.jsx"));
check("Crash", "the boundary tells the user nothing was lost",
  /Nothing generated has been lost/.test(read("src/components/ToolErrorBoundary.jsx")));
{
  const expect = TOOLS.filter((t) => t !== "ConceptGenerator");
  const a = expect.filter((t) => !/function startFreshInsight/.test(A[t]));
  check("Continuation", "Generate always starts fresh", a.length === 0, a.join(", "));
  const b = expect.filter((t) => !/onClick=\{continueInsight\}/.test(A[t]));
  check("Continuation", "a separate Continue button exists", b.length === 0, b.join(", "));
  const c = expect.filter((t) => !/onClick=\{startFreshInsight\}/.test(A[t]));
  check("Continuation", "Generate is wired to the fresh-start handler", c.length === 0, c.join(", "));
}
check("Theme", "neon styling matches by element, so inline-styled buttons are caught",
  /\.as2p-tools-theme button:not\(\.btn-outline\)/.test(F.css));
check("Theme", "rails keep their own button styling",
  /\.as2p-rail-stack button/.test(F.css));
check("Theme", "header, main and settings share one padding rule",
  /\.as2p-shell > div:not\(\.as2p-rail-stack\) \{\s*\n?\s*padding-left/.test(F.css));


/* ------------------------------------------ 12. IMPORT INTEGRITY
 * A JSX component referenced but never imported COMPILES CLEANLY and then
 * throws "X is not defined" the moment that branch renders. That is exactly how
 * <ToolErrorBoundary> shipped and blanked the page on opening Site Context.
 * The build cannot catch it; this can.
 */
{
  const files = { "App.jsx": F.app, "TokenRails.jsx": F.rails, "SettingsPanel.jsx": F.settings,
                  ...Object.fromEntries(TOOLS.map((t) => [t + ".jsx", A[t]])) };
  for (const [name, src] of Object.entries(files)) {
    if (!src) continue;
    const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    const used = new Set([...code.matchAll(/<([A-Z][A-Za-z0-9_]*)[\s/>]/g)].map((m) => m[1]));
    // Imports may span multiple lines, so match the whole statement including
    // newlines. The single-line version reported nine phantom failures.
    const imported = new Set();
    for (const m of code.matchAll(/import\s+([\s\S]*?)\s+from\s*["']/g)) {
      const clause = m[1];
      const named = clause.match(/\{([\s\S]*?)\}/);
      if (named) named[1].split(",").forEach((x) => {
        const n = x.trim().split(/\s+as\s+/).pop().trim();
        if (n) imported.add(n);
      });
      const def = clause.replace(/\{[\s\S]*?\}/, "").split(",")[0].trim();
      if (def && /^[A-Za-z0-9_$*]+$/.test(def)) imported.add(def.replace(/^\*\s*as\s*/, ""));
    }
    const declared = new Set([...code.matchAll(/(?:function|const|class)\s+([A-Z][A-Za-z0-9_]*)/g)].map((m) => m[1]));
    const missing = [...used].filter((u) => !imported.has(u) && !declared.has(u) && !/^(Fragment|React|Component)$/.test(u));
    check("Imports", `${name}: every JSX component is imported or declared`,
      missing.length === 0, missing.join(", "));
  }
}


/* ------------------------------- 13. FUNCTION IMPORT INTEGRITY
 * The check above covers JSX components. This covers plain functions from our
 * own modules - setActiveBusy was called in seven tools and imported in one,
 * and `npm run build` reported success. Only a runtime click found it.
 */
{
  const OWN = ["setActiveTool","setActiveEstimate","setActiveBusy","clearActiveTool",
               "buildChunkedPrompt","mergeChunk","emptyState","isComplete","progressLabel",
               "savePartial","loadPartial","clearPartial","countTokensExact","estimateRun",
               "getUsage","recordUsage","resetUsage","missingFields","missingFieldsNote",
               "callAI","abortMessage"];
  for (const t of TOOLS) {
    const code = A[t].replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    const importBlock = (code.match(/import[\s\S]*?from\s*["'][^"']+["'];?/g) || []).join("\n");
    const missing = OWN.filter((fn) =>
      new RegExp("(?<![\\w$.])" + fn + "\\s*\\(").test(code) &&
      !new RegExp("(?<![\\w$])" + fn + "(?![\\w$])").test(importBlock) &&
      !new RegExp("function\\s+" + fn + "(?![\\w$])").test(code));
    check("Imports", `${t}: every imported function it calls is imported`,
      missing.length === 0, missing.join(", "));
  }
}


/* ----------------------------------------- 14. STALE CLOSURE + BUSY LIFECYCLE */
{
  const miss = everyTool((src) => /bridgeRef\.current/.test(src));
  check("Bridge", "handlers read a live ref, not a first-render closure", miss.length === 0, miss.join(", "));
  // The tools expose a lazy getState() through the ref, not a `state` property.
  // The assertion was checking for a shape that never existed - a false alarm,
  // and the reason to always confirm a FAIL is real before touching the code.
  const m2 = everyTool((src) => /snapshot: \(\) => \(bridgeRef\.current\.getState/.test(src));
  check("Session", "the snapshot reads current state through a live ref", m2.length === 0, m2.join(", "));
  const m3 = everyTool((src) => /function endBusy/.test(src));
  check("Cancel", "busy is cleared when a request ENDS, not only when cancelled", m3.length === 0, m3.join(", "));
  const m4 = everyTool((src) => /as2p-inline-cancel/.test(src));
  check("Cancel", "an inline Cancel button sits beside the generate button", m4.length === 0, m4.join(", "));
  // every finally that resets a loading flag must also clear busy
  for (const t of TOOLS) {
    const bad = (A[t].match(/finally\s*\{(?![^}]*endBusy)[^}]*set\w*Loading\(false\)/g) || []).length;
    check("Cancel", `${t}: no request path leaves busy stuck on`, bad === 0, `${bad} uncovered`);
  }
}
check("Session", "the session file carries tool inputs, not just storage",
  /toolState: stripSecrets\(toolState\)/.test(F.session));
check("Session", "save collects every mounted tool's state",
  /snapshotAllTools\(\)/.test(F.rails));
check("Session", "load pushes state back into the tools",
  /restoreAllTools\(/.test(F.rails));
check("Session", "state for an unopened tool is deferred, not discarded",
  /takePendingState/.test(F.bridge));
check("Budget", "the estimate reads real inputs, not empty chunk state",
  !/const preview = JSON\.stringify\(chunkState\.sections \|\| \{\}\)/.test(Object.values(A).join("")));
check("Resilience", "a bare timeout is classified as an abort, not raw text",
  /abort\|timeout\|cancell\?ed/.test(F.ai));


/* ------------------------------------------ 14. CANCEL REACHABILITY
 * The Cancel control existed only in the Budget rail, off to the side. While a
 * run is in flight the user is looking at the Generate button, so a cancel they
 * cannot see is a cancel that does not exist.
 */
{
  const a = TOOLS.filter((t) => !/onClick=\{cancelRequest\}/.test(A[t]));
  check("Cancel", "every tool has an inline Cancel beside Generate", a.length === 0, a.join(", "));
  const b = TOOLS.filter((t) => !/setActiveBusy\(/.test(A[t]));
  check("Cancel", "every tool publishes its busy state to the rail", b.length === 0, b.join(", "));
  check("Cancel", "the rail renders a Cancel while busy",
    /busy && onCancel/.test(F.rails));
  check("Cancel", "a stalled request cannot hang forever",
    // The timeout is now passed as an explicit parameter: `opts` exists only in
    // callAI, and referencing it inside the provider functions threw
    // "opts is not defined" on every call.
    /REQUEST_TIMEOUT_MS/.test(F.ai) && /makeSignal\(abortSignal, timeoutMs \|\| timeoutFor\(\{ useWebSearch \}\)\)/.test(F.ai));
  check("Cancel", "timeouts are generous enough not to kill a slow model",
    // 90s was set from guesswork and fired on ordinary runs with grounding OFF.
    /REQUEST_TIMEOUT_MS = 240000/.test(F.ai) && /RESEARCH_TIMEOUT_MS = 300000/.test(F.ai));
  check("Cancel", "grounded research gets the longer budget",
    /opts\.useWebSearch \? RESEARCH_TIMEOUT_MS : REQUEST_TIMEOUT_MS/.test(F.ai));
  check("Budget", "the request count explains itself",
    /recordRequestReason/.test(F.ai) && /recentRequestReasons/.test(F.rails));
  check("Cancel", "a pre-aborted signal throws instead of hanging",
    /ALREADY-ABORTED SIGNALS MUST THROW/.test(F.ai));
  check("Cancel", "a timeout is classified, not surfaced as a bare word",
    /abort\|timeout\|cancell\?ed/.test(F.ai));
}


/* ------------------------------------------- 15. LINT GATE
 * ESLint no-undef is the only layer that catches an undefined identifier. The
 * build resolves modules and checks syntax; it does not check scope. Six real
 * crashes were found the first time it ran.
 */
check("Lint", "a lint gate exists in package.json",
  /"lint":\s*"eslint src"/.test(read("package.json")));
check("Lint", "verify runs lint before build and audit",
  /"verify":\s*"npm run lint && npm run build && node audit.mjs"/.test(read("package.json")));
check("Lint", "no-undef is enabled",
  /"no-undef":\s*"error"/.test(read("eslint.config.js")));
check("Lint", "JSX components are scope-checked too",
  /"react\/jsx-no-undef":\s*"error"/.test(read("eslint.config.js")));

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
