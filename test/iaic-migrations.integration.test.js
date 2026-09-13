import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';import {migratePostgres} from '@immedi/iaic-core';
test('Migrations serialize concurrent deployment, reject changed history and roll back failed batches',async()=>{
 const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;if(!connectionString)throw new Error('Isolated PostgreSQL required');const schema='migrate_test_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
 try{const migrations=[{id:'001',sql:'CREATE TABLE fixture(id integer PRIMARY KEY)'}];const options={pool,namespace:'app',migrations};const result=await Promise.all([migratePostgres(options),migratePostgres(options)]);assert.equal(result.reduce((n,r)=>n+r.applied.length,0),1);
 await assert.rejects(migratePostgres({...options,migrations:[{id:'001',sql:'CREATE TABLE other(id integer)'}]}),/modified/);
 await assert.rejects(migratePostgres({...options,migrations:[...migrations,{id:'002',sql:'INSERT INTO fixture VALUES(1)'},{id:'003',sql:'INSERT INTO missing_table VALUES(1)'}]}));assert.equal((await pool.query('SELECT * FROM fixture')).rowCount,0);
 assert.equal((await pool.query('SELECT * FROM iaic_schema_migrations')).rowCount,1);
 assert.deepEqual((await migratePostgres({...options,migrations:[...migrations,{id:'002',sql:'INSERT INTO fixture VALUES(1)'}]})).applied,['002']);
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
