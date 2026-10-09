import assert from "node:assert/strict";
import test from "node:test";
import {createRequire} from "node:module";

test("actual private provider hides on first401, retains503/403, coalesces and cleans observers",async()=>{
 const require=createRequire(import.meta.url);const reactId=require.resolve("react"),navId=require.resolve("next/navigation");
 const react=require("react");require("next/navigation");const savedReact=require.cache[reactId],savedNav=require.cache[navId];
 const savedFetch=globalThis.fetch,savedWindow=Object.getOwnPropertyDescriptor(globalThis,"window"),savedDocument=Object.getOwnPropertyDescriptor(globalThis,"document"),savedStorage=Object.getOwnPropertyDescriptor(globalThis,"sessionStorage");
 const states:unknown[]=[];let index=0;const effects:Array<()=>unknown>=[];let tick=()=>{},cancelled=false;
 const redirects:string[]=[];
 const browser=Object.assign(new EventTarget(),{setInterval:(fn:()=>void,ms:number)=>{assert.equal(ms,30000);tick=fn;return 1;},clearInterval:()=>{cancelled=true;},location:{pathname:"/advancement",search:"?view=current",replace:(url:string)=>redirects.push(url)}});
 const document=Object.assign(new EventTarget(),{visibilityState:"visible"});
 Object.defineProperty(globalThis,"sessionStorage",{value:{getItem:()=>null,removeItem:()=>{}},configurable:true});
 Object.defineProperty(globalThis,"window",{value:browser,configurable:true});Object.defineProperty(globalThis,"document",{value:document,configurable:true});
 require.cache[reactId]={...savedReact,exports:{...react,createContext:()=>({Provider:()=>null}),useState:(initial:unknown)=>{const slot=index++;states[slot]=initial;return[initial,(value:unknown)=>{states[slot]=value;}];},useEffect:(fn:()=>unknown)=>{effects.push(fn);}}} as typeof savedReact;
 require.cache[navId]={...savedNav,exports:{usePathname:()=>browser.location.pathname}} as typeof savedNav;
 try {
  const {SessionProvider}=await import("./SessionProvider");SessionProvider({children:"private-rendered-data"});
  let calls=0;let release!:(response:Response)=>void;
  globalThis.fetch=async()=>{calls++;return new Promise<Response>(resolve=>{release=resolve;});};
  const cleanup=effects[0]() as ()=>void;browser.dispatchEvent(new Event("focus"));tick();assert.equal(calls,1);
  release(new Response(null,{status:503}));await new Promise(resolve=>setImmediate(resolve));assert.equal(states[1],false);
  globalThis.fetch=async()=>new Response(null,{status:403});tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(states[1],false);assert.deepEqual(redirects,[]);
  globalThis.fetch=async()=>new Response(null,{status:401});tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(states[1],true);assert.deepEqual(redirects,["/login?next=%2Fadvancement%3Fview%3Dcurrent"]);
  cleanup();assert.equal(cancelled,true);
  globalThis.fetch=async()=>{throw Error("observer leaked");};browser.dispatchEvent(new Event("focus"));tick();
 } finally {
  globalThis.fetch=savedFetch;require.cache[reactId]=savedReact;require.cache[navId]=savedNav;
  for(const [name,descriptor] of [["window",savedWindow],["document",savedDocument],["sessionStorage",savedStorage]] as const){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}
 }
});
