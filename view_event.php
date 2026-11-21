<?php
require_once __DIR__ . '/events_page.php';
require_login();
$data=events_page_load(function(EventsRepository $repository) {
    $id=event_positive_id($_GET['id'] ?? null,'event ID');
    return ['event'=>$repository->find($id),'participants'=>$repository->participants($id),
        'members'=>$repository->rows("SELECT id,member_id,CONCAT_WS(' ',firstname,middlename,lastname) AS name FROM members ORDER BY firstname,lastname,id")];
});
if ($data === null) return;
$event=$data['event']; $now=date('Y-m-d H:i:s');
$occupied=count(array_filter($data['participants'],fn($p)=>$p['status']!=='cancelled'));
$open=$event['status']==='published' && $now<$event['starts_at'] && ($event['registration_closes_at']===null || $now<$event['registration_closes_at']);
$full=$event['capacity']!==null && $occupied>=(int)$event['capacity'];
?>
<div class="container-fluid py-3" id="events-module">
    <div class="d-flex flex-wrap justify-content-between mb-3"><h1 class="h4" style="overflow-wrap:anywhere"><?php echo event_escape($event['title']); ?></h1><div><a class="btn btn-outline-secondary" href="index.php?page=events">Back to Events</a>
        <?php if (is_admin() && !in_array($event['status'],['cancelled','completed'],true)): ?><a class="btn btn-primary" href="index.php?page=manage_event&amp;id=<?php echo (int)$event['id']; ?>">Edit Event</a><?php endif; ?></div></div>
    <div class="events-message" role="alert" aria-live="polite"></div>
    <div class="card mb-3"><div class="card-body">
        <dl class="row"><dt class="col-md-3">Status</dt><dd class="col-md-9"><?php echo event_phase($event); ?></dd>
            <dt class="col-md-3">Location</dt><dd class="col-md-9" style="overflow-wrap:anywhere"><?php echo event_escape($event['location']); ?></dd>
            <dt class="col-md-3">Starts / Ends</dt><dd class="col-md-9"><?php echo event_escape(event_time_label($event['starts_at']).' — '.event_time_label($event['ends_at'])); ?> (Malaysia)</dd>
            <dt class="col-md-3">Registration deadline</dt><dd class="col-md-9"><?php echo $event['registration_closes_at']===null ? 'At event start' : event_escape(event_time_label($event['registration_closes_at'])); ?></dd>
            <dt class="col-md-3">Participants</dt><dd class="col-md-9"><?php echo $occupied; ?> / <?php echo $event['capacity']===null ? 'Unlimited' : (int)$event['capacity']; ?></dd></dl>
        <p style="white-space:pre-line;overflow-wrap:anywhere"><?php echo event_escape($event['description']); ?></p>
        <?php if($event['status']==='cancelled'): ?><div class="alert alert-warning">Event cancelled. Participation records are retained as history; no attendance or registration changes are allowed.</div><?php endif; ?>
    </div></div>
    <div class="card mb-3"><div class="card-header">Register a member</div><div class="card-body">
        <?php if ($open && !$full): ?>
            <p>Membership must be active on the event start date. No payment or membership changes are made here.</p>
            <form class="event-action-form form-inline" action="ajax.php?action=save_event_participant" method="post">
                <input type="hidden" name="csrf_token" value="<?php echo event_escape(csrf_token()); ?>"><input type="hidden" name="id" value="<?php echo (int)$event['id']; ?>"><input type="hidden" name="version" value="<?php echo (int)$event['version']; ?>"><input type="hidden" name="participant_status" value="registered">
                <label for="event-member" class="mr-2">Member</label><select id="event-member" name="member_id" class="form-control mr-2 mb-2" required><option value="">Select member</option>
                    <?php foreach($data['members'] as $member): $existing=null; foreach($data['participants'] as $p) if((int)$p['member_id']===(int)$member['id']) $existing=$p;
                        if ($existing && $existing['status']!=='cancelled') continue; ?>
                        <option value="<?php echo (int)$member['id']; ?>" data-version="<?php echo $existing ? (int)$existing['version'] : ''; ?>"><?php echo event_escape($member['member_id'].' — '.$member['name']); ?></option>
                    <?php endforeach; ?>
                </select><input type="hidden" name="participant_version" value=""><button class="btn btn-primary mb-2" type="submit">Register Member</button>
            </form>
        <?php else: ?><p class="mb-0"><?php echo $open && $full ? 'This event is full.' : 'Registration is closed for this event.'; ?></p><?php endif; ?>
    </div></div>
    <div class="card"><div class="card-header">Participants and attendance</div><div class="card-body"><div class="table-responsive">
        <table class="table table-bordered" id="event-participants"><thead><tr><th>Member</th><th>Status</th><th>Updated (Malaysia)</th><th>Action</th></tr></thead><tbody>
            <?php foreach($data['participants'] as $participant): ?>
                <tr><td><?php echo event_escape($participant['member_number'].' — '.$participant['member_name']); ?></td><td><?php echo event_escape(ucwords(str_replace('_',' ',$participant['status']))); ?></td><td><?php echo event_escape(event_time_label($participant['updated_at'])); ?></td><td>
                    <?php $choices=[];
                    if ($event['status']==='published' && $participant['status']==='registered' && $now<$event['ends_at']) $choices['cancelled']='Cancel registration';
                    if (in_array($event['status'],['published','completed'],true) && $participant['status']!=='cancelled' && $now>=$event['starts_at']) {
                        $choices['attended']='Attended'; if ($now>=$event['ends_at']) $choices['no_show']='No-show';
                    }
                    unset($choices[$participant['status']]);
                    $canCancel=isset($choices['cancelled']);
                    unset($choices['cancelled']);
                    $actionGroups=[];
                    if ($canCancel) $actionGroups['cancel']=['cancelled'=>'Cancel Registration'];
                    if ($choices) $actionGroups['attendance']=$choices;
                    if ($actionGroups): ?>
                        <div class="d-flex flex-wrap align-items-center">
                        <?php foreach ($actionGroups as $actionKind=>$options): ?>
                        <form class="event-action-form d-inline-flex flex-wrap align-items-center mr-2 mb-1" action="ajax.php?action=save_event_participant" method="post" data-confirm="<?php echo $actionKind==='cancel' ? 'Cancel this member&#039;s registration?' : 'Update this member&#039;s attendance?'; ?>">
                            <input type="hidden" name="csrf_token" value="<?php echo event_escape(csrf_token()); ?>"><input type="hidden" name="id" value="<?php echo (int)$event['id']; ?>"><input type="hidden" name="version" value="<?php echo (int)$event['version']; ?>"><input type="hidden" name="member_id" value="<?php echo (int)$participant['member_id']; ?>"><input type="hidden" name="participant_version" value="<?php echo (int)$participant['version']; ?>">
                            <?php if ($actionKind==='cancel'): ?>
                                <input type="hidden" name="participant_status" value="cancelled">
                                <button class="btn btn-sm btn-outline-danger" type="submit">Cancel Registration</button>
                            <?php else: ?>
                                <label class="sr-only" for="participant-<?php echo (int)$participant['id']; ?>">Attendance status</label>
                                <select class="form-control form-control-sm w-auto mr-2" name="participant_status" id="participant-<?php echo (int)$participant['id']; ?>"><?php foreach($options as $value=>$label): ?><option value="<?php echo $value; ?>"><?php echo $label; ?></option><?php endforeach; ?></select>
                                <button class="btn btn-sm btn-outline-primary" type="submit">Update</button>
                            <?php endif; ?>
                        </form>
                        <?php endforeach; ?>
                        </div>
                    <?php else: ?><span class="text-muted">No available action</span><?php endif; ?>
                </td></tr>
            <?php endforeach; ?>
        </tbody></table>
    </div></div></div>
</div>
<?php events_script(); ?>
