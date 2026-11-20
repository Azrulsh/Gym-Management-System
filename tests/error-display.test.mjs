import assert from 'node:assert/strict';
import test from 'node:test';
import {run} from './helpers/php.mjs';

for (const enabled of [false, true]) {
  test(`loading Action preserves server error display ${enabled ? 'enabled' : 'disabled'}`, () => {
    const result = run({}, `
      ini_set('display_errors', '${enabled ? '1' : '0'}');
      ini_set('log_errors', '1');
      $before = ini_get('display_errors');
      ob_start();
      require 'admin_class.php';
      trigger_error('Controlled error display regression probe', E_USER_WARNING);
      $output = ob_get_clean();
      echo json_encode([
        'before' => $before,
        'after' => ini_get('display_errors'),
        'logging' => ini_get('log_errors'),
        'output' => $output
      ]);
    `, {expectedStderr: /Controlled error display regression probe/});
    const state = JSON.parse(result.body);
    assert.equal(state.after, state.before);
    assert.equal(state.logging, '1');
    if (enabled) assert.match(state.output, /Controlled error display regression probe/);
    else assert.equal(state.output, '');
  });
}
