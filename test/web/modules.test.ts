import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../public/', import.meta.url);

function moduleGraph(folder: string) {
  const dir = new URL(`${folder}/`, root);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  const graph = new Map<string, { exports: Set<string>; imports: { from: string; names: string[] }[] }>();
  for (const file of files) {
    const text = readFileSync(new URL(file, dir), 'utf8');
    const exports = new Set(
      [...text.matchAll(/^export (?:async )?(?:function|const|let|class) ([\w$]+)/gm)].map((m) => m[1]!),
    );
    const imports = [...text.matchAll(/^import (?:\{([^}]*)\} from )?'([^']+)';/gm)].map((m) => ({
      from: m[2]!,
      names: (m[1] ?? '')
        .split(',')
        .map((n) => n.trim().split(/\s+as\s+/)[0]!)
        .filter(Boolean),
    }));
    graph.set(file, { exports, imports });
  }
  return graph;
}

const resolveLocal = (from: string): string | null => (from.startsWith('./') ? from.slice(2) : null);

test('every dashboard module is loaded from main.js', () => {
  const graph = moduleGraph('dashboard');
  const reached = new Set<string>();
  const visit = (file: string): void => {
    if (reached.has(file)) return;
    reached.add(file);
    for (const { from } of graph.get(file)!.imports) {
      const local = resolveLocal(from);
      if (local) visit(local);
    }
  };
  visit('main.js');
  assert.deepEqual(
    [...graph.keys()].filter((f) => !reached.has(f)),
    [],
  );
});

test('every name a page module imports is exported where it points', () => {
  for (const folder of ['dashboard', 'share', 'login', 'setup', 'join']) {
    const graph = moduleGraph(folder);
    const common = moduleGraph('common');
    for (const [file, { imports }] of graph) {
      for (const { from, names } of imports) {
        const target = from.startsWith('/common/')
          ? common.get(from.slice('/common/'.length))
          : graph.get(resolveLocal(from) ?? '');
        assert.ok(target, `${folder}/${file} imports ${from}, which does not exist`);
        for (const name of names) assert.ok(target.exports.has(name), `${folder}/${file} imports ${name} from ${from}`);
      }
    }
  }
});

test('dashboard modules do not import each other in a cycle', () => {
  const graph = moduleGraph('dashboard');
  const cycles: string[] = [];
  const visit = (file: string, path: string[]): void => {
    if (path.includes(file)) return void cycles.push([...path.slice(path.indexOf(file)), file].join(' > '));
    for (const { from } of graph.get(file)!.imports) {
      const local = resolveLocal(from);
      if (local) visit(local, [...path, file]);
    }
  };
  for (const file of graph.keys()) visit(file, []);
  assert.deepEqual(cycles, []);
});

test('forms are checked by the page, never by the browser', () => {
  const broken: string[] = [];
  for (const name of readdirSync(root, { recursive: true }) as string[]) {
    if (!/\.(html|js)$/.test(name)) continue;
    const text = readFileSync(new URL(name, root), 'utf8');
    if (name.endsWith('.html')) {
      for (const [form] of text.matchAll(/<form\b[^>]*>/g))
        if (!/\snovalidate\b/.test(form)) broken.push(`${name}: ${form}`);
      for (const [, attr] of text.matchAll(
        /<(?:input|textarea|select)\b[^>]*?\s(required|minlength|maxlength|pattern|min|max)\b/g,
      )) {
        broken.push(`${name}: ${attr}`);
      }
    }
    if (name.endsWith('.js')) {
      for (const [hit] of text.matchAll(
        /\b(?:required|minlength|maxlength|minLength|maxLength|pattern)\s*:|\.(?:required|maxLength|minLength|pattern)\s*=|setCustomValidity|reportValidity|checkValidity/g,
      )) {
        broken.push(`${name}: ${hit}`);
      }
    }
  }
  assert.deepEqual(broken, []);
});

test('switching views never writes browser history', () => {
  const writes: string[] = [];
  for (const folder of ['dashboard', 'common']) {
    for (const name of readdirSync(new URL(`${folder}/`, root)).filter((f) => f.endsWith('.js'))) {
      const text = readFileSync(new URL(`${folder}/${name}`, root), 'utf8');
      for (const [hit] of text.matchAll(/history\.\w+|location\.hash\s*=(?!=)/g))
        writes.push(`${folder}/${name}: ${hit}`);
    }
  }
  assert.deepEqual(writes, []);
});
