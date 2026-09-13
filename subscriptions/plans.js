import {fail, plan} from './contracts.js';
export class PlanCatalog {
  #plans = new Map();
  constructor(plans = []) { for (const value of plans) this.register(value); }
  register(value) {
    const entry = plan(value), id = JSON.stringify([entry.id, entry.version]);
    if (this.#plans.has(id)) throw fail('Plan version already registered; publish a new version instead', 409);
    this.#plans.set(id, structuredClone(entry));
    return structuredClone(entry);
  }
  get(id, version) {
    const entry = this.#plans.get(JSON.stringify([id, version]));
    if (!entry) throw fail('Plan version not found', 404);
    return structuredClone(entry);
  }
  list() { return [...this.#plans.values()].map(entry => structuredClone(entry)); }
}
