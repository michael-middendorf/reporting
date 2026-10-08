
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSessionToken, verifySessionToken, createMfaPendingToken, verifyMfaPendingToken, currentMfaPendingContext } from './auth';
test('signed provenance rejects email sessions and survives mandatory MFA', () => {
 const flag=process.env.SSO_ONLY, cutoff=process.env.SSO_CUTOVER_AT, secret=process.env.AUTH_SECRET;
 try {
  process.env.SSO_ONLY='true'; process.env.SSO_CUTOVER_AT='2026-01-01T00:00:00Z'; process.env.AUTH_SECRET='synthetic-test-signing-key';
  assert.throws(() => verifySessionToken(createSessionToken('staff@avemaria.edu',process.env.AUTH_SECRET!,1), process.env.AUTH_SECRET!));
  const pending=createMfaPendingToken('staff@avemaria.edu',process.env.AUTH_SECRET!,10,{auth:'entra'});
  const context=currentMfaPendingContext(new Request('https://example.invalid',{headers:{cookie:'amu_reporting_mfa_pending='+pending}}));
  assert.equal(context?.method,'entra');
  const final=createSessionToken('staff@avemaria.edu',process.env.AUTH_SECRET!,1,{mfa:true,auth:context!.method,authCreatedAt:context!.createdAt});
  assert.equal(verifySessionToken(final,process.env.AUTH_SECRET!).mfa,true);
  process.env.SSO_CUTOVER_AT=new Date(Date.now()+1000).toISOString();
  assert.throws(()=>verifyMfaPendingToken(pending,process.env.AUTH_SECRET!));
  assert.throws(()=>verifySessionToken(final,process.env.AUTH_SECRET!));
 } finally {
  for(const [key,value] of [['SSO_ONLY',flag],['SSO_CUTOVER_AT',cutoff],['AUTH_SECRET',secret]]) {if(value===undefined)delete process.env[key!];else process.env[key!]=value;}
 }
});
