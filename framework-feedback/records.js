import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes as secureRandomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parseDocument} from 'yaml';

export const REQUIRED_SECTIONS=Object.freeze([
  'Outcome needed',
  'Observed behavior or practice',
  'Why this belongs in Core',
  'Expected reusable behavior',
  'Reproduction and evidence',
  'Current application workaround',
  'Core decision and rationale',
  'Implementation and release evidence',
  'Application adoption and reporter follow-up'
]);

const REQUIRED_FIELDS=Object.freeze([
  'id',
  'title',
  'status',
  'category',
  'source_application',
  'source_repository',
  'source_revision',
  'submitted_at',
  'updated_at',
  'evidence_level',
  'reported_by',
  'affected_modules',
  'runtime_issue_refs',
  'core_task_refs',
  'core_pr_refs',
  'core_release_refs',
  'core_verification_refs',
  'application_adoption_refs',
  'reporter_notification_refs',
  'supersedes',
  'duplicate_of'
]);

const ALLOWED_FIELDS=new Set(REQUIRED_FIELDS);
const STATUSES=new Set([
  'submitted',
  'triaged',
  'needs-information',
  'application-specific',
  'duplicate',
  'rejected',
  'accepted',
  'planned',
  'implementing',
  'verifying',
  'released',
  'archived'
]);
const TERMINAL_STATUSES=new Set(['application-specific','duplicate','rejected','released','archived']);
const CATEGORIES=new Set(['bug','framework-gap','improvement','demo-result']);
const EVIDENCE_LEVELS=new Set(['design-feedback','observed','validated']);
const REPORTERS=new Set(['application-developer','application-platform-ai','core-developer','core-platform-ai']);
const NOTIFICATION_STATUSES=new Set(['admitted','delivered','read']);
const TASK_REQUIRED_STATUSES=new Set(['planned','implementing','verifying']);
const STRING_FIELDS=['title','source_application','source_repository','source_revision'];
const STRING_ARRAY_FIELDS=[
  'affected_modules',
  'runtime_issue_refs',
  'core_task_refs',
  'core_pr_refs',
  'core_release_refs',
  'core_verification_refs',
  'application_adoption_refs',
  'supersedes'
];
const ID_PATTERN=/^IAIC-FB-[0-9]{8}-[A-Z0-9]{6}$/;
const AFFECTED_MODULE_PATTERN=/^[a-z0-9][a-z0-9._/-]{0,63}$/;
const UTC_TIMESTAMP_PATTERN=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const FRONTMATTER_PATTERN=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const parseMetadata=new WeakMap();
const INDEX_START='<!-- feedback-index:start -->';
const INDEX_END='<!-- feedback-index:end -->';
const TRIAGE_FACT_SECTIONS=Object.freeze(REQUIRED_SECTIONS.slice(0,6));
const TRIAGE_PROPOSAL_STATUSES=new Set(['triaged','needs-information']);
const TRIAGE_ELIGIBLE_STATUSES=new Set(['submitted','triaged','needs-information']);
const MAX_AFFECTED_MODULES=64;
const MAX_DUPLICATE_CANDIDATES=50;

