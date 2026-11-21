<?php
require_once __DIR__ . '/auth.php';
require_login();
$page = $_GET['page'] ?? 'home';
$pages = ['home', 'attendance', 'manage_attendance', 'members', 'registered_members', 'schedule', 'plans', 'packages', 'trainer', 'users', 'settings', 'portal_accounts', 'events', 'manage_event', 'view_event'];
if (in_array($page, ['plans', 'packages', 'trainer', 'users', 'settings', 'portal_accounts', 'manage_attendance', 'manage_event'], true)) {
    require_admin();
}
if (!is_string($page) || !in_array($page, $pages, true)) {
    http_response_code(404);
    exit('Page not found.');
}
// Included pages may report a read failure after the shell starts rendering.
// Keep headers pending so their HTTP status is sent with the final response.
ob_start();
require_once __DIR__ . '/settings_repository.php';
include 'db_connect.php';
$branding = system_settings_branding($conn);
?>
<!DOCTYPE html>
<html lang="en">
	
<head>
  <meta charset="utf-8">
  <meta content="width=device-width, initial-scale=1.0" name="viewport">

  <title><?php echo settings_escape($branding['gym_name']); ?></title>
 	

<?php
 include('./header.php'); 
 ?>

</head>
<style>
	body{
        background: #80808045;
  }
  .modal-dialog.large {
    width: 80% !important;
    max-width: unset;
  }
  .modal-dialog.mid-large {
    width: 50% !important;
    max-width: unset;
  }
  #viewer_modal .btn-close {
    position: absolute;
    z-index: 999999;
    /*right: -4.5em;*/
    background: unset;
    color: white;
    border: unset;
    font-size: 27px;
    top: 0;
}
#viewer_modal .modal-dialog {
        width: 80%;
    max-width: unset;
    height: calc(90%);
    max-height: unset;
}
  #viewer_modal .modal-content {
       background: black;
    border: unset;
    height: calc(100%);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  #viewer_modal img,#viewer_modal video{
    max-height: calc(100%);
    max-width: calc(100%);
  }

</style>

<body>
	<?php include 'topbar.php' ?>
	<?php include 'navbar.php' ?>
  <div class="toast" id="alert_toast" role="alert" aria-live="assertive" aria-atomic="true">
    <div class="toast-body text-white">
    </div>
  </div>
  <main id="view-panel" >
      <?php include __DIR__ . '/' . $page . '.php'; ?>
  	

  </main>

  <div id="preloader"></div>
  <a href="#" class="back-to-top"><i class="icofont-simple-up"></i></a>


  <div class="modal fade" id="uni_modal" role='dialog'>
    <div class="modal-dialog modal-md" role="document">
      <div class="modal-content">
        <div class="modal-header">
        <h5 class="modal-title"></h5>
      </div>
      <div class="modal-body">
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" id='submit' onclick="$('#uni_modal form').submit()">Save</button>
        <button type="button" class="btn btn-secondary" data-dismiss="modal">Cancel</button>
      </div>
      </div>
    </div>
  </div>
  <div class="modal fade" id="confirm_modal" role='dialog'>
    <div class="modal-dialog modal-md" role="document">
      <div class="modal-content">
        <div class="modal-header">
        <h5 class="modal-title">Confirmation</h5>
      </div>
      <div class="modal-body">
        <div id="delete_content"></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" id='confirm' onclick="">Continue</button>
        <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
      </div>
      </div>
    </div>
  </div>
  <div class="modal fade" id="viewer_modal" role='dialog'>
    <div class="modal-dialog modal-md" role="document">
      <div class="modal-content">
              <button type="button" class="btn-close" data-dismiss="modal"><span class="fa fa-times"></span></button>
              <img src="" alt="">
      </div>
    </div>
  </div>
