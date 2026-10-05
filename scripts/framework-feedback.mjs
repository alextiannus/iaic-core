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

const scriptPath=fileURLToPath(import.meta.url);
const defaultRoot=path.resolve(path.dirname(scriptPath),'..');
const usage=`Usage:
  node scripts/framework-feedback.mjs next-id
  node scripts/framework-feedback.mjs validate
  node scripts/framework-feedback.mjs index --check
  node scripts/framework-feedback.mjs index --write
  node scripts/framework-feedback.mjs triage-proposal feedback/inbox/<id>.md`;

function writeJson(stream,value){
  stream.write(`${JSON.stringify(value)}\n`);
}

function usageError(stderr,message){
  stderr.write(`${message}\n${usage}\n`);
  return 2;
}

function validationFailure(stderr,errors){
  for(const error of errors) writeJson(stderr,error);
  return 1;
}

async function repositoryOrFail(root,stderr){
  const repository=await loadFeedbackRepository(root);
  if(repository.errors.length>0){
    validationFailure(stderr,repository.errors);
    return null;
  }
  return repository;
}

export async function runFeedbackCommand({args=[],root=defaultRoot,stdout=process.stdout,stderr=process.stderr}={}){
  try{
    const [command,...commandArgs]=args;
    const guidePath=path.join(root,'FRAMEWORK_FEEDBACK.md');

    if(command==='next-id'){
      if(commandArgs.length!==0) return usageError(stderr,'next-id does not accept arguments or flags.');
      const repository=await repositoryOrFail(root,stderr);
      if(!repository) return 1;
      const existingIds=new Set(repository.records.map(record=>record.frontmatter.id).filter(id=>typeof id==='string'));
      const id=allocateFeedbackId({existingIds});
      writeJson(stdout,{id,path:`feedback/inbox/${id}.md`});
      return 0;
    }

    if(command==='validate'){
      if(commandArgs.length!==0) return usageError(stderr,'validate does not accept arguments or flags.');
      const repository=await repositoryOrFail(root,stderr);
      if(!repository) return 1;
      writeJson(stdout,{frameworkFeedback:'valid',records:repository.records.length});
      return 0;
    }

    if(command==='index'){
      if(commandArgs.length!==1||(commandArgs[0]!=='--check'&&commandArgs[0]!=='--write')){
        return usageError(stderr,'index requires exactly one of --check or --write.');
      }
      const repository=await repositoryOrFail(root,stderr);
      if(!repository) return 1;
      const guide=await fs.readFile(guidePath,'utf8');
      const table=renderActiveIndex(repository.records);
      const expected=replaceActiveIndex(guide,table);
      if(commandArgs[0]==='--check'){
        if(expected!==guide){
          return validationFailure(stderr,[{filePath:'FRAMEWORK_FEEDBACK.md',code:'index-drift',path:'feedback-index',message:'Active feedback index does not match feedback/inbox/. Run npm run feedback:index.'}]);
        }
        writeJson(stdout,{frameworkFeedback:'index-valid',activeRecords:repository.records.filter(record=>record.filePath.startsWith('feedback/inbox/')).length});
        return 0;
      }
      if(expected!==guide) await fs.writeFile(guidePath,expected,'utf8');
      writeJson(stdout,{frameworkFeedback:'index-written',activeRecords:repository.records.filter(record=>record.filePath.startsWith('feedback/inbox/')).length,changed:expected!==guide});
      return 0;
    }

    if(command==='triage-proposal'){
      if(commandArgs.length!==1||commandArgs[0].startsWith('-')) return usageError(stderr,'triage-proposal requires exactly one record path.');
      return validationFailure(stderr,[{filePath:commandArgs[0],code:'triage-proposal-unavailable',path:'command',message:'Triage proposal generation is not available in this implementation task.'}]);
    }

    return usageError(stderr,command?`Unknown command: ${command}`:'A command is required.');
  }catch(error){
    writeJson(stderr,{code:'feedback-command-failed',message:error.message});
    return 1;
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===scriptPath){
  process.exitCode=await runFeedbackCommand({args:process.argv.slice(2)});
}
