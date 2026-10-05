import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read=relative=>fs.readFile(new URL('../'+relative,import.meta.url),'utf8');

test('canonical definition explains responsibilities authority harness and evolution visually',async()=>{
  const definition=await read('AI_NATIVE_APPLICATION.md');
  assert.match(definition,/An AI Native Application is a system in which authorized AI Agents carry responsibilities on behalf of clearly identified principals/);
  for(const term of [
    'User Assistant AI',
    'Business AI Agent',
    'Platform AI',
    'principal',
    'Actor',
    'Permission',
    'Mandate',
    'payer',
    'revocation',
    'deterministic Harness',
    'idempotency',
    'reconciliation',
    'evidence'
  ]) assert.match(definition,new RegExp(term,'i'),term);
  assert.ok((definition.match(/```mermaid/g)||[]).length>=5,'expected at least five Mermaid diagrams');
  assert.match(definition,/Role does not grant authority/i);
  assert.match(definition,/model statement is not proof of an effect/i);
  assert.match(definition,/feedback[^\n]*untrusted evidence/i);
  assert.match(definition,/external personal Agent/i);
  assert.match(definition,/API, MCP, A2A, or another adapter/i);
  for(let number=1;number<=12;number++) assert.match(definition,new RegExp(`^${number}\\. `,'m'),`missing design question ${number}`);
  for(const link of ['CORE_REQUIREMENTS.md','ACCEPTANCE.md','STATUS.md','GETTING_STARTED.md','FRAMEWORK_FEEDBACK.md']){
    assert.match(definition,new RegExp(`\\(${link.replace('.','\\.')}\\)`),`missing ${link} link`);
  }
  assert.doesNotMatch(definition,/all Core capabilities (are|have been) complete/i);
  assert.doesNotMatch(definition,/production adoption (is|has been) verified/i);
});

test('repository entry points identify the canonical definition without duplicating it',async()=>{
  const [readme,gettingStarted,requirements]=await Promise.all([
    read('README.md'),read('GETTING_STARTED.md'),read('CORE_REQUIREMENTS.md')
  ]);
  const readmeLink=readme.indexOf('[AI Native Application](AI_NATIVE_APPLICATION.md)');
  assert.ok(readmeLink>=0,'README missing canonical definition link');
  assert.ok(readmeLink<readme.indexOf('npm ci'),'README must link the definition before setup');
  const gettingStartedLink=gettingStarted.indexOf('[AI Native Application definition](AI_NATIVE_APPLICATION.md)');
  assert.ok(gettingStartedLink>=0,'Getting Started missing definition link');
  assert.ok(gettingStartedLink<gettingStarted.indexOf('## 2. Start with one capability'),'Getting Started must link before capability composition');
  assert.match(requirements,/canonical conceptual contract[^\n]*\[AI Native Application definition\]\(AI_NATIVE_APPLICATION\.md\)/i);
});

test('published package includes and independently verifies the canonical definition',async()=>{
  const pkg=JSON.parse(await read('package.json'));
  assert.equal(pkg.files.includes('AI_NATIVE_APPLICATION.md'),true,'definition missing from package files');
  const verifier=await read('scripts/verify-package.mjs');
  assert.match(verifier,/['"]AI_NATIVE_APPLICATION\.md['"]/);
});
