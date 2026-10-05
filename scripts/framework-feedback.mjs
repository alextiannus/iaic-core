#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  allocateFeedbackId,
  loadFeedbackRepository,
  renderActiveIndex,
  replaceActiveIndex
} from '../framework-feedback/records.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const guidePath=path.join(root,'FRAMEWORK_FEEDBACK.md');
const usage=`Usage:
  node scripts/framework-feedback.mjs next-id
  node scripts/framework-feedback.mjs validate
  node scripts/framework-feedback.mjs index --check
  node scripts/framework-feedback.mjs index --write
  node scripts/framework-feedback.mjs triage-proposal feedback/inbox/<id>.md`;

function writeJson(stream,value){
  stream.write(`${JSON.stringify(value)}\n`);
}

function usageError(message){
  process.stderr.write(`${message}\n${usage}\n`);
  process.exitCode=2;
}

function validationFailure(errors){
  for(const error of errors) writeJson(process.stderr,error);
  process.exitCode=1;
}

async function repositoryOrFail(){
  const repository=await loadFeedbackRepository(root);
  if(repository.errors.length>0){
    validationFailure(repository.errors);
    return null;
  }
  return repository;
}

async function main(){
  const [command,...args]=process.argv.slice(2);

  if(command==='next-id'){
    if(args.length!==0) return usageError('next-id does not accept arguments or flags.');
    const repository=await loadFeedbackRepository(root);
    const existingIds=new Set(repository.records.map(record=>record.frontmatter.id).filter(id=>typeof id==='string'));
    const id=allocateFeedbackId({existingIds});
    writeJson(process.stdout,{id,path:`feedback/inbox/${id}.md`});
    return;
  }

  if(command==='validate'){
    if(args.length!==0) return usageError('validate does not accept arguments or flags.');
    const repository=await repositoryOrFail();
    if(repository) writeJson(process.stdout,{frameworkFeedback:'valid',records:repository.records.length});
    return;
  }

  if(command==='index'){
    if(args.length!==1||(args[0]!=='--check'&&args[0]!=='--write')){
      return usageError('index requires exactly one of --check or --write.');
    }
    const repository=await repositoryOrFail();
    if(!repository) return;
    const guide=await fs.readFile(guidePath,'utf8');
    const table=renderActiveIndex(repository.records);
    const expected=replaceActiveIndex(guide,table);
    if(args[0]==='--check'){
      if(expected!==guide){
        validationFailure([{filePath:'FRAMEWORK_FEEDBACK.md',code:'index-drift',path:'feedback-index',message:'Active feedback index does not match feedback/inbox/. Run npm run feedback:index.'}]);
        return;
      }
      writeJson(process.stdout,{frameworkFeedback:'index-valid',activeRecords:repository.records.filter(record=>record.filePath.startsWith('feedback/inbox/')).length});
      return;
    }
    if(expected!==guide) await fs.writeFile(guidePath,expected,'utf8');
    writeJson(process.stdout,{frameworkFeedback:'index-written',activeRecords:repository.records.filter(record=>record.filePath.startsWith('feedback/inbox/')).length,changed:expected!==guide});
    return;
  }

  if(command==='triage-proposal'){
    if(args.length!==1||args[0].startsWith('-')) return usageError('triage-proposal requires exactly one record path.');
    validationFailure([{filePath:args[0],code:'triage-proposal-unavailable',path:'command',message:'Triage proposal generation is not available in this implementation task.'}]);
    return;
  }

  usageError(command?`Unknown command: ${command}`:'A command is required.');
}

main().catch(error=>{
  writeJson(process.stderr,{code:'feedback-command-failed',message:error.message});
  process.exitCode=1;
});
