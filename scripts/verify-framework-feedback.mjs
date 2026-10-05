#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  loadFeedbackRepository,
  renderActiveIndex,
  replaceActiveIndex
} from '../framework-feedback/records.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

function writeJson(stream,value){
  stream.write(`${JSON.stringify(value)}\n`);
}

async function main(){
  const repository=await loadFeedbackRepository(root);
  const errors=[...repository.errors];
  const guidePath=path.join(root,'FRAMEWORK_FEEDBACK.md');
  const guide=await fs.readFile(guidePath,'utf8');
  const activeRecords=repository.records.filter(record=>record.filePath.startsWith('feedback/inbox/'));
  if(replaceActiveIndex(guide,renderActiveIndex(repository.records))!==guide){
    errors.push({filePath:'FRAMEWORK_FEEDBACK.md',code:'index-drift',path:'feedback-index',message:'Active feedback index does not match feedback/inbox/. Run npm run feedback:index.'});
  }
  if(errors.length>0){
    for(const error of errors) writeJson(process.stderr,error);
    process.exitCode=1;
    return;
  }
  writeJson(process.stdout,{frameworkFeedback:'passed',activeRecords:activeRecords.length});
}

main().catch(error=>{
  writeJson(process.stderr,{code:'feedback-verification-failed',message:error.message});
  process.exitCode=1;
});
