<?php
require_once 'tests/helpers/throttle-db.php';

function with_membership_database($test)
{
    with_throttle_database(function($db, $schema) use ($test) {
        $db->query('CREATE TABLE members (id INT PRIMARY KEY) ENGINE=InnoDB');
        $db->query('INSERT INTO members VALUES (9), (10), (11)');
        $db->query('CREATE TABLE plans (id INT PRIMARY KEY, plan INT NOT NULL, amount DECIMAL(12,2) NOT NULL DEFAULT 100) ENGINE=InnoDB');
        $db->query('INSERT INTO plans (id,plan) VALUES (1, 3), (2, 0), (3, 2147483647)');
        $db->query(file_get_contents('database/migrations/011_plan_versions.sql'));
        $db->query('CREATE TABLE packages (id INT PRIMARY KEY, amount DECIMAL(12,2) NOT NULL DEFAULT 20) ENGINE=InnoDB');
        $db->query('INSERT INTO packages (id) VALUES (1)');
        $db->query('CREATE TABLE trainers (id INT PRIMARY KEY, rate DECIMAL(12,2) NOT NULL DEFAULT 10) ENGINE=InnoDB');
        $db->query('INSERT INTO trainers (id) VALUES (2), (200)');
        $db->multi_query(file_get_contents('database/migrations/012_package_trainer_versions.sql'));
        do { if ($result = $db->store_result()) $result->free(); } while ($db->more_results() && $db->next_result());
        $db->query("CREATE TABLE registration_info (id INT PRIMARY KEY AUTO_INCREMENT, member_id INT NOT NULL, plan_id INT NOT NULL, package_id INT NOT NULL, trainer_id TINYINT NOT NULL, start_date DATE NOT NULL, end_date DATE NOT NULL, status TINYINT NOT NULL DEFAULT 1, plan_fee DECIMAL(12,2) DEFAULT 100, package_fee DECIMAL(12,2) DEFAULT 20, trainer_fee_snapshot DECIMAL(12,2) DEFAULT 10, price_source VARCHAR(24) NOT NULL DEFAULT 'captured', prices_recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB");
        $db->query("INSERT INTO registration_info (id,member_id,plan_id,package_id,trainer_id,start_date,end_date,status) VALUES (8, 9, 1, 1, 0, '2025-01-01', '2025-04-01', 0), (9, 10, 1, 1, 2, '2026-01-01', '2026-04-01', 1)");
        $db->query('ALTER TABLE registration_info ADD COLUMN plan_months INT DEFAULT 3');
        $db->query('CREATE TABLE payments (id INT PRIMARY KEY, registration_id INT, amount DECIMAL(12,2)) ENGINE=InnoDB');
        $db->query('INSERT INTO payments VALUES (1, 8, 100), (2, 9, 200)');
        $test($db, $schema);
    });
}

function new_membership_for_test($db, $post, $method = 'save_membership')
{
    ob_start();
    $action = (new ReflectionClass('Action'))->newInstanceWithoutConstructor();
    $property = new ReflectionProperty('Action', 'db');
    $property->setAccessible(true);
    $property->setValue($action, $db);
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_POST = $post;
    if ($method === 'save_payment' && !array_key_exists('request_key', $_POST)) $_POST['request_key'] = bin2hex(random_bytes(32));
    http_response_code(200);
    try {
        $result = $action->{$method}();
        return ['status' => http_response_code() ?: 200, 'result' => $result];
    } finally {
        $property->setValue($action, new class { public function close() {} });
        unset($action);
    }
}

function membership_snapshot($db)
{
    return [
        'memberships' => $db->query('SELECT * FROM registration_info ORDER BY id')->fetch_all(MYSQLI_ASSOC),
        'payments' => $db->query('SELECT * FROM payments ORDER BY id')->fetch_all(MYSQLI_ASSOC),
    ];
}
