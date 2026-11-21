<?php
require_once __DIR__ . '/events_page.php';
require_admin();
$data = events_page_load(function(EventsRepository $repository) {
    $id = isset($_GET['id']) ? event_positive_id($_GET['id'],'event ID') : null;
    if ($id !== null) return ['event'=>$repository->find($id),'counts'=>$repository->counts($id)];
    return ['event'=>['id'=>'','version'=>'','title'=>'','description'=>'','location'=>'','starts_at'=>null,'ends_at'=>null,'registration_closes_at'=>null,'capacity'=>null,'status'=>'draft'],'counts'=>['history'=>0]];
});
if ($data === null) return;
$event=$data['event'];
$locked=in_array($event['status'],['cancelled','completed'],true);
$started=$event['status'] === 'published' && $event['starts_at'] <= date('Y-m-d H:i:s');
$readOnly=$locked || $started;
?>
<div class="container-fluid py-3" id="events-module">
    <h1 class="h4"><?php echo $event['id'] ? 'Edit Event' : 'New Event'; ?></h1>
    <p class="text-muted">All dates and times use Malaysia time (UTC+08:00). Description is plain text.</p>
    <div class="events-message" role="alert" aria-live="polite"></div>
    <?php if ($readOnly): ?><div class="alert alert-info">Event details are locked. <?php echo $locked ? 'You can review its history from View Event.' : 'You can cancel the event, or complete it after its scheduled end.'; ?></div><?php endif; ?>
    <form class="event-action-form" action="ajax.php?action=save_event" method="post" data-event-editor>
        <input type="hidden" name="csrf_token" value="<?php echo event_escape(csrf_token()); ?>"><input type="hidden" name="id" value="<?php echo (int)$event['id'] ?: ''; ?>"><input type="hidden" name="version" value="<?php echo (int)$event['version']; ?>"><input type="hidden" name="request_key" value="<?php echo bin2hex(random_bytes(32)); ?>">
        <div class="card"><div class="card-body">
            <?php foreach (['title'=>['Title',150],'location'=>['Location',250]] as $field=>[$label,$length]): ?>
                <div class="form-group"><label for="event-<?php echo $field; ?>"><?php echo $label; ?></label><input class="form-control" id="event-<?php echo $field; ?>" name="<?php echo $field; ?>" required maxlength="<?php echo $length; ?>" value="<?php echo event_escape($event[$field]); ?>" <?php if ($readOnly) echo 'readonly'; ?>></div>
            <?php endforeach; ?>
            <div class="form-group"><label for="event-description">Description</label><textarea id="event-description" name="description" class="form-control" rows="5" maxlength="5000" <?php if($readOnly) echo 'readonly'; ?>><?php echo event_escape($event['description']); ?></textarea></div>
            <div class="form-row"><?php foreach (['starts_at'=>'Starts','ends_at'=>'Ends','registration_closes_at'=>'Registration deadline (optional)'] as $field=>$label): ?>
                <div class="form-group col-md-4"><label for="event-<?php echo $field; ?>"><?php echo $label; ?></label><input class="form-control" id="event-<?php echo $field; ?>" name="<?php echo $field; ?>" type="datetime-local" value="<?php echo event_escape(event_datetime_input($event[$field])); ?>" <?php if ($field !== 'registration_closes_at') echo 'required'; ?> <?php if ($readOnly) echo 'readonly'; ?>></div>
            <?php endforeach; ?></div>
            <div class="form-group"><label for="event-capacity">Capacity (blank = unlimited)</label><input class="form-control col-md-4" type="number" id="event-capacity" name="capacity" min="1" max="2147483647" step="1" value="<?php echo event_escape($event['capacity'] ?? ''); ?>" <?php if ($readOnly) echo 'readonly'; ?>></div>
            <div class="form-group"><label for="event-status">Status</label><select id="event-status" name="status" class="form-control col-md-4" <?php if ($locked) echo 'disabled'; ?>>
                <?php
                $statuses=$locked ? [$event['status']] : ($event['id'] ? ($event['status']==='draft' ? ['draft','published','cancelled'] : ['published','cancelled']) : ['draft','published']);
                if (!$locked && $started && $event['ends_at'] <= date('Y-m-d H:i:s')) $statuses[]='completed';
                foreach ($statuses as $status): ?><option value="<?php echo $status; ?>" <?php if($event['status']===$status) echo 'selected'; ?>><?php echo ucfirst($status); ?></option><?php endforeach; ?>
            </select></div>
            <?php if (!$readOnly && (int)$data['counts']['history']>0): ?><div class="form-check mb-3"><input type="checkbox" class="form-check-input" id="confirm-event-change" name="confirm_changes" value="1"><label class="form-check-label" for="confirm-event-change">I confirm any time/location changes and will notify participants separately.</label></div><?php endif; ?>
            <p class="text-muted">Cancelling preserves participant history. Completed and Cancelled events stay locked.</p>
            <?php if (!$locked): ?><button class="btn btn-primary" type="submit"><?php echo $event['id'] ? 'Save Changes' : 'Create Event'; ?></button><?php endif; ?>
            <a class="btn btn-outline-secondary" href="index.php?page=<?php echo $event['id'] ? 'view_event&amp;id='.(int)$event['id'] : 'events'; ?>">Back</a>
        </div></div>
    </form>
</div>
<?php events_script(); ?>
