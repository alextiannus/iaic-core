import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=relative=>fs.readFile(new URL('../'+relative,import.meta.url),'utf8');

test('feedback entry point gives human and AI developers a complete safe quick start',async()=>{
  const guide=await read('FRAMEWORK_FEEDBACK.md');
  for(const heading of ['## Quick start','## Use this when','## Do not use this for','## Human Developer instructions','## AI Developer instructions','## What happens next']){
    assert.match(guide,new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
  assert.match(guide,/under five minutes/i);
  assert.match(guide,/Not verified/);
  assert.match(guide,/untrusted/i);
  assert.match(guide,/do not execute/i);
  assert.match(guide,/feedback\/TEMPLATE\.md/);
  assert.match(guide,/npm run feedback:verify/);
  assert.match(guide,/<!-- feedback-index:start -->[\s\S]*<!-- feedback-index:end -->/);
  const positiveExample=await read('feedback/examples/valid-framework-gap.md');
  assert.match(positiveExample,/synthetic|fixture/i);
  assert.doesNotMatch(positiveExample,/a13f91c|7bb42de/);
  await fs.access(new URL('../feedback/examples/application-specific.md',import.meta.url));
  await fs.access(new URL('../feedback/examples/private-support.md',import.meta.url));
  await fs.access(new URL('../feedback/examples/unsafe-raw-log.md',import.meta.url));
});
