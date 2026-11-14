<?php
// Money calculations use integer cents; no rounding of payment allocations.
function payment_cents($amount)
{
    if (!is_string($amount) || !preg_match('/\A[0-9]{1,10}(?:\.[0-9]{1,2})?\z/', $amount)) return false;
    $parts = explode('.', $amount);
    return (int)$parts[0] * 100 + (int)str_pad($parts[1] ?? '', 2, '0');
}

function payment_decimal($cents)
{
    return intdiv($cents, 100) . '.' . str_pad((string)($cents % 100), 2, '0', STR_PAD_LEFT);
}

function payment_plan_balance($db, $registrationId, $planFee)
{
    $statement = $db->prepare('SELECT COALESCE(SUM(plan_amount), 0) AS plan_paid FROM payments WHERE registration_id = ?');
    if (!$statement) throw new RuntimeException('Unable to read payment allocations.');
    $statement->bind_param('i', $registrationId);
    if (!$statement->execute()) throw new RuntimeException('Unable to read payment allocations.');
    $paid = $statement->get_result()->fetch_assoc()['plan_paid'];
    $statement->close();
    return max(0, payment_cents((string)$planFee) - payment_cents((string)$paid));
}
