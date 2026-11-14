<?php

// Application dates use Malaysian time regardless of PHP/host defaults.
date_default_timezone_set('Asia/Kuala_Lumpur');

function configure_database_timezone($connection)
{
    // Numeric offset works without installing MySQL's named timezone tables.
    if (!$connection->query("SET SESSION time_zone = '+08:00'")) {
        throw new RuntimeException('Unable to configure database timezone.');
    }
}
