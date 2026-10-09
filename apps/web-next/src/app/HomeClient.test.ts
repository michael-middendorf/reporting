import assert from "node:assert/strict";
import test from "node:test";
import {createRequire} from "node:module";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";

test("actual home uses the same verified provider state for cached cards, confirmed401 and retained outage",async()=>{
 const require=createRequire(import.meta.url),providerId=require.resolve("../components/SessionProvider");
 const cache=require.cache[providerId];const extensions=require.extensions as Record<string,unknown>;const css=extensions[".css"];
 const oldFetch=globalThis.fetch;let state:{authenticated:boolean;email?:string;reports?:string[]}|null={authenticated:true,email:"staff@example.invalid",reports:["enrollment"]};
 extensions[".css"]=(module:{exports:unknown})=>{module.exports={__esModule:true,default:new Proxy({},{get:()=>"style"})};};
 require.cache[providerId]={id:providerId,filename:providerId,loaded:true,exports:{useCurrentSession:()=>state}} as typeof cache;
 globalThis.fetch=async()=>{throw Error("home must not independently read or mutate auth");};
 try {
  const {default:HomeClient}=await import("./HomeClient");
  const render=()=>renderToStaticMarkup(createElement(HomeClient,{microsoftEnabled:true}));
  const known=render();assert.match(known,/href="\/enrollment"/);
  // Verification outage leaves the provider's known row intact.
  assert.equal(render(),known);
  state={authenticated:false};const exited=render();assert.match(exited,/Sign in with Microsoft/);assert.doesNotMatch(exited,/href="\/enrollment"|<form|type="email"/);
  assert.equal(render(),exited,"anonymous root does not independently redirect or poll");
 }finally{globalThis.fetch=oldFetch;if(cache)require.cache[providerId]=cache;else delete require.cache[providerId];if(css)extensions[".css"]=css;else delete extensions[".css"];}
});
