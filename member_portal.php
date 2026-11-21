<?php
require_once __DIR__ . '/member_portal_auth.php';
require_once __DIR__ . '/member_portal_ui.php';
require_once __DIR__ . '/membership_read.php';
require_once __DIR__ . '/payment_read.php';
require_once __DIR__ . '/settings_repository.php';
$account=require_member();
$page=$_GET['page'] ?? 'dashboard';
$pages=['dashboard'=>'Dashboard','profile'=>'My Profile','memberships'=>'My Memberships','payments'=>'My Payments','attendance'=>'My Attendance','schedule'=>'My Schedule','events'=>'Events','security'=>'Account & Security'];
if (!is_string($page) || !isset($pages[$page])) { http_response_code(404); exit('Page not found.'); }
try {
    include __DIR__.'/db_connect.php';
    $repository=new MemberPortalRepository($conn); $owner=(int)$account['profile_id'];
    $branding=system_settings_branding($conn);
    $memberships=in_array($page,['dashboard','memberships'],true)?$repository->memberships($owner):[];
    $payments=$page==='payments'?$repository->payments($owner):[];
    $schedules=in_array($page,['dashboard','schedule'],true)?$repository->schedules($owner):[];
    $attendance=$page==='attendance'?$repository->attendance($owner):[];
    $events=in_array($page,['dashboard','events'],true)?$repository->events($owner):[];
    $balances=[]; foreach($memberships as $row) $balances[$row['id']]=$row['pamount']===null?null:payment_plan_balance($conn,(int)$row['id'],$row['pamount']);
} catch (mysqli_sql_exception | RuntimeException $exception) {
    error_log('Member Portal read unavailable.'); http_response_code(503); exit('Unable to load your portal. Please try again.');
} finally { if(isset($conn)) $conn->close(); }
// Shared navigation performs fresh session checks; keep headers pending as index.php does.
ob_start();
?>
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title><?php echo event_escape($pages[$page].' ? '.$branding['gym_name']); ?></title>
<?php include __DIR__ . '/header.php'; ?>
<style>
body.member-portal-shell { background: #80808045; }
@media (max-width: 767px) {
    .member-portal-shell nav#sidebar { position: static; width: 100%; height: auto; padding-top: 3.5rem; }
    .member-portal-shell main#view-panel { margin-left: 0; margin-top: 0; width: 100%; }
}
</style></head>
<body class="member-portal-shell" id="member-portal">
<?php include __DIR__ . '/topbar.php'; include __DIR__ . '/navbar.php'; ?>
<main id="view-panel"><div class="container-fluid py-3 text-break">
    <div data-portal-message role="alert" aria-live="polite"></div>
    <h2 class="h5 mb-3"><?php echo event_escape($pages[$page]); ?></h2>
    <?php if($page==='dashboard'): ?>
        <div class="row"><div class="col-md-6 mb-3"><div class="card h-100"><div class="card-body"><h3 class="h6">Membership</h3>
            <?php $openMemberships=array_filter($memberships,fn($row)=>(int)$row['status']===1); ?>
            <?php if(!$openMemberships): ?><p>No open membership. Contact the gym to register or renew.</p><?php endif; ?>
            <?php foreach($openMemberships as $row): $state=membership_read_state($row); $balance=$balances[$row['id']]; ?><p><?php echo event_escape($state['label'].' · '.$row['start_date'].' to '.$row['end_date']); ?></p><p>Plan balance: <?php echo $balance===null?'Contact the gym':event_escape('RM'.payment_decimal($balance)); ?></p><?php endforeach; ?>
            <a href="member_portal.php?page=memberships">View agreements and Plan balance</a></div></div></div>
            <div class="col-md-6 mb-3"><div class="card h-100"><div class="card-body"><h3 class="h6">Your activities</h3><p><?php echo count(array_filter($schedules,fn($s)=>$s['date_to']>=date('Y-m-d'))); ?> current/future schedule records.</p><p><?php echo count(array_filter($events,fn($e)=>$e['participation']==='registered' && $e['status']==='published' && $e['ends_at']>date('Y-m-d H:i:s'))); ?> upcoming/ongoing event registrations.</p><a href="member_portal.php?page=schedule">My Schedule</a> · <a href="member_portal.php?page=events">Events</a></div></div></div></div>
        <p class="text-muted">An expired membership does not remove portal access. Contact the gym for renewal or payment assistance.</p>
    <?php elseif($page==='profile'): ?>
        <div class="card"><div class="card-body"><button type="button" class="media-viewer-trigger" data-media-viewer aria-label="View your avatar"><img src="member_avatar.php" width="96" height="96" alt="Your avatar" class="rounded"><span class="d-block small">View image</span></button>
            <p><strong><?php echo event_escape(trim($account['firstname'].' '.$account['middlename'].' '.$account['lastname'])); ?></strong><br><?php echo event_escape($account['email']); ?></p><p class="text-muted">Contact the gym to correct your name, member number or email. Portal access cannot be transferred to another profile.</p>
            <form method="post" action="ajax.php?action=portal_profile" enctype="multipart/form-data" data-portal-form>
                <?php portal_csrf(); portal_hidden('version',$account['version']); ?>
                <div class="form-group"><label for="profile-contact">Contact number</label><input class="form-control" id="profile-contact" name="contact" required maxlength="50" value="<?php echo event_escape($account['contact']); ?>"></div>
                <div class="form-group"><label for="profile-address">Address</label><textarea class="form-control" id="profile-address" name="address" maxlength="1000" rows="3"><?php echo event_escape($account['address']); ?></textarea></div>
                <div class="form-group"><label for="profile-avatar">Avatar (optional)</label><input class="form-control-file" id="profile-avatar" type="file" name="avatar" accept="image/jpeg,image/png" <?php if(!extension_loaded('gd'))echo 'disabled'; ?>><small class="form-text text-muted">JPEG/PNG, maximum 2 MB, 4096 pixels per side and 8 megapixels. <?php if(!extension_loaded('gd'))echo 'Image uploads require GD; contact the administrator.'; ?></small></div>
                <div class="form-check mb-3"><input class="form-check-input" id="remove-avatar" type="checkbox" name="remove_avatar" value="1"><label class="form-check-label" for="remove-avatar">Use default avatar</label></div>
                <button class="btn btn-primary" type="submit">Save Profile</button>
            </form></div></div>
    <?php elseif($page==='memberships'): ?>
        <?php if(!$memberships): ?><p>No membership records found.</p><?php endif; ?>
        <?php foreach($memberships as $row): $state=membership_read_state($row); $balance=$balances[$row['id']]; ?>
            <div class="card mb-3"><div class="card-body"><h3 class="h6">Agreement #<?php echo (int)$row['id']; ?> · <?php echo event_escape($state['label']); ?></h3><p><?php echo event_escape($row['start_date'].' to '.$row['end_date'].' · '.membership_plan_label($row)); ?></p><p>Plan fee RM<?php echo event_escape($row['pamount'] ?? 'Unavailable'); ?> · Package RM<?php echo event_escape($row['ppamount'] ?? 'Unavailable'); ?> · Trainer RM<?php echo event_escape($row['trainer_fee'] ?? 'Unavailable'); ?></p><p>Plan balance: <?php echo $balance===null?'Contact the gym':event_escape('RM'.payment_decimal($balance)); ?></p></div></div>
        <?php endforeach; ?>
    <?php elseif($page==='payments'): ?>
        <div class="table-responsive"><table class="table table-bordered bg-white"><thead><tr><th>Payment</th><th>Agreement</th><th>Date (Malaysia)</th><th>Paid</th><th>Plan allocation</th><th>Remarks</th></tr></thead><tbody>
            <?php foreach($payments as $payment): ?><tr><td>#<?php echo (int)$payment['id']; ?></td><td>#<?php echo (int)$payment['registration_id']; ?></td><td><?php echo event_escape($payment['date_created']); ?></td><td>RM<?php echo event_escape($payment['amount']); ?></td><td>RM<?php echo event_escape($payment['plan_amount']); ?></td><td><?php echo event_escape($payment['remarks']); ?></td></tr><?php endforeach; ?>
        </tbody></table></div><?php if(!$payments): ?><p>No payments recorded.</p><?php endif; ?>
    <?php elseif($page==='attendance'): ?>
        <p class="text-muted">Your latest 200 gym visits. All times are Malaysia time. Contact the gym to correct a record.</p>
        <div class="table-responsive"><table class="table table-bordered bg-white"><thead><tr><th>Visit</th><th>Check-in</th><th>Check-out</th><th>Status</th></tr></thead><tbody>
        <?php foreach($attendance as $visit): ?><tr><td>#<?php echo (int)$visit['id']; ?></td><td><?php echo event_escape($visit['checked_in_at']); ?></td><td><?php echo event_escape($visit['checked_out_at'] ?? '?'); ?></td><td><?php echo $visit['voided_at']!==null?'Voided':($visit['checked_out_at']===null?'Inside':'Checked out'); ?></td></tr><?php endforeach; ?>
        </tbody></table></div><?php if(!$attendance): ?><p>No gym visits recorded yet.</p><?php endif; ?>
    <?php elseif($page==='schedule'): ?>
        <p class="text-muted">All times are Malaysia time. Contact the gym to arrange or change a session.</p>
        <div class="table-responsive"><table class="table table-bordered bg-white"><thead><tr><th>Days</th><th>Date range</th><th>Time</th></tr></thead><tbody>
            <?php foreach($schedules as $schedule): $dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; $days=array_map(fn($d)=>$dayNames[(int)$d] ?? '?',explode(',',$schedule['dow'])); ?><tr><td><?php echo event_escape(implode(', ',$days)); ?></td><td><?php echo event_escape($schedule['date_from'].' to '.$schedule['date_to']); ?></td><td><?php echo event_escape($schedule['time_from'].' – '.$schedule['time_to']); ?></td></tr><?php endforeach; ?>
        </tbody></table></div><?php if(!$schedules): ?><p>No sessions scheduled.</p><?php endif; ?>
    <?php elseif($page==='events'): ?>
        <p>Register only for yourself. Membership must cover the event start date. All times are Malaysia time.</p>
        <?php if(!$events): ?><p>No published events yet.</p><?php endif; ?>
        <?php foreach($events as $event): $now=date('Y-m-d H:i:s'); $canRegister=$event['status']==='published' && $event['starts_at']>$now && ($event['registration_closes_at']===null || $event['registration_closes_at']>$now) && ($event['capacity']===null || (int)$event['occupied']<(int)$event['capacity']) && ($event['participation']===null || $event['participation']==='cancelled'); $canCancel=$event['status']==='published' && $event['ends_at']>$now && $event['participation']==='registered'; ?>
            <div class="card mb-3"><div class="card-body"><h3 class="h6"><?php echo event_escape($event['title']); ?> · <?php echo event_phase($event); ?></h3><p><?php echo event_escape($event['location'].' · '.$event['starts_at'].' to '.$event['ends_at']); ?></p><p class="text-break"><?php echo nl2br(event_escape($event['description'])); ?></p><p>Participants: <?php echo (int)$event['occupied']; ?> / <?php echo $event['capacity']===null?'Unlimited':(int)$event['capacity']; ?> · Your status: <?php echo event_escape($event['participation']===null?'Not registered':ucwords(str_replace('_',' ',$event['participation']))); ?></p>
                <?php if($canRegister || $canCancel): ?><form method="post" action="ajax.php?action=portal_event" data-portal-form <?php if($canCancel)echo 'data-confirm="Cancel your registration?"'; ?>><?php portal_csrf(); portal_hidden('id',$event['id']); portal_hidden('version',$event['version']); portal_hidden('participant_version',$event['participant_version'] ?? ''); portal_hidden('participant_status',$canCancel?'cancelled':'registered'); ?><button class="btn btn-sm <?php echo $canCancel?'btn-outline-danger':'btn-primary'; ?>" type="submit"><?php echo $canCancel?'Cancel Registration':'Register'; ?></button></form><?php endif; ?>
            </div></div>
        <?php endforeach; ?>
    <?php elseif($page==='security'): ?>
        <div class="card"><div class="card-body"><p>Username: <strong><?php echo event_escape($account['username']); ?></strong></p><p>Changing your password signs out all existing sessions. For account recovery, contact the gym to verify your identity and obtain a private recovery link.</p><form method="post" action="ajax.php?action=portal_password" data-portal-form><?php portal_csrf(); portal_password_fields(true); ?><button class="btn btn-primary" type="submit">Change Password</button></form></div></div>
    <?php endif; ?>
</div></main><?php portal_script(); ?><?php include __DIR__ . '/media_viewer.php'; ?></body></html>
