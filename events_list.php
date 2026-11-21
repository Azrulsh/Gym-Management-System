<?php
require_once __DIR__ . '/events_page.php';
require_login();
$data = events_page_load(fn(EventsRepository $repository) => ['events'=>$repository->listing()]);
if ($data === null) return;
?>
<div class="container-fluid py-3" id="events-module">
    <div class="d-flex flex-wrap justify-content-between align-items-center mb-3">
        <h1 class="h4">Events</h1>
        <?php if (is_admin()): ?><a class="btn btn-primary" href="index.php?page=manage_event">New Event</a><?php endif; ?>
    </div>
    <p class="text-muted">Gym activities and member participation. All times are Malaysia time (UTC+08:00).</p>
    <div class="events-message" role="alert" aria-live="polite"></div>
    <div class="form-group"><label for="event-filter">Filter status</label><select id="event-filter" class="form-control col-md-3"><option value="">All statuses</option><?php foreach (['Draft','Upcoming','Ongoing','Ended','Completed','Cancelled'] as $label): ?><option><?php echo $label; ?></option><?php endforeach; ?></select></div>
    <div class="card"><div class="card-body"><div class="table-responsive">
        <table class="table table-bordered table-hover" id="events-table">
            <thead><tr><th>Title</th><th>Starts (Malaysia)</th><th>Location</th><th>Status</th><th>Participants</th><th>Actions</th></tr></thead>
            <tbody><?php foreach ($data['events'] as $event): ?>
                <tr>
                    <td style="overflow-wrap:anywhere"><?php echo event_escape($event['title']); ?></td>
                    <td data-order="<?php echo event_escape($event['starts_at']); ?>"><?php echo event_escape(event_time_label($event['starts_at'])); ?></td>
                    <td><?php echo event_escape($event['location']); ?></td><td><?php echo event_phase($event); ?></td>
                    <td><?php echo (int)$event['occupied']; ?> / <?php echo $event['capacity'] === null ? 'Unlimited' : (int)$event['capacity']; ?></td>
                    <td><a class="btn btn-sm btn-outline-primary" href="index.php?page=view_event&amp;id=<?php echo (int)$event['id']; ?>">View</a>
                        <?php if (is_admin() && !in_array($event['status'],['cancelled','completed'],true)): ?><a class="btn btn-sm btn-outline-secondary" href="index.php?page=manage_event&amp;id=<?php echo (int)$event['id']; ?>">Edit</a><?php endif; ?>
                        <?php if (is_admin() && $event['status'] === 'draft'): ?><form class="d-inline event-action-form" action="ajax.php?action=delete_event" method="post" data-confirm="Delete this Draft? Drafts with participant history are protected.">
                            <input type="hidden" name="csrf_token" value="<?php echo event_escape(csrf_token()); ?>"><input type="hidden" name="id" value="<?php echo (int)$event['id']; ?>"><input type="hidden" name="version" value="<?php echo (int)$event['version']; ?>"><button class="btn btn-sm btn-outline-danger" type="submit">Delete</button>
                        </form><?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; ?></tbody>
        </table>
    </div></div></div>
</div>
<?php events_script(); ?>
