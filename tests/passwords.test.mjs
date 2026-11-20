import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from './helpers/php.mjs';

test('dummy verification hash uses the current Argon2id policy without generating a new hash per request',()=>{
  const d=JSON.parse(run({},`require 'passwords.php';$hash=gym_password_dummy_hash();
   echo json_encode(['info'=>password_get_info($hash),'same'=>$hash===gym_password_dummy_hash(),
    'rehash'=>gym_password_needs_rehash($hash),'matches'=>gym_password_verify('gym-login-dummy-verification-not-an-account',$hash)]);`).body);
  assert.equal(d.info.algoName,'argon2id');assert.deepEqual(d.info.options,{memory_cost:19456,time_cost:2,threads:1});
  assert.equal(d.same,true);assert.equal(d.rehash,false);assert.equal(d.matches,true);
});

test('Argon2id uses independent salts and verifies passwords without trimming or 72-byte truncation', () => {
  const response = run({}, `
    require 'passwords.php';
    $password = '  rahsia-' . str_repeat('x', 100) . "\\u{1F512}";
    $first = gym_password_hash($password);
    $second = gym_password_hash($password);
    echo json_encode([
      'info' => password_get_info($first),
      'different' => $first !== $second,
      'correct' => gym_password_verify($password, $first),
      'wrongSuffix' => gym_password_verify(substr($password, 0, 80) . 'wrong', $first),
      'trimmed' => gym_password_verify(trim($password), $first),
      'rehash' => gym_password_needs_rehash($first),
      'malformed' => gym_password_verify($password, 'invalid-hash'),
      'legacyWrong' => gym_password_verify('wrong', md5($password)),
    ]);
  `);
  const data = JSON.parse(response.body);
  assert.equal(data.info.algoName, 'argon2id');
  assert.ok(data.info.options.memory_cost >= 19456);
  assert.ok(data.info.options.time_cost >= 2);
  assert.equal(data.different, true);
  assert.equal(data.correct, true);
  for (const key of ['wrongSuffix', 'trimmed', 'rehash', 'malformed', 'legacyWrong']) assert.equal(data[key], false);
});
