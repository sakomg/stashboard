// Sets the dashboard password and the authenticator secret in config.json.
// Run in your own terminal: npm run auth
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { hashPassword, newTotpSecret, otpauthUri, totpCode } from './auth.ts';

const path = process.env.CONFIG_PATH ?? 'config.json';
const MIN_LENGTH = 12;

if (!process.stdin.isTTY) {
  console.error('Run this in an interactive terminal: the password is typed, never passed as an argument.');
  process.exit(1);
}

/** Reads one line; with `hidden`, what is typed is not echoed. */
function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput.bind(rl);
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
      if (s.includes(question) || s === '\r\n' || s === '\n') write(s);
    };
  }
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

const config = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
const existing = (config.auth ?? {}) as { totpSecret?: string };

const password = await ask(`New password (at least ${MIN_LENGTH} characters): `, true);
if (password.length < MIN_LENGTH) {
  console.error(`\nToo short: use at least ${MIN_LENGTH} characters.`);
  process.exit(1);
}
if ((await ask('Repeat the password: ', true)) !== password) {
  console.error('\nThe passwords do not match. Nothing was changed.');
  process.exit(1);
}

// Keep the authenticator entry on a password change unless a new one is asked for.
let totpSecret = existing.totpSecret;
if (totpSecret && (await ask('Keep the current authenticator entry? [Y/n] ')).trim().toLowerCase() === 'n')
  totpSecret = undefined;

if (!totpSecret) {
  totpSecret = newTotpSecret();
  const uri = otpauthUri(totpSecret, 'dashboard');
  console.log('\nAdd this account to an authenticator app (Google Authenticator, 1Password, Aegis, ...):\n');
  try {
    const qr = (await import('qrcode-terminal')) as {
      default: { generate(text: string, options: { small: boolean }): void };
    };
    qr.default.generate(uri, { small: true });
  } catch {
    // The QR code is a convenience; the key below works on its own.
  }
  console.log(`  Key for manual entry: ${totpSecret.match(/.{1,4}/g)!.join(' ')}`);
  console.log(`  Link: ${uri}\n`);

  const code = (await ask('Enter the 6-digit code the app shows now: ')).trim();
  const step = Math.floor(Date.now() / 30000);
  if (![step - 1, step, step + 1].some((s) => totpCode(totpSecret!, s) === code)) {
    console.error('That code does not match. Nothing was changed; run npm run auth again.');
    process.exit(1);
  }
}

config.auth = { passwordHash: hashPassword(password), totpSecret };
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
console.log(`\nSaved to ${path}. Deploy to apply it on the server: ./deploy.sh user@host`);
