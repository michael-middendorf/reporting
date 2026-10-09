import assert from "node:assert/strict";
import test from "node:test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
import {MicrosoftAuthenticatorInstructions} from "./MicrosoftAuthenticatorInstructions";
import {createRequire} from "node:module";

test("Microsoft-only login retains the existing branded CSS card and button without an email fallback",async()=>{
 const require=createRequire(import.meta.url);const extensions=require.extensions as Record<string,unknown>;const css=extensions[".css"];
 extensions[".css"]=(module:{exports:unknown},file:string)=>{
  const classes=Object.fromEntries([...readFileSync(file,"utf8").matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)].map(match=>[match[1],"auth-"+match[1]]));
  module.exports={__esModule:true,default:classes};
 };
 try {
  const {default:LoginClient}=await import("../app/login/LoginClient");
  for(const enabled of [true,false]) {
   const html=renderToStaticMarkup(createElement(LoginClient,{microsoftEnabled:enabled}));
   assert.doesNotMatch(html,/<form|type="email"|email link|email me|mx-auto|bg-blue-/i);
   assert.match(html,/<main class="auth-card"/);assert.match(html,/class="auth-eyebrow"/);assert.match(html,/<h1>AMU Reporting<\/h1>/);
   assert.match(html,enabled?/class="auth-microsoftLink"/:/role="alert" class="auth-status err"/);
   assert.match(html,enabled?/Sign in with Microsoft/:/temporarily unavailable/);
  }
 }finally{if(css)extensions[".css"]=css;else delete extensions[".css"];}
});

test("actual rendered setup and manual instructions name the separate entry and preserve University account",()=>{
 for(const qr of [true,false]) {
  const html=renderToStaticMarkup(createElement(MicrosoftAuthenticatorInstructions,{setup:true,hasQr:qr}));
  assert.equal((html.match(/<li>/g)||[]).length,6);
  assert.match(html,/Microsoft Authenticator/);assert.match(html,/Other account/);
  assert.match(html,/Keep your existing University account/);assert.match(html,/new AMU Academic Affairs entry/);
  assert.match(html,/Enter code manually/);assert.match(html,/Select Verify/);
  assert.doesNotMatch(html,/Google Authenticator|Authy|1Password/);
 }
});
test("verification instructions and both real MFA pages agree on entry and Verify button without changing QR wiring",()=>{
 const html=renderToStaticMarkup(createElement(MicrosoftAuthenticatorInstructions,{setup:false}));
 assert.match(html,/AMU Academic Affairs entry/);assert.match(html,/current 6-digit code/);assert.doesNotMatch(html,/<ol|scan/i);
 for(const path of ["src/app/auth/mfa/page.tsx","src/app/athletics/coaching/mfa/page.tsx"]) {
  const source=readFileSync(path,"utf8");assert.match(source,/MicrosoftAuthenticatorInstructions setup hasQr/);
  assert.match(source,/MicrosoftAuthenticatorInstructions setup=\{false\}/);assert.match(source,/>\s*Verify\s*</);
  assert.match(source,/AuthenticatorSetup/);assert.match(source,/otpauth=\{otpauth\}/);
  assert.doesNotMatch(source,/Google Authenticator|Authy|1Password|reporting email link/);
 }
});
