// FLOW HARNESS — tests the paths a USER takes, not components in isolation.
//
// Written because a blank page appeared when opening Site Context from the
// landing page, while every component passed the isolation harness. Mounting a
// component with hand-made props proves it can render; it does not prove the
// route that reaches it works. These two harnesses answer different questions
// and BOTH are required before claiming a fix is done.
import { JSDOM } from "jsdom";
const dom=new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>",
  {url:"https://localhost/",pretendToBeVisual:true});
global.window=dom.window; global.document=dom.window.document;
Object.defineProperty(global,"navigator",{value:dom.window.navigator,configurable:true});
global.HTMLElement=dom.window.HTMLElement; global.localStorage=dom.window.localStorage;
global.Blob=dom.window.Blob; global.URL.createObjectURL=()=>"blob:x"; global.URL.revokeObjectURL=()=>{};
global.IS_REACT_ACT_ENVIRONMENT=true;
global.fetch=async()=>({ok:true,status:200,headers:{get:()=>null},json:async()=>({})});
dom.window.matchMedia=dom.window.matchMedia||(()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}}));
global.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}}; dom.window.ResizeObserver=global.ResizeObserver;
global.HTMLMediaElement=dom.window.HTMLMediaElement;
if (global.HTMLMediaElement) { global.HTMLMediaElement.prototype.play=()=>Promise.resolve(); global.HTMLMediaElement.prototype.pause=()=>{}; }
global.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
dom.window.IntersectionObserver=global.IntersectionObserver;
global.scrollTo=()=>{}; dom.window.scrollTo=()=>{};

const React=(await import("react")).default; global.React=React; dom.window.React=React;
const {createRoot}=await import("react-dom/client"); const {act}=await import("react");
const ALL=await import("./harness_out/all.mjs");

let fail=0; const errs=[];
const oe=console.error, ow=console.warn;
console.error=(...a)=>errs.push(String(a[0]).slice(0,220)); console.warn=()=>{};

const host=dom.window.document.createElement("div");
dom.window.document.body.appendChild(host);
const root=createRoot(host);
await act(async()=>{root.render(React.createElement(ALL.default||ALL.App,{})); });

const t=(n,c,x="")=>{console.error===oe||0; (c?0:fail++); console.log((c?"PASS  ":"FAIL  ")+n+(x?"  "+x:""));};
const realErrs=()=>errs.filter(e=>!/not wrapped in act|useLayoutEffect does nothing/i.test(e));

console.log("STEP 1 — landing renders");
t("landing mounts without error", realErrs().length===0, realErrs()[0]||"");
const bodyText=()=>(host.textContent||"").replace(/\s+/g," ");
t("landing has content", bodyText().length>50, `${bodyText().length} chars`);

// The nexus renders tool entries as .tool-node divs carrying data-tab, NOT as
// buttons - which is why an earlier probe looking for buttons found nothing and
// reported a false all-clear.
const TOOLS=[["site","Site Context"],["solar","Solar"],["survey","Survey"],["wind","Wind"],
             ["veg","Vegetation"],["concept","Concept Gen"],["budget","Budget"],["combined","Combined Doc"]];
console.log(`\nSTEP 2 — open each tool from the nexus (${host.querySelectorAll("[data-tab]").length} tool nodes found)`);
for(const [tab,label] of TOOLS){
  errs.length=0;
  const el=host.querySelector(`[data-tab="${tab}"]`);
  if(!el){ console.log(`FAIL  ${label} — no [data-tab="${tab}"] node on the nexus`); fail++; continue; }
  try{
    await act(async()=>{ el.dispatchEvent(new dom.window.MouseEvent("click",{bubbles:true})); });
    const txt=bodyText();
    const blank = txt.length < 40;
    const crashed = realErrs().length>0;
    const boundary = /hit a display error/.test(txt);
    t(`open "${label}" — no crash`, !crashed && !blank, crashed?realErrs()[0]:(blank?`page blank (${txt.length} chars)`:""));
    if(boundary) { fail++; console.log(`      error boundary shown for ${label} — a real render failure`); }
    // return to landing for the next probe
    const home=[...host.querySelectorAll("button,a")].find(c=>/home|back/i.test(c.textContent||""));
    if(home) await act(async()=>{ home.dispatchEvent(new dom.window.MouseEvent("click",{bubbles:true})); });
  }catch(e){ fail++; console.log(`FAIL  open "${label}" threw  ${String(e.message).slice(0,120)}`); }
}

// STEP 3 — switch between tabs inside the workspace. Keep-alive means every
// visited tool stays mounted, so a fault in one can break the whole view.
console.log("\nSTEP 3 — switch between tool tabs in the workspace");
{
  errs.length=0;
  const first=host.querySelector('[data-tab="site"]');
  if(first) await act(async()=>{ first.dispatchEvent(new dom.window.MouseEvent("click",{bubbles:true})); });
  const tabs=[...host.querySelectorAll("button")].filter(b=>
    /site context|solar|survey|wind|vegetation|concept|budget|combined/i.test((b.textContent||"").trim()));
  t("workspace tab strip is present", tabs.length>=4, `${tabs.length} tabs`);
  for(const tab of tabs){
    errs.length=0;
    const label=(tab.textContent||"").trim().slice(0,20);
    await act(async()=>{ tab.dispatchEvent(new dom.window.MouseEvent("click",{bubbles:true})); });
    const txt=bodyText();
    t(`switch to "${label}"`, realErrs().length===0 && txt.length>40 && !/hit a display error/.test(txt),
      realErrs()[0]||"");
  }
  // every visited tool must survive being switched away from and back
  errs.length=0;
  if(tabs.length>1){
    await act(async()=>{ tabs[0].dispatchEvent(new dom.window.MouseEvent("click",{bubbles:true})); });
    await act(async()=>{ tabs[1].dispatchEvent(new dom.window.MouseEvent("click",{bubbles:true})); });
    await act(async()=>{ tabs[0].dispatchEvent(new dom.window.MouseEvent("click",{bubbles:true})); });
    t("round-trip between tabs keeps the view alive",
      realErrs().length===0 && bodyText().length>40, realErrs()[0]||"");
  }
}

// STEP 4 — settings panel opens over the workspace
console.log("\nSTEP 4 — open the settings panel");
{
  errs.length=0;
  const gear=[...host.querySelectorAll("button")].find(b=>/settings/i.test(b.textContent||""));
  if(!gear){ console.log("FAIL  settings control not found"); fail++; }
  else{
    await act(async()=>{ gear.dispatchEvent(new dom.window.MouseEvent("click",{bubbles:true})); });
    const txt=bodyText();
    t("settings opens without crashing", realErrs().length===0 && txt.length>40, realErrs()[0]||"");
    t("settings shows provider fields", /api|key|provider|tier/i.test(txt));
  }
}

console.error=oe; console.warn=ow;
console.log(fail?`\n${fail} FLOW FAILURE(S)`:"\nAll flows clean");
process.exit(fail?1:0);
