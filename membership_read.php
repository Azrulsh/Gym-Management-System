<?php

// Read all history, including records whose related data was deleted previously.
function membership_read_records($db, $memberId = null, $registrationId = null)
{
    $sql = "SELECT r.*, r.id AS registration_id, m.id AS existing_member_id,
        m.member_id AS member_number, CONCAT_WS(', ', m.lastname, CONCAT_WS(' ', m.firstname, m.middlename)) AS name,
        p.id AS existing_plan_id, p.plan, r.plan_fee AS pamount,
        pp.id AS existing_package_id, pp.package, r.package_fee AS ppamount,
        t.id AS existing_trainer_id, t.name AS trainer_name, r.trainer_fee_snapshot AS trainer_fee,
        COALESCE(open_records.total, 0) AS open_count
        FROM registration_info r
        LEFT JOIN members m ON m.id = r.member_id
        LEFT JOIN plans p ON p.id = r.plan_id
        LEFT JOIN packages pp ON pp.id = r.package_id
        LEFT JOIN trainers t ON t.id = r.trainer_id
        LEFT JOIN (SELECT member_id, COUNT(*) AS total FROM registration_info WHERE status = 1 GROUP BY member_id) open_records
          ON open_records.member_id = r.member_id";
    if ($registrationId !== null) $sql .= ' WHERE r.id = ?';
    elseif ($memberId !== null) $sql .= ' WHERE r.member_id = ?';
    $sql .= ' ORDER BY r.id DESC';
    $statement = $db->prepare($sql);
    if (!$statement) throw new RuntimeException('Membership lookup unavailable.');
    if ($registrationId !== null) $statement->bind_param('i', $registrationId);
    elseif ($memberId !== null) $statement->bind_param('i', $memberId);
    if (!$statement->execute()) {
        $statement->close();
        throw new RuntimeException('Membership lookup unavailable.');
    }
    $rows = $statement->get_result()->fetch_all(MYSQLI_ASSOC);
    $statement->close();
    return $rows;
}

function membership_valid_date($date)
{
    if (!is_string($date)) return false;
    $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
    return $parsed && $parsed->format('Y-m-d') === $date && $date >= '1000-01-01';
}

function membership_read_state($row, $today = null)
{
    $today = $today ?? date('Y-m-d');
    $maxMonths = (9999 - (int) substr($today, 0, 4)) * 12 + 12 - (int) substr($today, 5, 2);
    $issues = [];
    if ($row['existing_member_id'] === null) $issues[] = 'Member profile missing (record ID ' . (int) $row['member_id'] . ').';
    if ($row['existing_plan_id'] === null) $issues[] = 'Plan missing (ID ' . (int) $row['plan_id'] . ').';
    elseif ((int) $row['plan'] < 1 || (int) $row['plan'] > $maxMonths) $issues[] = 'Plan duration is invalid.';
    if ($row['existing_package_id'] === null) $issues[] = 'Package missing (ID ' . (int) $row['package_id'] . ').';
    if ((int) $row['trainer_id'] < 0 || ((int) $row['trainer_id'] > 0 && $row['existing_trainer_id'] === null)) $issues[] = 'Trainer missing or invalid.';
    if (!membership_valid_date($row['start_date']) || !membership_valid_date($row['end_date']) || $row['end_date'] < $row['start_date']) $issues[] = 'Membership dates are invalid.';
    $open = (int) $row['status'] === 1;
    if ($open && (int) $row['open_count'] > 1) $issues[] = 'Multiple open memberships exist for this member. End the extra records before continuing.';
    $canRenew = $open && !$issues && $row['end_date'] < $today;
    if ($row['pamount'] === null || $row['ppamount'] === null || ((int)$row['trainer_id'] !== 0 && $row['trainer_fee'] === null)) $issues[] = 'Recorded membership prices are incomplete. Review the original agreement before adding payments.';
    if (!$open) $label = 'Closed';
    elseif ($issues) $label = 'Needs attention';
    elseif ($row['start_date'] > $today) $label = 'Scheduled';
    elseif ($row['end_date'] < $today) $label = 'Expired';
    else $label = 'Active';
    $classes = ['Closed' => 'secondary', 'Needs attention' => 'warning', 'Scheduled' => 'info', 'Expired' => 'danger', 'Active' => 'success'];
    return ['label' => $label, 'class' => $classes[$label], 'issues' => $issues,
        'can_renew' => $canRenew, 'can_pay' => !$issues];
}

function membership_read_summary($db, $rows)
{
    $active = [];
    $attention = 0;
    foreach ($rows as $row) {
        $state = membership_read_state($row);
        if ($state['label'] === 'Active') $active[(int) $row['member_id']] = true;
        if ($state['label'] === 'Needs attention') $attention++;
    }
    $result = $db->query('SELECT COUNT(*) AS total FROM members');
    if (!$result) throw new RuntimeException('Member count unavailable.');
    return ['active_members' => count($active), 'total_members' => (int) $result->fetch_assoc()['total'], 'needs_attention' => $attention];
}

function membership_read_id($value)
{
    if (!is_scalar($value) || is_bool($value)) return false;
    return filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 2147483647]]);
}

function membership_read_escape($value)
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
