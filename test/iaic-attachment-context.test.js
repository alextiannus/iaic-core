import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {PostgresObjectStore} from '../storage/postgres.js';import {ObjectStorage} from '../storage/objects.js';import {attachmentContent,chatContent} from '../context/attachments.js';
test('Postgres objects retain immutable data, reject cross-owner reads and serialize quota admission',async()=>{
 const admin=new Pool({connectionString:process.env.SUBMISSION_TEST_DATABASE_URL}),schema='attachments_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:process.env.SUBMISSION_TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 try{const store=new PostgresObjectStore({pool,namespace:'test',maxBytes:10,maxScopeBytes:12});await store.initialize();let allowed=true;const objects=new ObjectStorage({store,resolveScope:a=>a,authorize:()=>allowed});const ref=await objects.put('a',Buffer.from('hello'));assert.deepEqual(await objects.put('a',Buffer.from('hello')),ref);await assert.rejects(objects.get('b',ref),{statusCode:404});
 const settled=await Promise.allSettled([objects.put('a',Buffer.from('123456')),objects.put('a',Buffer.from('654321'))]);assert.equal(settled.filter(r=>r.status==='fulfilled').length,1);assert.equal(settled.find(r=>r.status==='rejected').reason.statusCode,413);
 const restored=new PostgresObjectStore({pool,namespace:'test'});assert.equal((await restored.get('a',ref)).toString(),'hello');await assert.rejects(restored.get('a',{...ref,byteLength:4}),{statusCode:409});allowed=false;await assert.rejects(objects.get('a',ref),{statusCode:403});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
test('Attachment context re-resolves bytes, maps images/PDF for both providers and bounds transfer',async()=>{
 let reads=0;const refs=[{mediaType:'image/png',filename:'photo.png'},{mediaType:'application/pdf',filename:'brief.pdf'},{mediaType:'text/plain',filename:'note.txt'}];const parts=await attachmentContent(refs,async()=>{reads++;return Buffer.from('fixture');});assert.equal(reads,3);assert.equal(parts[0].type,'input_image');assert.equal(parts[1].filename,'brief.pdf');assert.match(parts[2].text,/fixture/);const chat=chatContent([{role:'user',content:parts}])[0].content;assert.equal(chat[0].type,'image_url');assert.equal(chat[1].file.filename,'brief.pdf');await assert.rejects(attachmentContent(refs,async()=>Buffer.alloc(20),{maxBytes:10}),{statusCode:413});await assert.rejects(attachmentContent(refs,async()=>{throw Object.assign(Error('Revoked'),{statusCode:403});}),{statusCode:403});
});

test('PDF text fallback extracts actual content and rejects invalid/encrypted files without model calls',async()=>{
 const {extractPdfText}=await import('../context/pdf-text.js');
 const stream='BT /F1 12 Tf 30 70 Td (Invoice TEST-529 amount SGD 5200) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let pdf='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 const result=await extractPdfText(Buffer.from(pdf));assert.equal(result.hasText,true);assert.match(result.text,/TEST-529/);assert.match(result.text,/5200/);
 const parts=await attachmentContent([{filename:'invoice.pdf',mediaType:'application/pdf'}],async()=>Buffer.from(pdf),{pdfMode:'text'});assert.equal(parts[0].type,'input_text');assert.match(parts[0].text,/TEST-529/);
 await assert.rejects(extractPdfText(Buffer.from('%PDF-broken')),{statusCode:400});
});
