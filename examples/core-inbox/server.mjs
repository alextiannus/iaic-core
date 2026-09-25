import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {openDemo} from './application.mjs';
import {serveDemo} from './http.mjs';
const connectionString=process.env.SUBMISSION_TEST_DATABASE_URL;
if(!connectionString||!['localhost','127.0.0.1'].includes(new URL(connectionString).hostname))throw Error('Local isolated SUBMISSION_TEST_DATABASE_URL required');
const schema='inbox_ui_'+randomUUID().replaceAll('-','');const admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString,options:`-c search_path=${schema}`});let server;
try{const app=await openDemo(pool);await app.seed();server=await serveDemo(app);console.log(server.origin);}catch(error){await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();throw error;}
let closing=false;async function close(){if(closing)return;closing=true;await server.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
process.once('SIGINT',close);process.once('SIGTERM',close);
