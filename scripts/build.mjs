import { Script } from 'node:vm';
import { createHash } from 'node:crypto';
import { validateShowcase } from './validate.mjs';
export { validateShowcase };
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const PUBLIC_FILES = Object.freeze(['index.html', 'assets/app.css', 'assets/app.js', 'data/showcase.json']);
const DIRECTORIES = new Set(['assets', 'data']);
const MAX_FILE_BYTES = 2_000_000;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/** The publish surface is explicit; unknown files and links fail closed. */
export async function inspectTree(directory, required = true) {
  let stat;
  try { stat = await lstat(directory); }
  catch (error) { if (!required && error.code === 'ENOENT') return []; throw error; }
  requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), 'SITE_LINK_OR_DIRECTORY');
  const files = [];
  async function visit(current, prefix = '') {
    for (const name of await readdir(current)) {
      const relative = prefix + name;
      const metadata = await lstat(path.join(current, name));
      requireCondition(!metadata.isSymbolicLink(), 'SITE_LINK_REJECTED');
      if (metadata.isDirectory()) {
        requireCondition(DIRECTORIES.has(relative), `SITE_UNLISTED_DIRECTORY: ${relative}`);
        await visit(path.join(current, name), relative + '/');
      } else {
        requireCondition(metadata.isFile() && metadata.nlink === 1, 'SITE_NONREGULAR_FILE');
        requireCondition(PUBLIC_FILES.includes(relative), `SITE_UNLISTED_FILE: ${relative}`);
        requireCondition(metadata.size <= MAX_FILE_BYTES, 'SITE_FILE_TOO_LARGE');
        files.push(relative);
      }
    }
  }
  await visit(directory);
  if (required) requireCondition(files.length === PUBLIC_FILES.length, 'SITE_REQUIRED_FILE_MISSING');
  return files.sort();
}

export function assertPublicText(text) {
  requireCondition(!/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u.test(text), 'SITE_CREDENTIAL_PATTERN');
  requireCondition(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(text), 'SITE_PRIVATE_KEY');
  requireCondition(!/(?:api[_-]?key|access[_-]?token|client[_-]?secret|authorization|password)["']?\s*[:=]\s*["']?[^\s"',;}]{8,}/iu.test(text), 'SITE_CREDENTIAL_ASSIGNMENT');
  requireCondition(!/\b[A-Za-z]:[\\/]|file:\/\/|(?:^|[\s"'(])\/(?:Users|home|root|tmp|private|var)\//mu.test(text), 'SITE_ABSOLUTE_MACHINE_PATH');
  requireCondition(!/["'\/\\]\.env(?:[."'\/\\\s]|$)/mu.test(text), 'SITE_ENV_REFERENCE');
}

export async function readPublicFiles(root = PROJECT_ROOT) {
  const source = path.join(root, 'public');
  await inspectTree(source);
  const result = new Map();
  for (const name of PUBLIC_FILES) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path.join(source, name)));
    assertPublicText(text);
    result.set(name, text);
  }
  validateShowcase(JSON.parse(result.get('data/showcase.json')));
  const javascript = result.get('assets/app.js');
  new Script(javascript);
  requireCondition(!/innerHTML|document\.write|\beval\s*\(/u.test(javascript), 'SITE_UNSAFE_RENDER');
  const html = result.get('index.html');
  requireCondition(!/<(?:base|iframe|object|embed|form)\b|\son[a-z]+\s*=/iu.test(html), 'SITE_ACTIVE_HTML');
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/giu)) {
    const url = match[1];
    requireCondition(!url.startsWith('/') && !/^(?:javascript|data|file):/iu.test(url), 'SITE_RESOURCE_PATH');
  }
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)) {
    requireCondition(/\bsrc\s*=\s*["'](?:\.\/)?assets\/app\.js["']/iu.test(match[1]) && !match[2].trim(), 'SITE_SCRIPT_SOURCE');
  }
  requireCondition(!/@import\b|url\(\s*["']?(?:https?:|\/\/)/iu.test(result.get('assets/app.css')), 'SITE_REMOTE_STYLE');
  return result;
}

/** Only reviewed files enter dist; stale or unexpected dist content is rejected, never recursively deleted. */
export async function build(root = PROJECT_ROOT) {
  const files = await readPublicFiles(root);
  const target = path.resolve(root, 'dist');
  requireCondition(path.dirname(target) === path.resolve(root), 'SITE_OUTPUT_PATH');
  await inspectTree(target, false);
  await mkdir(target, { recursive: true });
  for (const [name, text] of files) {
    await mkdir(path.dirname(path.join(target, name)), { recursive: true });
    const output = name === 'index.html'
      ? ['assets/app.css', 'assets/app.js'].reduce((html, asset) => {
          const version = createHash('sha256').update(files.get(asset)).digest('hex').slice(0, 12);
          return html.replace(`./${asset}`, `./${asset}?v=${version}`);
        }, text)
      : text;
    await writeFile(path.join(target, name), output, { encoding: 'utf8' });
  }
  await inspectTree(target);
  return target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await build(); console.log(`Built ${PUBLIC_FILES.length} reviewed public files into dist.`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
