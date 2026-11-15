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
  for (const folder of ['dashboard', 'share', 'login', 'setup']) {
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
