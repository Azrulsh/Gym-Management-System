import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const php = process.env.GYM_TEST_PHP || (process.platform === 'win32' ? 'C:/xampp/php/php.exe' : 'php');
export const literal = value => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

// In-memory sessions keep CLI tests independent of browser sessions and disk files.
export function run(session, code, { expectedStderr } = {}) {
  const source = `
    session_set_save_handler(
      function($path, $name) { return true; }, function() { return true; },
      function($id) { return ''; }, function($id, $data) { return true; },
      function($id) { return true; }, function($lifetime) { return 0; }
    );
    session_start();
    $_SESSION = json_decode(${literal(JSON.stringify(session))}, true);
    if (isset($_SESSION['login_id']) && !isset($_SESSION['login_auth_version'])) $_SESSION['login_auth_version'] = 1;
    // Isolate existing unit fixtures from the application DB while exercising the real session guard.
    // Integration tests replace auth_connection with their disposable database connection.
    $GLOBALS['auth_connection'] = new class {
      public function prepare($sql) { return new class {
        public function bind_param($types, &...$values) {}
        public function execute() { return true; }
        public function close() {}
        public function get_result() { return new class {
          public function fetch_assoc() { return isset($_SESSION['login_id']) ? [
            'id'=>$_SESSION['login_id'], 'type'=>$_SESSION['login_type'] ?? 0,
            'name'=>$_SESSION['login_name'] ?? '', 'username'=>$_SESSION['login_username'] ?? '',
            'auth_version'=>$_SESSION['login_auth_version'] ?? 1
          ] : null; }
        }; }
      }; }
    };
    require 'auth.php';
    register_shutdown_function(function() { echo "\\n__STATUS__" . (http_response_code() ?: 200); });
    ${code}
  `;
  const result = spawnSync(php, ['-r', source], { cwd: root, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  if (expectedStderr) assert.match(result.stderr, expectedStderr);
  else assert.equal(result.stderr, '');
  const match = result.stdout.match(/\n__STATUS__(\d+)$/);
  assert.ok(match, result.stdout);
  return { status: Number(match[1]), body: result.stdout.slice(0, match.index) };
}
