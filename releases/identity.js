import {readFileSync} from 'node:fs';

// Read the installed package, not an application's self-reported candidate label.
const {name,version} = JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
export const CORE_RELEASE = Object.freeze({name,version,tag:'v'+version});
