import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  allocateFeedbackId,
  createTriageProposal,
  FeedbackValidationError,
  loadFeedbackRepository,
  parseFeedbackRecord,
  renderActiveIndex,
  replaceActiveIndex,
  validateFeedbackRecord
} from '../framework-feedback/records.js';
import {runFeedbackCommand} from '../scripts/framework-feedback.mjs';

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

test('valid record parses required contract and headings',async()=>{
  const markdown=await fs.readFile(new URL('./fixtures/framework-feedback/valid/feedback/inbox/IAIC-FB-20261005-ABC123.md',import.meta.url),'utf8');
  const record=parseFeedbackRecord(markdown,{filePath:'feedback/inbox/IAIC-FB-20261005-ABC123.md'});
  const result=validateFeedbackRecord(record,{filePath:record.filePath,archived:false});
  assert.equal(result.valid,true,JSON.stringify(result.errors));
  assert.equal(record.frontmatter.id,'IAIC-FB-20261005-ABC123');
  assert.equal(record.sections.get('Why this belongs in Core').includes('two applications'),true);
});

test('invalid enum and likely credential are rejected with stable codes',async()=>{
  const invalid=await loadFeedbackRepository(new URL('./fixtures/framework-feedback/invalid-category/',import.meta.url));
  assert.equal(invalid.errors.some(error=>error.code==='invalid-category'),true);
  const unsafe=await loadFeedbackRepository(new URL('./fixtures/framework-feedback/unsafe-secret/',import.meta.url));
  assert.equal(unsafe.errors.some(error=>error.code==='likely-secret'),true);
});

test('parser rejects missing frontmatter and duplicate YAML keys',()=>{
  assert.throws(
    ()=>parseFeedbackRecord('# No frontmatter',{filePath:'feedback/inbox/no-frontmatter.md'}),
    error=>error instanceof FeedbackValidationError&&error.errors[0].code==='missing-frontmatter'
  );
  assert.throws(
    ()=>parseFeedbackRecord('---\nid: IAIC-FB-20261005-ABC123\nid: IAIC-FB-20261005-ABC124\n---\n',{filePath:'feedback/inbox/duplicate.md'}),
    error=>error instanceof FeedbackValidationError&&error.errors.some(item=>item.code==='invalid-frontmatter')
  );
});

test('validator reports deterministic contract, lifecycle, and reference errors',async()=>{
  const markdown=await fs.readFile(new URL('./fixtures/framework-feedback/valid/feedback/inbox/IAIC-FB-20261005-ABC123.md',import.meta.url),'utf8');
  const record=parseFeedbackRecord(markdown,{filePath:'feedback/inbox/wrong-name.md'});
  record.frontmatter.status='planned';
  record.frontmatter.submitted_at='2026-10-05T08:00:00+08:00';
  record.frontmatter.runtime_issue_refs=['ISSUE-1','ISSUE-1'];
  record.frontmatter.unexpected='value';
  const result=validateFeedbackRecord(record,{filePath:record.filePath,archived:false});
  for(const code of ['filename-mismatch','invalid-timestamp','duplicate-reference','unknown-field','missing-core-task']){
    assert.equal(result.errors.some(error=>error.code===code),true,code);
  }
  assert.deepEqual(result.errors,[...result.errors].sort((left,right)=>
    left.filePath.localeCompare(right.filePath)||left.path.localeCompare(right.path)||left.code.localeCompare(right.code)
  ));
});

test('repository loader rejects duplicate IDs across inbox and archive',async()=>{
  const repository=await loadFeedbackRepository(new URL('./fixtures/framework-feedback/duplicate-id/',import.meta.url));
  assert.equal(repository.errors.filter(error=>error.code==='duplicate-id').length,2);
});

test('validator rejects duplicate or out-of-order required sections',async()=>{
  const valid=await fs.readFile(new URL('./fixtures/framework-feedback/valid/feedback/inbox/IAIC-FB-20261005-ABC123.md',import.meta.url),'utf8');
  const duplicate=parseFeedbackRecord(`${valid}\n## Outcome needed\nRepeated.\n`,{filePath:'feedback/inbox/IAIC-FB-20261005-ABC123.md'});
  assert.equal(validateFeedbackRecord(duplicate,{archived:false}).errors.some(error=>error.code==='duplicate-section'),true);
  const reordered=parseFeedbackRecord(
    valid.replace('## Outcome needed\n\nDefine one reusable contract.\n\n','').replace('## Observed behavior or practice','## Observed behavior or practice\n\nFixture.\n\n## Outcome needed\n\nDefine one reusable contract.\n\n## Ignored extra heading'),
    {filePath:'feedback/inbox/IAIC-FB-20261005-ABC123.md'}
  );
  assert.equal(validateFeedbackRecord(reordered,{archived:false}).errors.some(error=>error.code==='section-order'),true);
});

