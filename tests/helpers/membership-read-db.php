<?php
require_once 'tests/helpers/membership-db.php';

function with_membership_read_database($test)
{
    with_membership_database(function($db, $schema) use ($test) {
        $db->query("ALTER TABLE members ADD member_id INT, ADD firstname VARCHAR(100) DEFAULT 'Test', ADD lastname VARCHAR(100) DEFAULT 'Member', ADD middlename VARCHAR(100) DEFAULT '', ADD gender VARCHAR(20) DEFAULT 'Male', ADD email VARCHAR(100) DEFAULT 'test@example.com', ADD contact VARCHAR(100) DEFAULT '0123456789', ADD address TEXT");
        $db->query('UPDATE members SET member_id = id + 10000');
        $db->query('ALTER TABLE plans ADD amount DECIMAL(12,2) NOT NULL DEFAULT 100');
        $db->query("ALTER TABLE packages ADD package VARCHAR(200) NOT NULL DEFAULT 'Test Package', ADD amount DECIMAL(12,2) NOT NULL DEFAULT 20");
        $db->query("ALTER TABLE trainers ADD name VARCHAR(200) NOT NULL DEFAULT 'Test Trainer', ADD rate DECIMAL(12,2) NOT NULL DEFAULT 10");
        $db->query("ALTER TABLE payments MODIFY id INT NOT NULL AUTO_INCREMENT, ADD remarks TEXT NOT NULL DEFAULT '', ADD type TINYINT NOT NULL DEFAULT 2, ADD date_created DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
        $test($db, $schema);
    });
}

function render_membership_read_page($db, $file, $get = [])
{
    $_GET = $get;
    $page = str_replace("include 'db_connect.php';", '$conn = $db;', file_get_contents($file));
    $page = str_replace('__DIR__', var_export(dirname(__DIR__, 2), true), $page);
    ob_start();
    eval('?>' . $page);
    return ob_get_clean();
}
