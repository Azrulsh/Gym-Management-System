<?php
// PHP generates a fresh salt for every password. Options apply to new hashes and upgrades.
function gym_password_options(){
    return ['memory_cost' => 19456, 'time_cost' => 2, 'threads' => 1];
}

function gym_password_hash($password){
    return password_hash($password, PASSWORD_ARGON2ID, gym_password_options());
}

function gym_password_dummy_hash(){
    // Precomputed at the current Argon2id cost; no account uses this hash.
    // Regenerate alongside gym_password_options changes, never on each request.
    return '$argon2id$v=19$m=19456,t=2,p=1$Rjc4c01qam5PMXFpSGg1NQ$dO3O0xaWW+eOZtSBF3ShHVhEn4N0NUUwHu2/yamjtMg';
}

function gym_password_verify($password, $hash){
    // Compatibility only: never create a new MD5 password.
    if (preg_match('/\A[0-9a-f]{32}\z/i', $hash)) {
        return hash_equals(strtolower($hash), md5($password));
    }
    return password_verify($password, $hash);
}

function gym_password_needs_rehash($hash){
    return password_needs_rehash($hash, PASSWORD_ARGON2ID, gym_password_options());
}