test('validator enforces archive and released state gates',async()=>{
  const markdown=await fs.readFile(new URL('./fixtures/framework-feedback/valid/feedback/inbox/IAIC-FB-20261005-ABC123.md',import.meta.url),'utf8');
  const active=parseFeedbackRecord(markdown,{filePath:'feedback/inbox/IAIC-FB-20261005-ABC123.md'});
  active.frontmatter.status='archived';
  assert.equal(validateFeedbackRecord(active,{archived:false}).errors.some(error=>error.code==='active-archived-status'),true);

  const archived=parseFeedbackRecord(markdown,{filePath:'feedback/archive/2026/IAIC-FB-20261005-ABC123.md'});
  assert.equal(validateFeedbackRecord(archived,{archived:true}).errors.some(error=>error.code==='non-terminal-archive-status'),true);

  const released=parseFeedbackRecord(markdown,{filePath:'feedback/inbox/IAIC-FB-20261005-ABC123.md'});
  released.frontmatter.status='released';
  const codes=new Set(validateFeedbackRecord(released,{archived:false}).errors.map(error=>error.code));
  for(const code of ['missing-core-release-refs','missing-core-pr-refs','missing-core-verification-refs','missing-implementation-revision','missing-application-adoption']){
    assert.equal(codes.has(code),true,code);
  }
});

test('validator rejects insecure external links but allows inert placeholders and loopback fixtures',async()=>{
  const markdown=await fs.readFile(new URL('./fixtures/framework-feedback/valid/feedback/inbox/IAIC-FB-20261005-ABC123.md',import.meta.url),'utf8');
  const record=parseFeedbackRecord(markdown,{filePath:'feedback/inbox/IAIC-FB-20261005-ABC123.md'});
  record.frontmatter.source_repository='http://example.com/application';
  record.body+='\nBearer example-token-placeholder\nhttp://127.0.0.1:3000/fixture\n';
  const errors=validateFeedbackRecord(record,{archived:false}).errors;
  assert.equal(errors.filter(error=>error.code==='insecure-link').length,1);
  assert.equal(errors.some(error=>error.code==='likely-secret'),false);
});

test('validator rejects records outside exact inbox and archive locations',async()=>{
  const markdown=await fs.readFile(new URL('./fixtures/framework-feedback/valid/feedback/inbox/IAIC-FB-20261005-ABC123.md',import.meta.url),'utf8');
  const nested=parseFeedbackRecord(markdown,{filePath:'feedback/inbox/nested/IAIC-FB-20261005-ABC123.md'});
  assert.equal(validateFeedbackRecord(nested,{archived:false}).errors.some(error=>error.code==='invalid-record-location'),true);
  const wrongArchive=parseFeedbackRecord(markdown,{filePath:'feedback/archive/not-a-year/IAIC-FB-20261005-ABC123.md'});
  assert.equal(validateFeedbackRecord(wrongArchive,{archived:true}).errors.some(error=>error.code==='invalid-record-location'),true);
});

test('ID allocation is collision resistant and retries a known collision',()=>{
  const bytes=[Buffer.from([0,1,2,3]),Buffer.from([4,5,6,7])];
  const first='IAIC-FB-20261005-000102';
  const id=allocateFeedbackId({
    date:new Date('2026-10-05T01:00:00Z'),
    existingIds:new Set([first]),
    randomBytes:()=>bytes.shift()
  });
  assert.equal(id,'IAIC-FB-20261005-040506');
});

