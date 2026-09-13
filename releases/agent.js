import {isDeepStrictEqual} from 'node:util';import {jsonValue} from '../evaluation/runner.js';
const fail=(message,statusCode=409)=>Object.assign(new Error(message),{statusCode});
// Decorate the existing Runtime identity port; do not create another Agent engine.
export class ReleaseBoundAgentIdentity {
 #reference;
 constructor({identity,releases,reference,implementationRevision}){
  if(typeof identity?.bind!=='function'||typeof identity?.check!=='function'||typeof releases?.check!=='function'||typeof implementationRevision!=='string'||!implementationRevision||typeof reference?.releaseId!=='string'||!/^[a-f0-9]{64}$/.test(reference?.manifestDigest))throw fail('Identity, current release checks and a pinned implementation required',400);
  this.identity=identity;this.releases=releases;this.implementationRevision=implementationRevision;this.#reference=Object.freeze({releaseId:reference.releaseId,manifestDigest:reference.manifestDigest});
 }
 async current(actor,version){
  if(version!==this.implementationRevision)throw fail('Runtime version differs from its bound release');
  const manifest=await this.releases.check(actor,this.#reference);
  if(manifest.implementationRevision!==version)throw fail('Manifest implementation differs from the Runtime');
 }
 async bind(args){
  await this.current(args.actor,args.version);const binding=jsonValue(await this.identity.bind(args));
  if(!binding||typeof binding!=='object'||Array.isArray(binding)||Object.hasOwn(binding,'release'))throw fail('Identity binding must be an object without a reserved release field');
  await this.current(args.actor,args.version);return {...binding,release:{...this.#reference}};
 }
 async check(args){
  if(!args.binding||!isDeepStrictEqual(args.binding.release,this.#reference))throw fail('Task belongs to another release binding');
  await this.current(args.actor,args.task.version);const {release,...binding}=args.binding;
  await this.identity.check({...args,task:{...args.task,agent:binding},binding});await this.current(args.actor,args.task.version);return args.binding;
 }
}
