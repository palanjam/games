import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROMPTS, ANSWERS } from '../cards.js';

const norm = (s) => s.trim().toLowerCase();

for (const [name, list, min] of [
  ['PROMPTS', PROMPTS, 150],
  ['ANSWERS', ANSWERS, 500],
]) {
  test(`${name} has at least ${min} entries`, () => {
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= min, `${name} has ${list.length}`);
  });

  test(`${name} are non-empty strings`, () => {
    for (const s of list) {
      assert.equal(typeof s, 'string');
      assert.ok(s.trim().length > 0);
    }
  });

  test(`${name} are unique (case-insensitive, trimmed)`, () => {
    const seen = new Set();
    const dupes = [];
    for (const s of list) {
      const k = norm(s);
      if (seen.has(k)) dupes.push(s);
      seen.add(k);
    }
    assert.deepEqual(dupes, []);
  });
}

test("answers are short phrases (1-4 words, spec)", () => {
  for (const s of ANSWERS) assert.ok(s.trim().split(/\s+/).length <= 4, s);
});
