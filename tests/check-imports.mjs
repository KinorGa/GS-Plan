// Report imports that are never referenced in the file that imports them.
//
// A light check, not a linter: it catches the leftover from a refactor (an
// import kept after the last use was removed), which is exactly what a
// move-things-around change tends to leave behind.
import fs from 'node:fs';

const FILES = [
  'src/components/TeamPanel.jsx',
  'src/components/ConfigTransfer.jsx',
  'src/lib/team-context.jsx',
  'src/lib/team-model.js',
  'src/planner-main.jsx',
  'src/components/builder/UnitCard.jsx',
  'src/components/builder/WeaponPicker.jsx',
  'src/components/builder/artifact/SetPicker.jsx',
];

let found = 0;

for (const f of FILES) {
  const src = fs.readFileSync(f, 'utf8');
  const names = [];

  // Named imports: `import { a, b as c } from '...'`
  for (const m of src.matchAll(/import\s+\{([^}]+)\}\s+from/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.push(name);
    }
  }
  // Default imports: `import X from '...'`
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s+from/g)) {
    names.push(m[1]);
  }

  const unused = [];
  for (const n of names) {
    const hits = src.match(new RegExp(`\\b${n}\\b`, 'g')) || [];
    // One hit is the import itself.
    if (hits.length <= 1) unused.push(n);
  }

  if (unused.length) {
    console.log(`${f}\n  unused: ${[...new Set(unused)].join(', ')}`);
    found += unused.length;
  }
}

console.log(found ? `\n${found} unused imports` : 'no unused imports');
process.exit(found ? 1 : 0);
