import type {Operations} from './service.js';
export interface SkillMetadata {id:string;name:string;description:string;version:string;format?:string;license?:string;compatibility?:string;'allowed-tools'?:string;source?:string;metadata?:{author?:string;version?:string}}
export interface SkillBinding {id:string;installedVersion:string;enabled:boolean;readiness:'ready'|'blocked'|'unknown';reason:string}
export interface SkillSnapshot<T> {items:T[];complete:boolean;observedAt:string;validUntil:string}
export interface SkillQuery {agentId?:string;query?:string;status?:'all'|'installed'|'not-installed'|'enabled'|'blocked'|'unknown'|'update-available'|'unregistered';limit?:number;cursor?:string}
export interface SkillView extends Omit<SkillMetadata,'version'> {version:string|null;registered:boolean|null;installed:boolean|null;installedVersion:string|null;enabled:boolean|null;readiness:'ready'|'blocked'|'unknown';reason:string;updateAvailable:boolean|null}
export interface SkillInventoryPage {schemaVersion:1;agentId:string|null;asOf:string;revision:string;complete:boolean;sources:{catalog:Omit<SkillSnapshot<never>,'items'>&{state:string};bindings:(Omit<SkillSnapshot<never>,'items'>&{state:string})|null};counts:{scope:'authorized-snapshot';supported:number;installed:number|null;matched:number;blocked:number|null;updates:number|null};items:SkillView[];nextCursor:string|null}
export class SkillInventory<A=unknown> {
 constructor(options:{operations:Operations<A>;cursorKey:Uint8Array;listCatalog(input:{actor:A;scope:string;agent:unknown;signal:AbortSignal}):Promise<SkillSnapshot<SkillMetadata>>;readBindings(input:{actor:A;scope:string;agent:unknown;signal:AbortSignal}):Promise<SkillSnapshot<SkillBinding>>;clock?:()=>number;timeoutMs?:number});
 list(actor:A,input?:SkillQuery):Promise<SkillInventoryPage>;
}
