import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {AgentRegistry} from '@immedi/iaic-core/identities/registry.js';
const definition={id:'editor',purpose:'Prepare sourced drafts.',capabilities:['work'],configuration:{skills:['editing/SKILL.md'],knowledge:['guide']}};
const actor={scopeId:'org',subjectId:'alice'};
const setup=()=>new AgentRegistry({store:{ensure:async()=>({id:'instance',state:'active'}),get:async()=>({id:'instance',state:'active'})},resolveScope:async a=>({applicationId:a.scopeId,subjectId:a.subjectId})});
test('host registers and revises jobs without mandatory role taxonomy or mutable configuration aliases',async()=>{
 const registry=setup(),source=structuredClone(definition),first=registry.register(source);
 assert.equal(first.role,null);source.configuration.skills.push('unregistered');assert.deepEqual(first.configuration.skills,['editing/SKILL.md']);
 assert.throws(()=>first.configuration.skills.push('unregistered'),TypeError);
 const bound=await registry.bind(actor,'editor','work');
 assert.throws(()=>registry.register(definition),{statusCode:409});
 const next=registry.register({...definition,role:'Editorial desk',configuration:{...definition.configuration,skills:[]}},{expectedRevision:first.revision});
 assert.notEqual(next.revision,first.revision);await assert.rejects(registry.check(actor,bound,'work'),{statusCode:409});
 assert.equal((await registry.bind(actor,'editor','work')).definitionRevision,next.revision);
 assert.throws(()=>registry.register(definition,{expectedRevision:first.revision}),{statusCode:409});
 const restored=new AgentRegistry({...setup(),definitions:[JSON.parse(JSON.stringify(next))]});assert.equal(restored.definition('editor').revision,next.revision);
});
test('configuration round trips retain revisions and legacy role definitions retain existing hashes',()=>{
 const legacy={id:'helper',role:'user-assistant',purpose:'Help',capabilities:['work']};
 assert.equal(setup().register(legacy).revision,createHash('sha256').update(JSON.stringify(legacy)).digest('hex'));
 const reversed={...definition,configuration:{knowledge:['guide'],skills:['editing/SKILL.md']}};
 assert.equal(setup().register(reversed).revision,setup().register(definition).revision);
 for(const configuration of [3,[],{bad:undefined},{bad:()=>true},{bad:Infinity},{large:'x'.repeat(16385)}])assert.throws(()=>setup().register({...definition,configuration}),{statusCode:400});
});
test('configuration change during asynchronous binding cannot admit an old definition with new resource selection',async()=>{
 const registry=setup(),first=registry.register(definition);
 registry.store.ensure=async()=>{registry.register({...definition,purpose:'Changed'},{expectedRevision:first.revision});return {id:'instance',state:'active'};};
 await assert.rejects(registry.bind(actor,'editor','work'),{statusCode:409});
});
