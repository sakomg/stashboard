import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAddress } from '../../src/domain/address.ts';

test('detects the network from the address format', () => {
  assert.equal(parseAddress('0x52908400098527886E0F7030069857D2E4169EE7').kind, 'evm');
  assert.equal(parseAddress('So11111111111111111111111111111111111111112').kind, 'solana');
  assert.equal(parseAddress('EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N').kind, 'ton');
});

test('the same wallet written differently has the same key', () => {
  const upper = parseAddress('0x52908400098527886E0F7030069857D2E4169EE7');
  const lower = parseAddress('0x52908400098527886e0f7030069857d2e4169ee7');
  assert.equal(upper.key, lower.key);

  const friendly = parseAddress('EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N');
  const raw = parseAddress('0:83dfd552e63729b472fcbcc8c45ebcc6691702558b68ec7527e1ba403a0f31a8');
  assert.equal(friendly.key, raw.key);
});

test('rejects malformed addresses', () => {
  assert.throws(() => parseAddress('0x1234'));
  assert.throws(() => parseAddress('not an address'));
  assert.throws(() => parseAddress('EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2M'));
});
