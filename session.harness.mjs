// SESSION HARNESS — proves save/restore carries what the user typed.
//
// The three symptoms it was written for (stale estimate, missing Cancel button,
// session restoring nothing) all had ONE cause: the bridge held a single slot
// that every tool wrote on mount, so it pointed at whichever tool mounted LAST
// rather than the visible one. Every guarded update from the tool on screen was
// dropped. The registry is now keyed by tool code with an explicit active
// pointer, and this asserts it.
import { JSDOM } from "jsdom";
const dom=new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>",{url:"https://localhost/",pretendToBeVisual:true});
global.window=dom.window; global.document=dom.window.document;
Object.defineProperty(global,"navigator",{value:dom.window.navigator,configurable:true});
global.HTMLElement=dom.window.HTMLElement; global.localStorage=dom.window.localStorage;
global.Blob=dom.window.Blob; global.URL.createObjectURL=()=>"blob:x"; global.URL.revokeObjectURL=()=>{};
global.IS_REACT_ACT_ENVIRONMENT=true;
global.fetch=async()=>({ok:true,status:200,headers:{get:()=>null},json:async()=>({})});
dom.window.matchMedia=dom.window.matchMedia||(()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}}));
global.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}}; dom.window.ResizeObserver=global.ResizeObserver;
global.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}}; dom.window.IntersectionObserver=global.IntersectionObserver;
global.scrollTo=()=>{}; dom.window.scrollTo=()=>{};
const React=(await import("react")).default; global.React=React; dom.window.React=React;
const {createRoot}=await import("react-dom/client"); const {act}=await import("react");
const ALL=await import("./harness_out/all.mjs");
const oe=console.error; console.error=()=>{};

const host=dom.window.document.createElement("div"); dom.window.document.body.appendChild(host);
const root=createRoot(host);
await act(async()=>{root.render(React.createElement(ALL.default,{}));});
console.error=oe;
let fail=0; const t=(n,c,x="")=>{console.log((c?"PASS  ":"FAIL  ")+n+(x?"  "+x:""));if(!c)fail++;};

// open Wind
const node=host.querySelector('[data-tab="wind"]');
await act(async()=>{ node.dispatchEvent(new dom.window.MouseEvent("click",{bubbles:true})); });
t("wind tool opened", !!host.querySelector("input"));

// the bridge must now point at WND, not whatever mounted last
t("active tool follows the visible tab", ALL.getActiveTool().code==="WND", ALL.getActiveTool().code||"(none)");

// type a location the way a user would
const setVal=(el,v)=>{
  const proto=Object.getPrototypeOf(el);
  const d=Object.getOwnPropertyDescriptor(proto,"value");
  d.set.call(el,v);
  el.dispatchEvent(new dom.window.Event("input",{bubbles:true}));
};
// Hidden tools stay in the DOM (keep-alive), so querying the whole host picks up
// the FIRST tool's inputs rather than the visible one. Scope to the visible panel
// or the test silently exercises the wrong component - which it did, and produced
// a false failure that nearly sent me chasing a bug that was not there.
const panels=[...host.querySelectorAll("div")].filter(d=>d.style && d.style.display==="block");
const visible=panels[panels.length-1]||host;
const inputs=[...visible.querySelectorAll('input[type="text"], input:not([type])')];
const loc=inputs[0];
if(loc) await act(async()=>{ setVal(loc,"Al Safa 2 Park, Dubai"); });
t("typed value is in the DOM", loc && loc.value==="Al Safa 2 Park, Dubai", loc?loc.value:"(no input)");

// snapshot must contain what was typed
const snap=ALL.snapshotAllTools();
const wnd=snap.WND||{};
t("snapshot includes the WND tool", !!snap.WND, Object.keys(snap).join(",")||"(empty)");
t("snapshot captured the typed location", wnd.location==="Al Safa 2 Park, Dubai", JSON.stringify(wnd.location));

// wipe and restore
if(loc) await act(async()=>{ setVal(loc,""); });
t("input cleared", loc && loc.value==="");
await act(async()=>{ ALL.restoreAllTools(snap); });
t("RESTORE puts the value back in the input", loc && loc.value==="Al Safa 2 Park, Dubai", loc?loc.value:"?");
console.log(fail?`\n${fail} FAILURE(S)`:"\nALL PASS");process.exit(fail?1:0);
