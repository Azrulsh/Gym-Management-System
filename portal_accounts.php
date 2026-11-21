<?php
require_once __DIR__ . '/auth.php';
require_admin();
require_once __DIR__ . '/member_portal_repository.php';
require_once __DIR__ . '/member_portal_ui.php';
try {
    include __DIR__.'/db_connect.php';
    $accounts=(new MemberPortalRepository($conn))->administration();
} catch (mysqli_sql_exception | RuntimeException $exception) {
    error_log('Portal accounts unavailable.'); http_response_code(503);
    echo '<div class="alert alert-danger">Unable to load Member Portal accounts. Please try again.</div>'; return;
} finally { if(isset($conn)) $conn->close(); }
?>
<div class="container-fluid py-3" id="member-portal">
    <h1 class="h4">Member Portal Accounts</h1>
    <p>Verify the member's identity before sharing an activation or recovery link. Issuing a new link revokes previous unused links. Links are private and expire in 24 hours.</p>
    <div data-portal-message role="alert" aria-live="polite"></div>
    <div class="card"><div class="card-body"><div class="table-responsive"><table class="table table-bordered"><thead><tr><th>Member</th><th>Username</th><th>Portal access</th><th>Actions</th></tr></thead><tbody>
        <?php foreach($accounts as $account): ?><tr>
            <td><?php echo event_escape($account['member_id'].' — '.$account['name']); ?></td><td><?php echo event_escape($account['username'] ?? 'Not activated'); ?></td><td><?php echo $account['user_id']===null ? 'Not activated' : ((int)$account['enabled'] ? 'Enabled' : 'Disabled'); ?></td>
            <td><?php if ($account['user_id']===null || (int)$account['enabled']): ?><form class="d-inline-block mb-1" method="post" action="ajax.php?action=portal_invite" data-portal-form data-confirm="Issue a new private link? Previous unused links will stop working.">
                <?php portal_csrf(); portal_hidden('member_id',$account['id']); portal_hidden('purpose',$account['user_id']===null?'activate':'reset'); ?>
                <button class="btn btn-sm btn-outline-primary" type="submit"><?php echo $account['user_id']===null?'Invite Member':'Issue Recovery Link'; ?></button>
            </form><?php endif; ?>
            <?php if ($account['user_id']!==null): ?><form class="d-inline-block mb-1" method="post" action="ajax.php?action=portal_access" data-portal-form data-confirm="Change portal access? Existing sessions and unused activation/recovery links will be revoked.">
                <?php portal_csrf(); portal_hidden('member_id',$account['id']); portal_hidden('version',$account['account_version']); portal_hidden('enabled',(int)$account['enabled']?'0':'1'); ?>
                <button class="btn btn-sm btn-outline-danger" type="submit"><?php echo (int)$account['enabled']?'Disable Access':'Enable Access'; ?></button>
            </form><?php endif; ?></td>
        </tr><?php endforeach; ?>
    </tbody></table></div></div></div>
</div><?php portal_script(); ?>
