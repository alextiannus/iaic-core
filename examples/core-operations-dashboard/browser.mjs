import {createRequire} from 'node:module';
const {IAIC_BROWSER_HOST_PACKAGE:hostPackage,IAIC_BROWSER_EXECUTABLE:executablePath,IAIC_BROWSER_EVIDENCE:folder,SUBMISSION_TEST_DATABASE_URL:database}=process.env;
if(!hostPackage||!executablePath||!folder||!database||!['localhost','127.0.0.1'].includes(new URL(database).hostname))throw Error('Explicit browser package, executable, fresh evidence directory and local database required');
const puppeteer=createRequire(hostPackage)('puppeteer-core');
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {openFixture} from './fixture.mjs';
const fixture=await openFixture();const browser=await puppeteer.launch({executablePath,headless:true});

try{
 const page=await browser.newPage();await page.authenticate({username:'operator',password:fixture.password});const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewport({width:1280,height:900});await page.goto(fixture.url);await page.waitForSelector('.agent');assert.equal(await page.$$eval('.agent',els=>els.length),2);
 await page.click('.agent');await page.waitForFunction(()=>document.getElementById('detail').textContent.includes('task-bound-fixture-model'));
 assert.match(await page.$eval('#detail',e=>e.textContent),/实际确认模型未上报/);assert.match(await page.$eval('#detail',e=>e.textContent),/健康未知/);
 await mkdir(folder,{recursive:false});await page.screenshot({path:folder+'/dashboard.png',fullPage:true});
 await page.select('#view','list');assert.equal(await page.$eval('#agents',e=>e.dataset.view),'list');await page.setViewport({width:375,height:812});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:folder+'/mobile.png',fullPage:true});
 fixture.revoke();await page.click('#refresh');await page.waitForFunction(()=>document.getElementById('status').textContent.includes('没有平台运维看板权限'));assert.equal(await page.$$eval('.agent',els=>els.length),0);assert.equal(await page.$eval('#detail',e=>e.textContent),'');assert.equal((await fixture.task()).status,'queued');assert.deepEqual(errors,[]);
 const result={realBrowser:'Chrome',realTaskStore:true,operatorCards:2,selectedTask:true,modelBindingVisible:true,actualModelUnknown:true,healthUnknown:true,listSwitch:true,narrow375NoOverflow:true,revocationClearsContent:true,taskMutated:false,externalAgent:'Host fixture only',pageErrors:errors};await writeFile(folder+'/result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();await fixture.close();}
