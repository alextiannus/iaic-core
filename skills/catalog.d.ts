export interface SkillCatalogEntry {
 id:string;name:string;description:string;version:string;format:'agent-skills'|'legacy-markdown';
 license?:string;compatibility?:string;'allowed-tools'?:string;metadata?:Record<string,string>;
}
export interface SkillReadOptions {resource?:string|null;expectedVersion?:string|null;expectedResourceVersion?:string|null}
export interface SkillDocument {id:string;resource:string|null;text:string;version:string;skillVersion:string}
export class SkillCatalog<C=Record<string,unknown>> {
 constructor(options:{root:string;entries:string[];maxBytes?:number;selectEntries?:((context:C)=>string[]|Promise<string[]>)|null});
 root:string;entries:string[];maxBytes:number;
 selected(context?:C):Promise<string[]>;
 list(context?:C):Promise<SkillCatalogEntry[]>;
 read(id:string,options?:SkillReadOptions,context?:C):Promise<SkillDocument>;
}
