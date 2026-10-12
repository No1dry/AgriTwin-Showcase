import {readFile,writeFile} from 'node:fs/promises';
import {validateShowcase,assertPublicText} from './build.mjs';
const text=await readFile(new URL('../../AgriTwin-Intelligence/public/external/latest.json',import.meta.url),'utf8');
assertPublicText(text);validateShowcase(JSON.parse(text));
await writeFile(new URL('../public/data/showcase.json',import.meta.url),text);
console.log('Copied validated real external snapshot.');