</body>
<script>
  (function () {
    let pendingLoads = 0;
    let generation = 0;
    window.start_load = function () {
      pendingLoads++;
      generation++;
      const overlay = $('#preloader2');
      if (overlay.length) overlay.stop(true, false).show();
      else $('body').prepend('<div id="preloader2"></div>');
    };
    window.end_load = function () {
      if (pendingLoads === 0) return;
      pendingLoads--;
      if (pendingLoads > 0) return;
      const completedGeneration = generation;
      $('#preloader2').stop(true, false).fadeOut('fast', function () {
        // A new request may have restarted the overlay during this animation.
        if (pendingLoads === 0 && generation === completedGeneration) $(this).remove();
      });
    };
  })();
 window.viewer_modal = function($src = ''){
    start_load()
    var t = $src.split('.')
    t = t[1]
    if(t =='mp4'){
      var view = $("<video src='"+$src+"' controls autoplay></video>")
    }else{
      var view = $("<img src='"+$src+"' />")
    }
    $('#viewer_modal .modal-content video,#viewer_modal .modal-content img').remove()
    $('#viewer_modal .modal-content').append(view)
    $('#viewer_modal').modal({
            show:true,
            backdrop:'static',
            keyboard:false,
            focus:true
          })
          end_load()  

}
  window.uni_modal = (function(){
    let latestRequest = 0;
    let activeRequest = null;
    let pending = false;
    return function($title = '' , $url='',$size=""){
    const requestId = ++latestRequest;
    const previous = activeRequest;
    activeRequest = null;
    // Keep one loading overlay while replacing a pending read request.
    if (!pending) start_load();
    pending = true;
    if (previous && typeof previous.abort === 'function') previous.abort();
    let modalError = '';
    const request = $.ajax({
        url:$url,
        method:'GET',
        dataType:'html',
        timeout:15000,
        error:(err, status)=>{
            if (requestId !== latestRequest) return;
            if (err.status === 401 || err.status === 403) return;
            modalError = status === 'timeout'
                ? 'Loading details took too long. Please try again.'
                : 'Unable to load details. Please try again.';
        },
        success:function(resp){
            if (requestId !== latestRequest) return;
            if (typeof resp !== 'string' || !resp.trim()) {
                modalError = 'No details were returned. Please try again.';
                return;
            }
            try {
                $('#uni_modal .modal-title').text($title)
                $('#uni_modal .modal-body').html(resp)
                if (requestId !== latestRequest) return;
                // Each response owns its size; discard classes from the previous modal.
                $('#uni_modal .modal-dialog').removeAttr("class").addClass("modal-dialog modal-md")
                if($size != ''){
                    $('#uni_modal .modal-dialog').addClass($size)
                }
                $('#uni_modal').modal({
                  show:true,
                  backdrop:'static',
                  keyboard:false,
                  focus:true
                })
            } catch (error) {
                if (requestId !== latestRequest) return;
                $('#uni_modal .modal-body').empty();
                $('#uni_modal').modal('hide');
                modalError = 'Unable to display details. Please try again.';
            }
        },
        complete:function(){
            if (requestId !== latestRequest) return;
            pending = false;
            activeRequest = null;
            end_load();
            if (modalError) window.alert(modalError);
        }
    })
    // A synchronous callback or modal script may already have completed/replaced it.
    if (requestId === latestRequest && pending) activeRequest = request;
    };
})();
window._conf = function($msg='',$func='',$params = []){
     $('#confirm_modal #confirm').attr('onclick',$func+"("+$params.join(',')+")")
     $('#confirm_modal .modal-body').html($msg)
     $('#confirm_modal').modal('show')
  }
   window.alert_toast= function($msg = 'TEST',$bg = 'success'){
      $('#alert_toast').removeClass('bg-success')
      $('#alert_toast').removeClass('bg-danger')
      $('#alert_toast').removeClass('bg-info')
      $('#alert_toast').removeClass('bg-warning')

    if($bg == 'success')
      $('#alert_toast').addClass('bg-success')
    if($bg == 'danger')
      $('#alert_toast').addClass('bg-danger')
    if($bg == 'info')
      $('#alert_toast').addClass('bg-info')
    if($bg == 'warning')
      $('#alert_toast').addClass('bg-warning')
    $('#alert_toast .toast-body').html($msg)
    $('#alert_toast').toast({delay:3000}).toast('show');
  }
  $(document).ready(function(){
    $('#preloader').fadeOut('fast', function() {
        $(this).remove();
      })
  })
  $('.datetimepicker').datetimepicker({
      format:'Y/m/d H:i',
      startDate: '+3d'
  })
  $('.select2').select2({
    placeholder:"Please select here",
    width: "100%"
  })
</script>	
</html>
