<?php
require_once __DIR__ . '/auth.php';
require_login();
include 'db_connect.php';
require_once __DIR__ . '/membership_read.php';
try {
    $memberships = membership_read_records($conn);
} catch (mysqli_sql_exception | RuntimeException $exception) {
    error_log('Unable to load membership list.');
    http_response_code(503);
    exit('<div class="alert alert-danger">Unable to load memberships. Please try again.</div>');
}
?>
<div class="container-fluid">
    <div class="card mt-4">
        <div class="card-header">
            <b>Membership Validity</b>
            <button class="btn btn-success btn-sm float-right" type="button" id="new_member">New Membership</button>
        </div>
        <div class="card-body">
            <p class="text-muted">All membership records are shown, including Closed records and records with missing details.
                Renew an expired membership with complete details, or End an open membership before choosing a different plan.</p>
            <table class="table table-bordered table-hover">
                <thead><tr><th>#</th><th>Member ID</th><th>Name</th><th>Plan</th><th>Package</th><th>Validity</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>
                <?php foreach ($memberships as $index => $row): $state = membership_read_state($row); ?>
                    <tr data-membership-id="<?php echo (int) $row['registration_id']; ?>">
                        <td><?php echo $index + 1; ?></td>
                        <td>
                            <?php echo $row['existing_member_id'] !== null ? membership_read_escape($row['member_number']) : 'Member profile missing'; ?>
                            <small class="d-block text-muted">Membership #<?php echo (int) $row['registration_id']; ?></small>
                        </td>
                        <td><?php echo $row['existing_member_id'] !== null ? membership_read_escape(ucwords($row['name'])) : 'Member profile missing'; ?></td>
                        <td><?php echo $row['existing_plan_id'] !== null ? (int) $row['plan'] . ' month(s)' : 'Plan missing (ID ' . (int) $row['plan_id'] . ')'; ?></td>
                        <td><?php echo $row['existing_package_id'] !== null ? membership_read_escape($row['package']) : 'Package missing (ID ' . (int) $row['package_id'] . ')'; ?></td>
                        <td><?php echo membership_read_escape($row['start_date']); ?><br><?php echo membership_read_escape($row['end_date']); ?></td>
                        <td>
                            <span class="badge badge-<?php echo $state['class']; ?>"><?php echo $state['label']; ?></span>
                            <?php if ($state['issues']): ?>
                                <ul class="small text-danger pl-3 mb-0">
                                    <?php foreach ($state['issues'] as $issue): ?><li><?php echo membership_read_escape($issue); ?></li><?php endforeach; ?>
                                </ul>
                            <?php endif; ?>
                        </td>
                        <td>
                            <button class="btn btn-sm btn-outline-success view_member" type="button" data-id="<?php echo (int) $row['registration_id']; ?>">View</button>
                            <?php if ((int) $row['status'] === 1): ?>
                            <button class="btn btn-sm btn-outline-danger end-membership" type="button" data-registration-id="<?php echo (int) $row['registration_id']; ?>" data-csrf-token="<?php echo membership_read_escape(csrf_token()); ?>">End Membership</button>
                            <?php endif; ?>
                        </td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </div>
</div>
<script>
    $(document).ready(function () { $('table').dataTable(); });
    $('#new_member').click(function () { uni_modal('New Membership Plan', 'manage_membership.php', ''); });
    $('.view_member').click(function () { uni_modal('Member Plan Details', 'view_pdetails.php?id=' + $(this).attr('data-id'), ''); });
</script>
