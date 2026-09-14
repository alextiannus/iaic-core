import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {CORE_RELEASE} from '@immedi/iaic-core';
import {CORE_RELEASE as subpath} from '@immedi/iaic-core/releases/identity.js';
test('runtime identity comes from package metadata and root/subpath agree',async()=>{
 const pkg=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.deepEqual(CORE_RELEASE,{name:pkg.name,version:pkg.version,tag:'v'+pkg.version});assert.equal(subpath,CORE_RELEASE);assert.ok(Object.isFrozen(CORE_RELEASE));
});