const SECRET_PATTERNS=Object.freeze([
  ['pem-private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi],
  ['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
  ['cloud-access-key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['bearer-token',/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi],
  ['secret-assignment',/\b(?:client_secret|api_key|access_token|secret_key)\s*[:=]\s*["']?[^\s"'<>]{8,}/gi]
]);

function compareErrors(left,right){
  for(const key of ['filePath','path','code']){
    if(left[key]<right[key]) return -1;
    if(left[key]>right[key]) return 1;
  }
  return 0;
}

function makeError(filePath,code,errorPath,message){
  return {filePath,code,path:errorPath,message};
}

function sorted(errors){
  return errors.sort(compareErrors);
}

export class FeedbackValidationError extends Error{
  constructor(message,errors=[]){
    super(message);
    this.name='FeedbackValidationError';
    this.errors=sorted([...errors]);
  }
}

export function allocateFeedbackId({date=new Date(),randomBytes=secureRandomBytes,existingIds=new Set()}={}){
  if(!(date instanceof Date)||!Number.isFinite(date.getTime())){
    throw new TypeError('date must be a valid Date.');
  }
  if(typeof randomBytes!=='function') throw new TypeError('randomBytes must be a function.');
  const datePart=date.toISOString().slice(0,10).replaceAll('-','');
  for(let attempt=0;attempt<1024;attempt+=1){
    const bytes=randomBytes(3);
    if(!Buffer.isBuffer(bytes)&&!(bytes instanceof Uint8Array)){
      throw new TypeError('randomBytes must return bytes.');
    }
    if(bytes.length<3) throw new RangeError('randomBytes must return at least three bytes.');
    const suffix=Buffer.from(bytes.subarray(0,3)).toString('hex').toUpperCase();
    const id=`IAIC-FB-${datePart}-${suffix}`;
    if(!existingIds.has(id)) return id;
  }
  throw new Error('Unable to allocate a unique feedback ID after 1024 attempts.');
}

function escapeIndexCell(value){
  return String(value??'')
    .replace(/\r?\n|\r/g,' ')
    .replaceAll('|','\\|')
    .replaceAll(INDEX_START,'&lt;!-- feedback-index:start -->')
    .replaceAll(INDEX_END,'&lt;!-- feedback-index:end -->');
}

export function renderActiveIndex(records){
  const active=records
    .filter(record=>record?.filePath?.startsWith('feedback/inbox/')&&record.frontmatter?.status!=='archived')
    .sort((left,right)=>{
      const leftUpdated=String(left.frontmatter.updated_at);
      const rightUpdated=String(right.frontmatter.updated_at);
      if(leftUpdated!==rightUpdated) return leftUpdated>rightUpdated?-1:1;
      const leftId=String(left.frontmatter.id);
      const rightId=String(right.frontmatter.id);
      return leftId<rightId?-1:leftId>rightId?1:0;
    });
  const lines=[
    '| ID | Title | Category | Status | Source application | Updated |',
    '| --- | --- | --- | --- | --- | --- |'
  ];
  for(const record of active){
    const frontmatter=record.frontmatter;
    const id=escapeIndexCell(frontmatter.id);
    const link=record.filePath.split(path.sep).join('/');
    lines.push(`| [${id}](${link}) | ${escapeIndexCell(frontmatter.title)} | ${escapeIndexCell(frontmatter.category)} | ${escapeIndexCell(frontmatter.status)} | ${escapeIndexCell(frontmatter.source_application)} | ${escapeIndexCell(frontmatter.updated_at)} |`);
  }
  return lines.join('\n');
}

export function replaceActiveIndex(guide,table){
  if(typeof guide!=='string'||typeof table!=='string') throw new TypeError('guide and table must be strings.');
  const start=guide.indexOf(INDEX_START);
  const end=guide.indexOf(INDEX_END);
  if(start===-1||end===-1||end<start||guide.indexOf(INDEX_START,start+INDEX_START.length)!==-1||guide.indexOf(INDEX_END,end+INDEX_END.length)!==-1){
    throw new Error('FRAMEWORK_FEEDBACK.md must contain exactly one ordered feedback index marker pair.');
  }
  const contentStart=start+INDEX_START.length;
  return `${guide.slice(0,contentStart)}\n${table}\n${guide.slice(end)}`;
}

function normalizedTitleTokens(title){
  return new Set(String(title??'').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu)??[]);
}

function isArchivedRecord(record){
  return /^feedback\/archive\/\d{4}\//.test(record?.filePath??'');
}

function validatedForProposal(record){
  const status=record?.frontmatter?.status;
  if(STATUSES.has(status)&&!TRIAGE_ELIGIBLE_STATUSES.has(status)){
    throw new FeedbackValidationError(
      'Triage proposals are limited to initial triage statuses.',
      [makeError(record?.filePath??'unknown','triage-status-ineligible','frontmatter.status',`Status ${status} is not eligible for a triage proposal.`)]
    );
  }
  const result=validateFeedbackRecord(record,{
    filePath:record?.filePath??'unknown',
    archived:isArchivedRecord(record)
  });
  if(!result.valid){
    throw new FeedbackValidationError('Triage proposals require a valid feedback record.',result.errors);
  }
  return record;
}

export function createTriageProposal(record,{knownRecords=[]}={}){
  validatedForProposal(record);
  if(!Array.isArray(knownRecords)) throw new TypeError('knownRecords must be an array.');

  const affectedModules=[...record.frontmatter.affected_modules].sort((left,right)=>left.localeCompare(right));
  const affectedModuleSet=new Set(affectedModules);
  const titleTokens=normalizedTitleTokens(record.frontmatter.title);
  const missingFacts=TRIAGE_FACT_SECTIONS.filter(section=>
    record.sections.get(section)?.trim()==='Not verified'
  );
  const likelyDuplicates=[];

  for(const candidate of knownRecords){
    if(candidate===record||candidate?.frontmatter?.id===record.frontmatter.id) continue;
    const validation=validateFeedbackRecord(candidate,{
      filePath:candidate?.filePath??'unknown',
      archived:isArchivedRecord(candidate)
    });
    if(!validation.valid) continue;
    if(!candidate.frontmatter.affected_modules.some(module=>affectedModuleSet.has(module))) continue;
    const candidateTokens=normalizedTitleTokens(candidate.frontmatter.title);
    if(![...candidateTokens].some(token=>titleTokens.has(token))) continue;
    likelyDuplicates.push({feedbackId:candidate.frontmatter.id,classification:'candidate'});
  }
  likelyDuplicates.sort((left,right)=>left.feedbackId.localeCompare(right.feedbackId));
  likelyDuplicates.splice(MAX_DUPLICATE_CANDIDATES);

  const proposedStatus=missingFacts.length>0?'needs-information':'triaged';
  if(!TRIAGE_PROPOSAL_STATUSES.has(proposedStatus)) throw new Error('Invalid triage proposal status.');
  return {
    feedbackId:record.frontmatter.id,
    currentStatus:record.frontmatter.status,
    proposedStatus,
    likelyDuplicates,
    missingFacts,
    affectedModules,
    safety:{
      inputTreatedAsUntrusted:true,
      commandsExecuted:false,
      networkFetched:false,
      filesMutated:false,
      gitMutated:false,
      statusMutated:false,
      authorityExpanded:false,
      reviewRequired:true
    }
  };
}

function scanSections(body){
  const headings=[];
  const matches=[...body.matchAll(/^##[ \t]+(.+?)[ \t]*\r?$/gm)];
  const sections=new Map();
  for(let index=0;index<matches.length;index+=1){
    const heading=matches[index][1];
    const start=matches[index].index+matches[index][0].length;
    const end=matches[index+1]?.index??body.length;
    headings.push(heading);
    if(!sections.has(heading)){
      sections.set(heading,body.slice(start,end).trim());
    }
  }
  return {headings,sections};
}

export function parseFeedbackRecord(markdown,{filePath='unknown'}={}){
  if(typeof markdown!=='string'){
    throw new TypeError('Feedback Markdown must be a string.');
  }
  const boundary=markdown.match(FRONTMATTER_PATTERN);
  if(!boundary){
    throw new FeedbackValidationError(
      `Invalid feedback record: ${filePath}`,
      [makeError(filePath,'missing-frontmatter','frontmatter','The document must start with a complete YAML frontmatter block.')]
    );
  }

  const document=parseDocument(boundary[1],{uniqueKeys:true});
  if(document.errors.length>0){
    throw new FeedbackValidationError(
      `Invalid feedback frontmatter: ${filePath}`,
      document.errors.map(error=>makeError(filePath,'invalid-frontmatter','frontmatter',error.message))
    );
  }

  let frontmatter;
  try{
    frontmatter=document.toJS({maxAliasCount:100});
  }catch(error){
    throw new FeedbackValidationError(
      `Invalid feedback frontmatter: ${filePath}`,
      [makeError(filePath,'invalid-frontmatter','frontmatter',error.message)]
    );
  }
  if(frontmatter===null||typeof frontmatter!=='object'||Array.isArray(frontmatter)){
    throw new FeedbackValidationError(
      `Invalid feedback frontmatter: ${filePath}`,
      [makeError(filePath,'invalid-frontmatter','frontmatter','Frontmatter must be a YAML mapping.')]
    );
  }

  const body=markdown.slice(boundary[0].length);
  const {headings,sections}=scanSections(body);
  const record={frontmatter,body,sections,filePath};
  parseMetadata.set(record,{headings});
  return record;
}

function validateString(value,field,filePath,errors){
  if(typeof value!=='string'||value.trim().length===0){
    errors.push(makeError(filePath,'invalid-field',`frontmatter.${field}`,`${field} must be a non-empty string.`));
  }
}

function validateStringArray(value,field,filePath,errors,{nonEmpty=false}={}){
  const fieldPath=`frontmatter.${field}`;
  if(!Array.isArray(value)){
    errors.push(makeError(filePath,'invalid-array',fieldPath,`${field} must be an array.`));
    return;
  }
  if(nonEmpty&&value.length===0){
    errors.push(makeError(filePath,'empty-array',fieldPath,`${field} must contain at least one item.`));
  }
  const seen=new Set();
  value.forEach((item,index)=>{
    if(typeof item!=='string'||item.trim().length===0){
      errors.push(makeError(filePath,'invalid-reference',`${fieldPath}[${index}]`,`${field} items must be non-empty strings.`));
      return;
    }
    if(seen.has(item)){
      errors.push(makeError(filePath,'duplicate-reference',`${fieldPath}[${index}]`,`${field} contains a duplicate item.`));
    }
    seen.add(item);
  });
}

function isCanonicalUtcTimestamp(value){
  if(typeof value!=='string'||!UTC_TIMESTAMP_PATTERN.test(value)) return false;
  const timestamp=Date.parse(value);
  if(!Number.isFinite(timestamp)) return false;
  const canonical=new Date(timestamp).toISOString();
  return value===canonical||value===canonical.replace('.000Z','Z');
}

function validateNotifications(value,filePath,errors){
  const fieldPath='frontmatter.reporter_notification_refs';
  if(!Array.isArray(value)){
    errors.push(makeError(filePath,'invalid-array',fieldPath,'reporter_notification_refs must be an array.'));
    return;
  }
  const seen=new Set();
  value.forEach((item,index)=>{
    const itemPath=`${fieldPath}[${index}]`;
    if(item===null||typeof item!=='object'||Array.isArray(item)){
      errors.push(makeError(filePath,'invalid-notification-reference',itemPath,'Notification facts must be objects.'));
      return;
    }
    for(const key of Object.keys(item)){
      if(key!=='ref'&&key!=='status'){
        errors.push(makeError(filePath,'unknown-notification-field',`${itemPath}.${key}`,`Unknown notification field: ${key}.`));
      }
    }
    if(typeof item.ref!=='string'||item.ref.trim().length===0){
      errors.push(makeError(filePath,'invalid-notification-reference',`${itemPath}.ref`,'Notification ref must be a non-empty string.'));
    }
    if(!NOTIFICATION_STATUSES.has(item.status)){
      errors.push(makeError(filePath,'invalid-notification-status',`${itemPath}.status`,'Notification status must be admitted, delivered, or read.'));
    }
    const fact=`${item.ref}\u0000${item.status}`;
    if(seen.has(fact)){
      errors.push(makeError(filePath,'duplicate-notification-reference',itemPath,'Duplicate notification fact.'));
    }
    seen.add(fact);
  });
}

function serializedRecord(record){
  return `${JSON.stringify(record.frontmatter)}\n${record.body}`;
}

function validateSecrets(record,filePath,errors){
  const content=serializedRecord(record);
  for(const [name,pattern] of SECRET_PATTERNS){
    pattern.lastIndex=0;
    for(const match of content.matchAll(pattern)){
      if(/redacted|example|fixture/i.test(match[0])) continue;
      errors.push(makeError(filePath,'likely-secret','content',`Likely ${name} credential material is forbidden.`));
    }
  }
}

function validateLinks(record,filePath,errors){
  const content=serializedRecord(record);
  const links=content.match(/http:\/\/[^\s<>"')]+/gi)??[];
  for(const rawLink of links){
    let link=rawLink;
    let parsed;
    try{
      parsed=new URL(link);
    }catch{
      link=link.replace(/[\].,;:!?]+$/g,'');
      try{
        parsed=new URL(link);
      }catch{
        continue;
      }
    }
    if(parsed.hostname==='localhost'||parsed.hostname==='127.0.0.1'||parsed.hostname==='::1'||parsed.hostname==='[::1]') continue;
    errors.push(makeError(filePath,'insecure-link','content',`Insecure evidence link is forbidden: ${link}`));
  }
}

function validateSections(record,filePath,errors){
  const headings=parseMetadata.get(record)?.headings??scanSections(record.body).headings;
  let previous=-1;
  for(const required of REQUIRED_SECTIONS){
    const positions=[];
    headings.forEach((heading,index)=>{
      if(heading===required) positions.push(index);
    });
    const sectionPath=`sections.${required}`;
    if(positions.length===0){
      errors.push(makeError(filePath,'missing-section',sectionPath,`Missing required section: ${required}.`));
      continue;
    }
    if(positions.length>1){
      errors.push(makeError(filePath,'duplicate-section',sectionPath,`Required section appears more than once: ${required}.`));
    }
    if(positions[0]<previous){
      errors.push(makeError(filePath,'section-order',sectionPath,`Required section is out of order: ${required}.`));
    }
    previous=Math.max(previous,positions[0]);
  }
}

function hasItems(value){
  return Array.isArray(value)&&value.length>0;
}

export function validateFeedbackRecord(record,{filePath=record?.filePath??'unknown',archived=false}={}){
  const errors=[];
  if(record===null||typeof record!=='object'||record.frontmatter===null||typeof record.frontmatter!=='object'){
    return {valid:false,errors:[makeError(filePath,'invalid-record','record','Record must contain parsed frontmatter.')]};
  }
  const frontmatter=record.frontmatter;

  const locationParts=filePath.split('/');
  const expectedFilename=`${frontmatter.id}.md`;
  const validLocation=archived
    ? locationParts.length===4&&locationParts[0]==='feedback'&&locationParts[1]==='archive'&&/^\d{4}$/.test(locationParts[2])&&locationParts[3]===expectedFilename
    : locationParts.length===3&&locationParts[0]==='feedback'&&locationParts[1]==='inbox'&&locationParts[2]===expectedFilename;
  if(!validLocation){
    errors.push(makeError(filePath,'invalid-record-location','filePath',archived
      ? 'Archived records must be stored at feedback/archive/YYYY/<id>.md.'
      : 'Active records must be stored at feedback/inbox/<id>.md.'));
  }

  for(const field of REQUIRED_FIELDS){
    if(!Object.hasOwn(frontmatter,field)){
      errors.push(makeError(filePath,'missing-field',`frontmatter.${field}`,`Missing required field: ${field}.`));
    }
  }
  for(const field of Object.keys(frontmatter)){
    if(!ALLOWED_FIELDS.has(field)){
      errors.push(makeError(filePath,'unknown-field',`frontmatter.${field}`,`Unknown frontmatter field: ${field}.`));
    }
  }

  if(typeof frontmatter.id!=='string'||!ID_PATTERN.test(frontmatter.id)){
    errors.push(makeError(filePath,'invalid-id','frontmatter.id','id must match IAIC-FB-YYYYMMDD-XXXXXX.'));
  }else if(path.basename(filePath)!==`${frontmatter.id}.md`){
    errors.push(makeError(filePath,'filename-mismatch','frontmatter.id','Filename must equal <id>.md.'));
  }
  for(const field of STRING_FIELDS) validateString(frontmatter[field],field,filePath,errors);
  if(typeof frontmatter.title==='string'&&(frontmatter.title.length<8||frontmatter.title.length>120)){
    errors.push(makeError(filePath,'invalid-title','frontmatter.title','title must contain 8 to 120 characters.'));
  }
  if(!STATUSES.has(frontmatter.status)) errors.push(makeError(filePath,'invalid-status','frontmatter.status','Unknown feedback status.'));
  if(!CATEGORIES.has(frontmatter.category)) errors.push(makeError(filePath,'invalid-category','frontmatter.category','Unknown feedback category.'));
  if(!EVIDENCE_LEVELS.has(frontmatter.evidence_level)) errors.push(makeError(filePath,'invalid-evidence-level','frontmatter.evidence_level','Unknown evidence level.'));
  if(!REPORTERS.has(frontmatter.reported_by)) errors.push(makeError(filePath,'invalid-reported-by','frontmatter.reported_by','Unknown reporter type.'));

  for(const field of ['submitted_at','updated_at']){
    if(!isCanonicalUtcTimestamp(frontmatter[field])){
      errors.push(makeError(filePath,'invalid-timestamp',`frontmatter.${field}`,`${field} must be a canonical UTC ISO timestamp.`));
    }
  }
  for(const field of STRING_ARRAY_FIELDS){
    validateStringArray(frontmatter[field],field,filePath,errors,{nonEmpty:field==='affected_modules'});
  }
  if(Array.isArray(frontmatter.affected_modules)){
    if(frontmatter.affected_modules.length>MAX_AFFECTED_MODULES){
      errors.push(makeError(filePath,'too-many-affected-modules','frontmatter.affected_modules',`affected_modules cannot contain more than ${MAX_AFFECTED_MODULES} items.`));
    }
    frontmatter.affected_modules.forEach((module,index)=>{
      if(typeof module==='string'&&!AFFECTED_MODULE_PATTERN.test(module)){
        errors.push(makeError(filePath,'invalid-affected-module',`frontmatter.affected_modules[${index}]`,'Affected modules must be bounded lowercase repository module identifiers.'));
      }
    });
  }
  validateNotifications(frontmatter.reporter_notification_refs,filePath,errors);

  if(frontmatter.duplicate_of!==null&&(typeof frontmatter.duplicate_of!=='string'||!ID_PATTERN.test(frontmatter.duplicate_of))){
    errors.push(makeError(filePath,'invalid-duplicate-reference','frontmatter.duplicate_of','duplicate_of must be null or a feedback ID.'));
  }
  if(frontmatter.status==='duplicate'&&!frontmatter.duplicate_of){
    errors.push(makeError(filePath,'missing-duplicate-reference','frontmatter.duplicate_of','Duplicate records must identify the authoritative feedback record.'));
  }
  if(!archived&&frontmatter.status==='archived'){
    errors.push(makeError(filePath,'active-archived-status','frontmatter.status','An active record cannot use archived status.'));
  }
  if(archived&&!TERMINAL_STATUSES.has(frontmatter.status)){
    errors.push(makeError(filePath,'non-terminal-archive-status','frontmatter.status','An archived record must use a terminal status.'));
  }
  if(TASK_REQUIRED_STATUSES.has(frontmatter.status)&&!hasItems(frontmatter.core_task_refs)){
    errors.push(makeError(filePath,'missing-core-task','frontmatter.core_task_refs',`${frontmatter.status} records require a Core Task reference.`));
  }
  if(frontmatter.status==='released'){
    for(const field of ['core_release_refs','core_pr_refs','core_verification_refs']){
      if(!hasItems(frontmatter[field])){
        errors.push(makeError(filePath,`missing-${field.replaceAll('_','-')}`,`frontmatter.${field}`,`Released records require ${field}.`));
      }
    }
    const releaseEvidence=record.sections?.get('Implementation and release evidence')??'';
    if(!/(?:exact\s+)?implementation\s+revision\s*:\s*(?!Not verified\b)\S+/i.test(releaseEvidence)){
      errors.push(makeError(filePath,'missing-implementation-revision','sections.Implementation and release evidence','Released records require an exact implementation revision.'));
    }
    const followUp=record.sections?.get('Application adoption and reporter follow-up')??'';
    const explicitNonAdoption=/\b(?:non-adoption|not adopted|will not adopt)\b/i.test(followUp)&&!/^Not verified\s*$/i.test(followUp.trim());
    if(!hasItems(frontmatter.application_adoption_refs)&&!explicitNonAdoption){
      errors.push(makeError(filePath,'missing-application-adoption','frontmatter.application_adoption_refs','Released records require application adoption or an explicit non-adoption decision.'));
    }
  }

  validateSections(record,filePath,errors);
  validateSecrets(record,filePath,errors);
  validateLinks(record,filePath,errors);
  const ordered=sorted(errors);
  return {valid:ordered.length===0,errors:ordered};
}

async function listMarkdownFiles(directory){
  let entries;
  try{
    entries=await fs.readdir(directory,{withFileTypes:true});
  }catch(error){
    if(error.code==='ENOENT') return [];
    throw error;
  }
  const files=[];
  for(const entry of entries.sort((left,right)=>left.name.localeCompare(right.name))){
    const location=path.join(directory,entry.name);
    if(entry.isDirectory()) files.push(...await listMarkdownFiles(location));
    if(entry.isFile()&&entry.name.endsWith('.md')) files.push(location);
  }
  return files;
}

function rootPath(root){
  return root instanceof URL?fileURLToPath(root):path.resolve(root);
}

export async function loadFeedbackRepository(root){
  const repositoryRoot=rootPath(root);
  const inboxRoot=path.join(repositoryRoot,'feedback','inbox');
  const archiveRoot=path.join(repositoryRoot,'feedback','archive');
  const files=[...await listMarkdownFiles(inboxRoot),...await listMarkdownFiles(archiveRoot)].sort();
  const records=[];
  const errors=[];

  for(const absolutePath of files){
    const filePath=path.relative(repositoryRoot,absolutePath).split(path.sep).join('/');
    const archived=absolutePath===archiveRoot||absolutePath.startsWith(`${archiveRoot}${path.sep}`);
    try{
      const markdown=await fs.readFile(absolutePath,'utf8');
      const record=parseFeedbackRecord(markdown,{filePath});
      records.push(record);
      errors.push(...validateFeedbackRecord(record,{filePath,archived}).errors);
    }catch(error){
      if(error instanceof FeedbackValidationError){
        errors.push(...error.errors);
      }else{
        throw error;
      }
    }
  }

  const byId=new Map();
  for(const record of records){
    const id=record.frontmatter.id;
    if(typeof id!=='string') continue;
    const matches=byId.get(id)??[];
    matches.push(record);
    byId.set(id,matches);
  }
  for(const [id,matches] of byId){
    if(matches.length<2) continue;
    for(const record of matches){
      errors.push(makeError(record.filePath,'duplicate-id','frontmatter.id',`Feedback ID appears in multiple records: ${id}.`));
    }
  }

  return {records,errors:sorted(errors)};
}
