const test = require('node:test');
const assert = require('node:assert/strict');
const { EMAIL_RE, PIN_RE, ADMIN_EMP_IDS, computeRole, generateInviteCode } = require('../helpers');

test('computeRole', async (t) => {
  await t.test('grants OWNER to admin employee ids regardless of designation', () => {
    for (const id of ADMIN_EMP_IDS) {
      assert.equal(computeRole(id, 'STAFF'), 'OWNER');
      assert.equal(computeRole(String(id), undefined), 'OWNER');
    }
  });

  await t.test('grants COMPUTER to the COMPUTER designation', () => {
    assert.equal(computeRole(1, 'COMPUTER'), 'COMPUTER');
  });

  await t.test('defaults everyone else to STAFF', () => {
    assert.equal(computeRole(1, 'SALES'), 'STAFF');
    assert.equal(computeRole(1, undefined), 'STAFF');
  });

  await t.test('admin status wins even if a designation is also set', () => {
    const [adminId] = ADMIN_EMP_IDS;
    assert.equal(computeRole(adminId, 'COMPUTER'), 'OWNER');
  });
});

test('generateInviteCode', async (t) => {
  await t.test('is 6 characters, uppercase, from the allowed alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateInviteCode();
      assert.equal(code.length, 6);
      assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });

  await t.test('excludes visually ambiguous characters I, O, 0, 1', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateInviteCode();
      assert.doesNotMatch(code, /[IO01]/);
    }
  });
});

test('EMAIL_RE', async (t) => {
  await t.test('accepts plausible email addresses', () => {
    for (const email of ['a@b.com', 'first.last@sub.domain.co.in', 'x+y@z.io']) {
      assert.match(email, EMAIL_RE);
    }
  });

  await t.test('rejects malformed input', () => {
    for (const email of ['', 'no-at-sign', '@no-local.com', 'no-domain@', 'has space@x.com']) {
      assert.doesNotMatch(email, EMAIL_RE);
    }
  });
});

test('PIN_RE', async (t) => {
  await t.test('accepts 4 to 6 digit PINs', () => {
    for (const pin of ['1234', '12345', '123456']) {
      assert.match(pin, PIN_RE);
    }
  });

  await t.test('rejects PINs outside 4-6 digits or with non-digits', () => {
    for (const pin of ['123', '1234567', '12a4', '', ' 1234']) {
      assert.doesNotMatch(pin, PIN_RE);
    }
  });
});
