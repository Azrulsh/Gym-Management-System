<?php
// Only isolated test databases are created; never select the application database.
function throttle_test_connection($schema = '')
{
    return new mysqli(getenv('GYM_TEST_DB_HOST') ?: 'localhost', getenv('GYM_TEST_DB_USER') ?: 'root', getenv('GYM_TEST_DB_PASSWORD') ?: '', $schema);
}

function with_throttle_database($test)
{
    require_once 'admin_class.php';
    mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
    $schema = 'gym_throttle_test_' . bin2hex(random_bytes(8));
    $server = throttle_test_connection();
    $db = null;
    try {
        $server->query('CREATE DATABASE `' . $schema . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci');
        $db = throttle_test_connection($schema);
        $db->query(file_get_contents('database/migrations/001_login_throttle.sql'));
        $db->query('CREATE TABLE users (id INT PRIMARY KEY, name TEXT, username VARCHAR(200), password TEXT, type INT, auth_version INT UNSIGNED NOT NULL DEFAULT 1, UNIQUE KEY users_username_unique(username)) ENGINE=InnoDB');
        $insert = $db->prepare('INSERT INTO users (id,name,username,password,type) VALUES (?, ?, ?, ?, ?)');
        foreach ([[2, 'Admin', 'admin', md5('admin'), 1], [3, 'Staff', 'staff', gym_password_hash('staff'), 2]] as $row) {
            $insert->bind_param('isssi', ...$row);
            $insert->execute();
        }
        $insert->close();
        $test($db, $schema);
    } finally {
        if ($db) $db->close();
        if (!preg_match('/\Agym_throttle_test_[0-9a-f]{16}\z/', $schema)) throw new RuntimeException('Unsafe test database name');
        $server->query('DROP DATABASE IF EXISTS `' . $schema . '`');
        $server->close();
    }
}

function throttle_test_login($db, $username, $password, $ip = '192.0.2.1')
{
    ob_start();
    $action = (new ReflectionClass('Action'))->newInstanceWithoutConstructor();
    $property = new ReflectionProperty('Action', 'db');
    $property->setAccessible(true);
    $property->setValue($action, $db);
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_SERVER['REMOTE_ADDR'] = $ip;
    $_POST = compact('username', 'password');
    http_response_code(200);
    $result = $action->login();
    // The caller owns the connection, so avoid closing it in Action's destructor.
    $property->setValue($action, new class { public function close() {} });
    unset($action);
    return ['status' => http_response_code() ?: 200, 'result' => $result, 'authenticated' => isset($_SESSION['login_id'])];
}
