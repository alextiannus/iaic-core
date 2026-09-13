import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {evidenceDigest,jsonValue} from './runner.js';
const name = id => {if (typeof id !== 'string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid evaluation artifact ID');return id+'.json';};
export class FileEvaluationStore {
  constructor({directory}) {this.directory=path.resolve(directory);}
  async put(run) {
    const value=jsonValue(run),file=path.join(this.directory,name(value.id));
    await fs.mkdir(this.directory,{recursive:true});
    const temporary=path.join(this.directory,'.'+randomUUID()+'.tmp');
    try {
      await fs.writeFile(temporary,JSON.stringify({digest:evidenceDigest(value),run:value},null,2)+'\n',{flag:'wx',mode:0o600});
      await fs.link(temporary,file); // Atomic visibility without replacing prior evidence.
    } finally {await fs.rm(temporary,{force:true});}
    return {id:value.id,digest:evidenceDigest(value),path:file};
  }
  async get(id) {
    const stored=JSON.parse(await fs.readFile(path.join(this.directory,name(id)),'utf8'));
    if (stored.run?.id!==id||evidenceDigest(stored.run)!==stored.digest) throw new Error('Evaluation artifact content does not match its digest');
    return stored.run;
  }
}
