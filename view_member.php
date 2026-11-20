<?php
require_once __DIR__ . '/auth.php';
require_login();
require_once __DIR__ . '/membership_read.php';
$id = membership_read_id($_GET['id'] ?? null);
if ($id === false) { http_response_code(400); exit('<div class="alert alert-danger">Invalid member ID.</div>'); }
try {
    include 'db_connect.php';
    $statement = $conn->prepare("SELECT *, CONCAT_WS(', ', lastname, CONCAT_WS(' ', firstname, middlename)) AS name FROM members WHERE id = ?");
    if (!$statement) throw new RuntimeException('Member lookup unavailable.');
    $statement->bind_param('i', $id);
    if (!$statement->execute()) throw new RuntimeException('Member lookup unavailable.');
    $profile = $statement->get_result()->fetch_assoc();
    $statement->close();
    if (!$profile) { http_response_code(404); exit('<div class="alert alert-danger">Member no longer exists.</div>'); }
    $history = membership_read_records($conn, $id);
} catch (mysqli_sql_exception | RuntimeException $exception) {
    error_log('Unable to load member history.');
    http_response_code(503);
    exit('<div class="alert alert-danger">Unable to load member history. Please try again.</div>');
}
?>
<div class="container-fluid">
    <div class="row">
        <div class="col-md-4">
            <?php foreach (['name'=>'Name','gender'=>'Gender','email'=>'Email','contact'=>'Contact','address'=>'Address'] as $field=>$label): ?>
            <p><?php echo $label; ?>: <b><?php echo membership_read_escape($profile[$field] ?? ''); ?></b></p>
            <?php endforeach; ?>
        </div>
        <div class="col-md-8">
            <b>Membership History</b>
            <table class="table table-condensed">
                <thead><tr><th>Membership</th><th>Plan</th><th>Package</th><th>Start</th><th>End</th><th>Status</th></tr></thead>
                <tbody>
                <?php foreach ($history as $row): $state=membership_read_state($row); ?>
                    <tr>
                        <td>#<?php echo (int) $row['registration_id']; ?></td>
                        <td><?php echo membership_read_escape(membership_plan_label($row)); ?></td>
                        <td><?php echo $row['existing_package_id'] !== null ? membership_read_escape($row['package']) : 'Package missing (ID ' . (int) $row['package_id'] . ')'; ?></td>
                        <td><?php echo membership_read_escape($row['start_date']); ?></td>
                        <td><?php echo membership_read_escape($row['end_date']); ?></td>
                        <td><span class="badge badge-<?php echo $state['class']; ?>"><?php echo $state['label']; ?></span>
                            <?php if ($state['issues']): ?><ul class="small text-danger pl-3 mb-0"><?php foreach($state['issues'] as $issue): ?><li><?php echo membership_read_escape($issue); ?></li><?php endforeach; ?></ul><?php endif; ?>
                        </td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </div>
</div>
<div class="modal-footer display"><button class="btn btn-secondary" type="button" data-dismiss="modal">Close</button></div>
<style>#uni_modal .modal-footer{display:none}#uni_modal .modal-footer.display{display:flex}</style>
