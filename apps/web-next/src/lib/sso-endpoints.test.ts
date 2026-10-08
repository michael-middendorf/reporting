import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POST as post0 } from '../app/api/auth/request/route';
import { POST as post1 } from '../app/api/auth/complete/route';
test('emailed credential routes reject before parsing a body or calling dependencies', async () => {
 const flag=process.env.SSO_ONLY, original=globalThis.fetch;
 let calls=0;
 try {
  process.env.SSO_ONLY='true'; globalThis.fetch=async()=>{calls++;throw new Error('Unexpected upstream call');};
  for(const route of [post0,post1]) {
   const response=await route(new Request('https://example.invalid',{method:'POST',body:'not-json'}) as never);
   assert.equal(response.status,410);
  }
  assert.equal(calls,0);
 } finally {
  globalThis.fetch=original;
  if(flag===undefined)delete process.env.SSO_ONLY;else process.env.SSO_ONLY=flag;
 }
});
