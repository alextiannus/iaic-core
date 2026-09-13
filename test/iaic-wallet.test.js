import test from 'node:test';import assert from 'node:assert/strict';
import {WalletReader} from '@immedi/iaic-core/billing/wallet.js';
test('standalone wallet contract authenticates before ledger access and omits internal evidence',async()=>{
 let reads=0;const scope={applicationId:'another-app',subjectId:'person'};
 const ledger={balance:async s=>{assert.equal(s,scope);reads++;return {balance:'10',reserved:'0',available:'10',unit:'credit_minor'};},entries:async()=>[{id:'1',kind:'settlement',delta:'0',reference:'request',created_at:'2026-09-12',evidence:{mode:'BYOK',usage:{input_tokens:5,output_tokens:2,rawProviderUsage:{private:'internal-evidence'}},private:'internal-evidence'}}],pending:async()=>[]};
 const wallet=new WalletReader({ledger,resolveScope:async actor=>{if(actor!=='owner')throw Object.assign(new Error('Denied'),{statusCode:403});return scope;}});
 await assert.rejects(wallet.read('other'),{statusCode:403});assert.equal(reads,0);
 const result=await wallet.tool('owner').handler({});assert.equal(result.entries[0].usage.inputTokens,5);assert.equal(result.entries[0].delta,'0');assert.ok(!JSON.stringify(result).includes('internal-evidence'));assert.equal(result.nextCursor,null);
});
