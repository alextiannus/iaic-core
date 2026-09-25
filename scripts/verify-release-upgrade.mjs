import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

// Pinned real predecessor; advance this verified baseline for each candidate.
const predecessor={tag:'v0.1.0-candidate.112',asset:'immedi-iaic-core-0.1.0-candidate.112.tgz',sha256:'f23d76b7409852a7f5758fe508f1be20f4f3d8d13abb310db418dcad093ec50a'};
const root=fileURLToPath(new URL('../',import.meta.url)),npm=process.env.npm_execpath;
if(!npm)throw Error('Use npm run verify:release-upgrade');
const current=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
// Also exercise unpublished support integration builds; this does not publish a release.
assert.match(current.version,/^\d+\.\d+\.\d+-candidate\.\d+(?:-support\.[1-9]\d*)?$/);
const run=(args,cwd,env=process.env)=>{
 const result=spawnSync(process.execPath,args,{cwd,env,encoding:'utf8',timeout:180000});
 if(result.status!==0)throw Error(result.stderr||result.stdout||String(result.error));return result.stdout;
};
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-upgrade-'));
try {
 const response=await fetch(`https://github.com/alextiannus/iaic-core/releases/download/${predecessor.tag}/${predecessor.asset}`,{signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw Error('Cannot fetch pinned predecessor: HTTP '+response.status);
 const bytes=Buffer.from(await response.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),predecessor.sha256);
 const previous=path.join(temporary,predecessor.asset);await fs.writeFile(previous,bytes);
 const packed=JSON.parse(run([npm,'pack','--json','--pack-destination',temporary],root))[0];
 assert.equal(packed.version,current.version);assert.equal(packed.filename,`immedi-iaic-core-${current.version}.tgz`);
 const consumer=path.join(temporary,'consumer');await fs.mkdir(consumer);await fs.writeFile(path.join(consumer,'package.json'),JSON.stringify({private:true,type:'module'}));
 // Both installations share one ordinary npm cache, lockfile and node_modules.
 const env={...process.env,npm_config_cache:path.join(temporary,'shared-cache')};
 const install=archive=>run([npm,'install','--ignore-scripts','--no-audit','--no-fund',archive],consumer,env);
 const inspect=`import assert from 'node:assert/strict';import fs from 'node:fs';import * as core from '@immedi/iaic-core';const pkg=JSON.parse(fs.readFileSync('node_modules/@immedi/iaic-core/package.json','utf8'));assert.equal(typeof core.AssistantChannel,'function');console.log(JSON.stringify({version:pkg.version,release:core.CORE_RELEASE??null}));`;
 await fs.writeFile(path.join(consumer,'inspect.mjs'),inspect);
 install(previous);const before=JSON.parse(run(['inspect.mjs'],consumer,env));assert.equal('v'+before.version,predecessor.tag);assert.deepEqual(before.release,{name:current.name,version:before.version,tag:predecessor.tag});assert.notEqual(before.version,current.version);
 install(path.join(temporary,packed.filename));const after=JSON.parse(run(['inspect.mjs'],consumer,env));
 assert.equal(after.version,current.version);assert.deepEqual(after.release,{name:current.name,version:current.version,tag:'v'+current.version});
 const lock=JSON.parse(await fs.readFile(path.join(consumer,'package-lock.json'),'utf8'));assert.equal(lock.packages['node_modules/@immedi/iaic-core'].version,current.version);
 console.log(JSON.stringify({predecessor:predecessor.tag,current:after.release.tag,ordinaryNpmUpgrade:true,cachePreservedBetweenInstalls:true,runtimeIdentityUpdated:true,lockVersionMatches:true}));
} finally {await fs.rm(temporary,{recursive:true,force:true});}
