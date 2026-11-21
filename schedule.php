<?php
require_once __DIR__ . '/auth.php';
require_login();
include 'db_connect.php';
?>
<div class="container-fluid">
	
	<div class="col-lg-12">
		<div class="row mb-4 mt-4">
			<div class="col-md-12">
				
			</div>
		</div>
		<div class="row">
			<div class="col-md-12">
				<div class="card">
					<div class="card-header">
						<b>Session Schedules</b>
						<span class="float:right"><button class="btn btn-success btn-block btn-sm col-sm-2 float-right"  id="new_schedule">
					<i class="fa fa-plus"></i> New Entry
				</button></span>
					</div>
					<div class="card-body">
						<hr>
						<div id="schedule-load-error" class="alert alert-danger d-none" role="alert">
							<span>Unable to load schedules. Please try again.</span>
							<button type="button" id="retry-schedules" class="btn btn-sm btn-outline-danger ml-2">Retry</button>
						</div>
						<p id="schedule-empty" class="text-muted d-none" role="status">No schedules found. Use New Entry to create a schedule.</p>
						<div id="calendar"></div>
					</div>
				</div>
			</div>
			<!-- Table Panel -->
		</div>
	</div>	

</div>
<style>
	
	td{
		vertical-align: middle !important;
	}
	td p{
		margin: unset
	}
	img{
		max-width:100px;
		max-height: :150px;
	}
	.avatar {
	    display: flex;
	    border-radius: 100%;
	    width: 100px;
	    height: 100px;
	    align-items: center;
	    justify-content: center;
	    border: 3px solid;
	    padding: 5px;
	}
	.avatar img {
	    max-width: calc(100%);
	    max-height: calc(100%);
	    border-radius: 100%;
	}
		input[type=checkbox]
{
  /* Double-sized Checkboxes */
  -ms-transform: scale(1.5); /* IE */
  -moz-transform: scale(1.5); /* FF */
  -webkit-transform: scale(1.5); /* Safari and Chrome */
  -o-transform: scale(1.5); /* Opera */
  transform: scale(1.5);
  padding: 10px;
}
a.fc-daygrid-event.fc-daygrid-dot-event.fc-event.fc-event-start.fc-event-end.fc-event-past {
    cursor: pointer;
}
a.fc-timegrid-event.fc-v-event.fc-event.fc-event-start.fc-event-end.fc-event-past {
    cursor: pointer;
}
</style>
<script>
	
	$('#new_schedule').click(function(){
		uni_modal('New Schedule','manage_schedule.php')
	})
    var calendarEl = document.getElementById('calendar');
    var calendar = null;
    var schedulesLoading = false;
    function loadSchedules() {
        if (schedulesLoading) return;
        schedulesLoading = true;
        $('#retry-schedules').prop('disabled', true);
        $('#schedule-load-error, #schedule-empty').addClass('d-none');
        start_load();
        $.ajax({
            url: 'ajax.php?action=get_schecdule',
            method: 'POST',
            dataType: 'json',
            timeout: 15000,
            success: function (rows) {
                try {
                    if (!Array.isArray(rows)) throw new Error('Invalid schedule response.');
                    var events = rows.map(function (row) {
                        if (!row || typeof row !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date_to)) throw new Error('Invalid schedule record.');
                        // Stored end date is inclusive; FullCalendar's recurrence end is exclusive.
                        var endRecur = new Date(row.date_to + 'T00:00:00Z');
                        endRecur.setUTCDate(endRecur.getUTCDate() + 1);
                        return { title: row.name, data_id: row.id, daysOfWeek: row.dow,
                            startRecur: row.date_from, endRecur: endRecur.toISOString().split('T')[0],
                            startTime: row.time_from, endTime: row.time_to };
                    });
                    if (calendar) calendar.destroy();
                    calendar = new FullCalendar.Calendar(calendarEl, {
                        headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listMonth' },
                        initialDate: '<?php echo date('Y-m-d') ?>',
                        weekNumbers: true, navLinks: true, editable: false, selectable: true,
                        nowIndicator: true, dayMaxEvents: true, events: events,
                        eventClick: function (event) {
                            uni_modal('Manage Schedule Details', 'manage_schedule.php?id=' + event.event.extendedProps.data_id);
                        }
                    });
                    calendar.render();
                    if (!rows.length) $('#schedule-empty').removeClass('d-none');
                } catch (error) {
                    if (calendar) {
                        try { calendar.destroy(); } catch (cleanupError) { /* Keep the error panel usable. */ }
                        calendar = null;
                    }
                    $('#calendar').empty();
                    $('#schedule-load-error').removeClass('d-none');
                }
            },
            error: function () {
                $('#schedule-load-error').removeClass('d-none');
            },
            complete: function () {
                schedulesLoading = false;
                $('#retry-schedules').prop('disabled', false);
                end_load();
            }
        });
    }
    $('#retry-schedules').click(loadSchedules);
    document.addEventListener('DOMContentLoaded', loadSchedules);
</script>