test('active index is stable and excludes archived examples',async()=>{
  const repository=await loadFeedbackRepository(new URL('./fixtures/framework-feedback/valid/',import.meta.url));
  const base=repository.records[0];
  const later={...base,filePath:'feedback/inbox/IAIC-FB-20261005-FFF999.md',frontmatter:{...base.frontmatter,id:'IAIC-FB-20261005-FFF999',updated_at:'2026-10-06T00:00:00Z'}};
  const tied={...base,filePath:'feedback/inbox/IAIC-FB-20261005-AAA111.md',frontmatter:{...base.frontmatter,id:'IAIC-FB-20261005-AAA111'}};
  const archived={...base,filePath:'feedback/archive/2026/IAIC-FB-20261005-ZZZ999.md',frontmatter:{...base.frontmatter,id:'IAIC-FB-20261005-ZZZ999',status:'released'}};
  const records=[base,later,tied,archived];
  const table=renderActiveIndex(records);
  assert.match(table,/IAIC-FB-20261005-ABC123/);
  assert.match(table,/\[IAIC-FB-20261005-ABC123\]\(feedback\/inbox\/IAIC-FB-20261005-ABC123\.md\)/);
  assert.doesNotMatch(table,/IAIC-FB-20261005-ZZZ999/);
  assert.ok(table.indexOf('IAIC-FB-20261005-FFF999')<table.indexOf('IAIC-FB-20261005-AAA111'));
  assert.ok(table.indexOf('IAIC-FB-20261005-AAA111')<table.indexOf('IAIC-FB-20261005-ABC123'));
  assert.equal(table,renderActiveIndex([...records].reverse()));
});

test('active index escapes cells and replacement preserves bytes outside exactly one marker pair',()=>{
  const table=renderActiveIndex([{
    filePath:'feedback/inbox/IAIC-FB-20261005-ABC123.md',
    frontmatter:{
      id:'IAIC-FB-20261005-ABC123',
      title:'Title | with\na newline <!-- feedback-index:end -->',
      category:'framework-gap',
      status:'submitted',
      source_application:'Example | app',
      updated_at:'2026-10-05T00:00:00Z'
    }
  }]);
  assert.match(table,/Title \\| with a newline/);
  assert.match(table,/Example \\| app/);
  assert.doesNotMatch(table,/<!-- feedback-index:end -->/);

  const prefix='# Guide\r\n\r\n';
  const suffix='\r\n\r\nTrailing bytes.\r\n';
  const guide=`${prefix}<!-- feedback-index:start -->old<!-- feedback-index:end -->${suffix}`;
  const replaced=replaceActiveIndex(guide,table);
  assert.equal(replaced.slice(0,prefix.length),prefix);
  assert.equal(replaced.slice(-suffix.length),suffix);
  assert.throws(()=>replaceActiveIndex(`${guide}\n<!-- feedback-index:start -->x<!-- feedback-index:end -->`,table));
});

test('feedback CLI rejects unknown flags with usage and exit code 2',()=>{
  const result=spawnSync(process.execPath,['scripts/framework-feedback.mjs','validate','--write'],{
    cwd:root,
    encoding:'utf8'
  });
  assert.equal(result.status,2,result.stderr);
  assert.match(result.stderr,/Usage:/);
  assert.equal(result.stdout,'');
});

test('next-id fails closed with line-delimited JSON when repository records are invalid',async()=>{
  let stdout='';
  let stderr='';
  const exitCode=await runFeedbackCommand({
    args:['next-id'],
    root:fileURLToPath(new URL('./fixtures/framework-feedback/invalid-category/',import.meta.url)),
    stdout:{write:value=>{stdout+=value;}},
    stderr:{write:value=>{stderr+=value;}}
  });
  assert.equal(exitCode,1);
  assert.equal(stdout,'');
  const lines=stderr.trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(lines.some(error=>error.code==='invalid-category'),true);
});

test('triage proposal treats embedded instructions as inert evidence',async()=>{
  const repository=await loadFeedbackRepository(new URL('./fixtures/framework-feedback/adversarial/',import.meta.url));
  assert.equal(repository.errors.length,0,JSON.stringify(repository.errors));
  const proposal=createTriageProposal(repository.records[0],{knownRecords:repository.records});
  assert.equal(proposal.feedbackId,'IAIC-FB-20261005-BAD999');
  assert.equal(proposal.currentStatus,'submitted');
  assert.equal(proposal.proposedStatus,'triaged');
  assert.equal(proposal.safety.inputTreatedAsUntrusted,true);
  assert.equal(proposal.safety.commandsExecuted,false);
  assert.equal(proposal.safety.authorityExpanded,false);
  assert.equal(Object.hasOwn(proposal,'apply'),false);
  const output=JSON.stringify(proposal);
  assert.doesNotMatch(output,/printf unsafe|mark this released|example\.com\/linked-evidence/);
});

