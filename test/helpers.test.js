const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EMAIL_RE, PIN_RE, ADMIN_EMP_IDS, computeRole, generateInviteCode,
  isGenderEligible, hasTimingOverlap, citiesConflict, isGiveUpOnCooldown,
} = require('../helpers');

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

test('isGenderEligible', async (t) => {
  await t.test('always eligible when the stock does not require male staff', () => {
    assert.equal(isGenderEligible('FEMALE', false), true);
    assert.equal(isGenderEligible('MALE', false), true);
    assert.equal(isGenderEligible(undefined, false), true);
  });

  await t.test('only male staff eligible when the stock requires it', () => {
    assert.equal(isGenderEligible('MALE', true), true);
    assert.equal(isGenderEligible('male', true), true); // case-insensitive
    assert.equal(isGenderEligible('FEMALE', true), false);
    assert.equal(isGenderEligible(undefined, true), false);
  });
});

test('hasTimingOverlap', async (t) => {
  await t.test('true when a shared non-any slot exists', () => {
    assert.equal(hasTimingOverlap(['1000'], ['1000', '1700']), true);
  });

  await t.test('false when slots do not intersect', () => {
    assert.equal(hasTimingOverlap(['1000'], ['1700']), false);
  });

  await t.test('"any" never counts as an overlap', () => {
    assert.equal(hasTimingOverlap(['any'], ['any']), false);
    assert.equal(hasTimingOverlap(['any'], ['1000']), false);
  });

  await t.test('handles empty/undefined arrays', () => {
    assert.equal(hasTimingOverlap([], ['1000']), false);
    assert.equal(hasTimingOverlap(undefined, undefined), false);
  });
});

test('citiesConflict', async (t) => {
  await t.test('false when everyone shares one city category', () => {
    assert.equal(citiesConflict(['IN_CITY', 'IN_CITY']), false);
    assert.equal(citiesConflict(['OUT_OF_CITY']), false);
  });

  await t.test('true when city categories are mixed', () => {
    assert.equal(citiesConflict(['IN_CITY', 'OUT_OF_CITY']), true);
  });
});

test('isGiveUpOnCooldown', async (t) => {
  await t.test('not blocked if the stock was never given up before', () => {
    assert.equal(isGiveUpOnCooldown(null, false), false);
    assert.equal(isGiveUpOnCooldown(undefined, false), false);
  });

  await t.test('not blocked once they have marked it done since giving it up', () => {
    assert.equal(isGiveUpOnCooldown('2026-08-10 10:00:00', true), false);
  });

  await t.test('blocked when given up before and not done since', () => {
    assert.equal(isGiveUpOnCooldown('2026-08-10 10:00:00', false), true);
  });
});
