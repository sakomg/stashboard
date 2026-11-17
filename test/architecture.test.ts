import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src/', import.meta.url));

const ALLOWED: Record<string, string[]> = {
  lib: [],
  domain: ['lib'],
  auth: ['lib'],
  storage: ['domain', 'lib'],
  sources: ['domain', 'lib'],
  services: ['domain', 'lib', 'sources', 'storage'],
  server: ['auth', 'domain', 'lib', 'services', 'sources', 'storage'],
  cli: ['auth', 'domain', 'lib', 'main', 'server', 'services', 'sources', 'storage'],
  main: ['lib', 'server', 'sources', 'storage'],
};

const layerOf = (file: string): string => file.split('/')[0]!.replace(/\.ts$/, '');

test('each layer imports only the layers below it', () => {
  const broken: string[] = [];
  for (const file of readdirSync(src, { recursive: true }) as string[]) {
    if (!file.endsWith('.ts')) continue;
    const layer = layerOf(file);
    const text = readFileSync(join(src, file), 'utf8');
    for (const [, spec] of text.matchAll(/(?:from|import\()\s*'(\.{1,2}\/[^']+)'/g)) {
      const target = layerOf(relative(src, normalize(join(dirname(join(src, file)), spec!))));
      if (target !== layer && !ALLOWED[layer]?.includes(target)) broken.push(`${file} -> ${spec}`);
    }
  }
  assert.deepEqual(broken, []);
});

test('every folder in src has a place in the layering', () => {
  const layers = (readdirSync(src) as string[]).map((f) => f.replace(/\.ts$/, ''));
  assert.deepEqual(
    layers.filter((l) => !(l in ALLOWED)),
    [],
  );
});

test('every name a module exports is imported somewhere', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const files = ['src', 'test'].flatMap((dir) =>
    (readdirSync(join(root, dir), { recursive: true }) as string[])
      .filter((f) => f.endsWith('.ts'))
      .map((f) => join(dir, f)),
  );
  const importers = new Map<string, Set<string>>();
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const [, list] of text.matchAll(/(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'[^']+'/g)) {
      for (const entry of list!.split(',')) {
        const name = entry
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]!;
        if (name) importers.set(name, (importers.get(name) ?? new Set()).add(file));
      }
    }
  }
  const unused: string[] = [];
  for (const file of files.filter((f) => f.startsWith('src'))) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const [, name] of text.matchAll(/^export (?:async )?(?:function|const|let|class|interface|type) ([\w$]+)/gm)) {
      if (![...(importers.get(name!) ?? [])].some((f) => f !== file)) unused.push(`${file}: ${name}`);
    }
  }
  assert.deepEqual(unused, []);
});