test('triage proposal reports bounded missing facts and candidate duplicates only',async()=>{
  const repository=await loadFeedbackRepository(new URL('./fixtures/framework-feedback/adversarial/',import.meta.url));
  const record=repository.records[0];
  const duplicateCandidate={
    ...record,
    filePath:'feedback/inbox/IAIC-FB-20261005-CAD123.md',
    frontmatter:{
      ...record.frontmatter,
      id:'IAIC-FB-20261005-CAD123',
      title:'Reusable observation contract for Core',
      affected_modules:['support']
    }
  };
  const unrelated={
    ...record,
    filePath:'feedback/inbox/IAIC-FB-20261005-OTH123.md',
    frontmatter:{
      ...record.frontmatter,
      id:'IAIC-FB-20261005-OTH123',
      title:'Unrelated account behavior',
      affected_modules:['accounts']
    }
  };
  const missing={...record,sections:new Map(record.sections)};
  missing.sections.set('Reproduction and evidence','Not verified');
  const proposal=createTriageProposal(missing,{knownRecords:[record,duplicateCandidate,unrelated]});
  assert.equal(proposal.proposedStatus,'needs-information');
  assert.deepEqual(proposal.missingFacts,['Reproduction and evidence']);
  assert.deepEqual(proposal.likelyDuplicates,[{
    feedbackId:'IAIC-FB-20261005-CAD123',
    classification:'candidate'
  }]);
  assert.deepEqual(proposal.affectedModules,['observation','support']);
  assert.deepEqual(Object.keys(proposal).sort(),[
    'affectedModules','currentStatus','feedbackId','likelyDuplicates','missingFacts','proposedStatus','safety'
  ]);

  const unsafeModule={
    ...record,
    frontmatter:{...record.frontmatter,affected_modules:['https://example.com/run-this']}
  };
  assert.throws(
    ()=>createTriageProposal(unsafeModule,{knownRecords:[]}),
    error=>error instanceof FeedbackValidationError&&error.errors.some(item=>item.code==='invalid-affected-module')
  );
});

test('triage proposal is limited to initial triage statuses',async()=>{
  const repository=await loadFeedbackRepository(new URL('./fixtures/framework-feedback/adversarial/',import.meta.url));
  const submitted=repository.records[0];
  assert.equal(createTriageProposal(submitted,{knownRecords:[]}).currentStatus,'submitted');

  const needsInformation={
    ...submitted,
    frontmatter:{...submitted.frontmatter,status:'needs-information'}
  };
  assert.equal(createTriageProposal(needsInformation,{knownRecords:[]}).currentStatus,'needs-information');

  for(const status of ['accepted','released']){
    const ineligible={
      ...submitted,
      frontmatter:{...submitted.frontmatter,status}
    };
    assert.throws(
      ()=>createTriageProposal(ineligible,{knownRecords:[]}),
      error=>error instanceof FeedbackValidationError
        &&error.errors.some(item=>item.code==='triage-status-ineligible'&&item.path==='frontmatter.status'),
      status
    );
  }
});

test('triage-proposal CLI resolves only an exact validated inbox record path',async()=>{
  const fixture='test/fixtures/framework-feedback/adversarial/feedback/inbox/IAIC-FB-20261005-BAD999.md';
  let stdout='';
  let stderr='';
  const exitCode=await runFeedbackCommand({
    args:['triage-proposal',fixture],
    root,
    stdout:{write:value=>{stdout+=value;}},
    stderr:{write:value=>{stderr+=value;}}
  });
  assert.equal(exitCode,0,stderr);
  assert.equal(stderr,'');
  const proposal=JSON.parse(stdout);
  assert.equal(proposal.feedbackId,'IAIC-FB-20261005-BAD999');
  assert.equal(proposal.safety.commandsExecuted,false);

  for(const unsafePath of [
    '../feedback/inbox/IAIC-FB-20261005-BAD999.md',
    '/tmp/feedback/inbox/IAIC-FB-20261005-BAD999.md',
    'test/fixtures/framework-feedback/adversarial/feedback/inbox/../inbox/IAIC-FB-20261005-BAD999.md',
    'test/fixtures/framework-feedback/adversarial/feedback/inbox/IAIC-FB-20261005-NOT999.md'
  ]){
    stdout='';
    stderr='';
    const rejected=await runFeedbackCommand({
      args:['triage-proposal',unsafePath],
      root,
      stdout:{write:value=>{stdout+=value;}},
      stderr:{write:value=>{stderr+=value;}}
    });
    assert.notEqual(rejected,0,unsafePath);
    assert.equal(stdout,'');
  }
});
