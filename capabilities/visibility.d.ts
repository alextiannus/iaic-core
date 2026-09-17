import type {RegisteredCapability,History} from './index.js';
export type CapabilitySurface = 'model' | 'host';
export type CapabilityVisibility = CapabilitySurface | 'both';
export function validateSurface(surface: CapabilitySurface): CapabilitySurface;
export function capabilityVisible(capability: RegisteredCapability | undefined, surface: CapabilitySurface): boolean;
export function assertCapabilitySurface(capability: RegisteredCapability | undefined, surface: CapabilitySurface): void;
export function assertModelHistory(history: History, dispatcher: {capabilities: ReadonlyMap<string,RegisteredCapability>}): void;
