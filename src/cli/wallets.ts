import { addWallet, listWallets, openDb, removeWallet } from '../storage/index.ts';

const [cmd = 'list', ...args] = process.argv.slice(2);
const db = openDb();

try {
  if (cmd === 'list') {
    const wallets = listWallets(db);
    if (wallets.length === 0) console.log('No wallets yet. Add one: npm run wallets -- add <address> [label]');
    for (const w of wallets) console.log(`#${w.id}  ${w.kind.padEnd(6)}  ${w.label.padEnd(12)}  ${w.address}`);
  } else if (cmd === 'add' && args[0]) {
    const w = addWallet(db, args[0], args.slice(1).join(' '));
    console.log(`Added #${w.id}: ${w.kind} "${w.label}" ${w.address}`);
  } else if (cmd === 'rm' && /^\d+$/.test(args[0] ?? '')) {
    console.log(removeWallet(db, Number(args[0])) ? `Removed #${args[0]}` : `No wallet #${args[0]}`);
  } else {
    console.error('Usage: wallets [list] | add <address> [label] | rm <id>');
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
