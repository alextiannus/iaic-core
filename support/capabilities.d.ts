import type {SupportIssues} from './service.js';
export function createSupportCapabilities(options:{support:SupportIssues;prefix?:string}):any[];
export function createSupportFollowUpCapabilities(options:{followUp:import('./follow-up.js').SupportFollowUp;prefix?:string}):import('../capabilities/index.js').CapabilityDefinition[];
