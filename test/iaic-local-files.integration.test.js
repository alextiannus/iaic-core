import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {LocalDirectoryDevice,LocalFiles,PostgresDeviceOperations} from '@immedi/iaic-core';
async function fixture(run){const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL,schema='files_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`}),directory=await fs.mkdtemp(path.join(os.tmpdir(),'iaic-files-test-'));try{const store=new PostgresDeviceOperations({pool,namespace:'fixture'});await store.initialize();await run({store,directory});}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(directory,{recursive:true,force:true});}}
test('local files create atomically, reject traversal/symlinks/overwrite and retain original receipt',()=>fixture(async({store,directory})=>{
 const device=await LocalDirectoryDevice.open({directory,maxBytes:100}),actor={id:'one'};let allowed=true;
 const service=new LocalFiles({store,resolveOwner:a=>a.id,resolveDevice:()=>device,authorize:()=>allowed});
 const input={deviceId:'folder',requestKey:'one',name:'note.txt',text:'Hello'};
 const receipt=await service.create(actor,input);assert.equal(receipt.status,'created');assert.deepEqual(await service.create(actor,input),receipt);
 await assert.rejects(service.create(actor,{...input,text:'different'}),{statusCode:409});
 await assert.rejects(service.create(actor,{...input,requestKey:'two'}),{statusCode:409});assert.equal((await service.result(actor,{...input,requestKey:'two'})).status,'not-executed');
 assert.equal((await service.read(actor,input)).text,'Hello');
 for(const name of ['../escape','a/b','a\\b','.','..'])await assert.rejects(service.create(actor,{...input,name,requestKey:name}));
 await fs.symlink(path.join(directory,'note.txt'),path.join(directory,'link'));
 await assert.rejects(device.read({name:'link'}));await assert.rejects(device.create({name:'link',text:'changed'}));
 await fs.link(path.join(directory,'note.txt'),path.join(directory,'hardlink'));await assert.rejects(device.read({name:'hardlink'}));
 await assert.rejects(device.create({name:'large',text:'x'.repeat(101)}));
 await assert.rejects(service.result({id:'other'},input),{statusCode:404});allowed=false;await assert.rejects(service.read(actor,input),{statusCode:403});
 assert.equal(await fs.readFile(path.join(directory,'note.txt'),'utf8'),'Hello');
}));
test('lost local file response stays unknown and cannot create a second effect',()=>fixture(async({store,directory})=>{
 const local=await LocalDirectoryDevice.open({directory});let count=0;
 const service=new LocalFiles({store,resolveOwner:()=> 'one',authorize:()=>true,resolveDevice:()=>({create:async input=>{count++;await local.create(input);throw Error('lost');}})});
 const input={deviceId:'folder',requestKey:'one',name:'note.txt',text:'Saved'};
 await assert.rejects(service.create({},input),{outcomeUnknown:true});await assert.rejects(service.create({},input),{outcomeUnknown:true});
 await assert.rejects(service.create({},{...input,requestKey:'two',name:'other.txt'}),{statusCode:409});assert.equal(count,1);
 assert.equal((await service.result({},input)).status,'unknown');assert.equal(await fs.readFile(path.join(directory,'note.txt'),'utf8'),'Saved');
}));
