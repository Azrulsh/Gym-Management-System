<?php
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/passwords.php';
require_once __DIR__ . '/login_throttle.php';
require_once __DIR__ . '/membership_dates.php';
ini_set('display_errors', 1);
Class Action {
	private $db;
	private $loginThrottle;

	public function __construct() {
		ob_start();
   	include 'db_connect.php';
    
    $this->db = $conn;
	}
	function __destruct() {
	    $this->db->close();
	    ob_end_flush();
	}

	function login(){
		require_post_request('Use POST to log in.');
		// A failed attempt must not retain authentication from a previous login.
		foreach (array_keys($_SESSION) as $key) {
			if (strpos((string) $key, 'login_') === 0) unset($_SESSION[$key]);
		}
		$username = $_POST['username'] ?? '';
		$password = $_POST['password'] ?? '';
		if (!is_string($username) || !is_string($password) || !preg_match('//u', $username)) {
			return $this->action_error(400, 'Enter a valid username and password.');
		}
		$username = trim($username);
		$length = function_exists('mb_strlen') ? mb_strlen($username, 'UTF-8') : strlen($username);
		if ($username === '' || $password === '' || $length > 200 || strlen($password) > 4096) {
			return $this->action_error(400, 'Enter a valid username and password.');
		}
		$throttle = $this->loginThrottle ?? new LoginThrottle($this->db);
		try {
			$statement = $this->db->prepare('SELECT id, name, username, type, password, auth_version FROM users WHERE username = ? LIMIT 1');
			if (!$statement) {
				return $this->action_error(503, 'Unable to log in right now. Please try again.');
			}
			$statement->bind_param('s', $username);
			if (!$statement->execute()) {
				$statement->close();
				return $this->action_error(503, 'Unable to log in right now. Please try again.');
			}
			$user = $statement->get_result()->fetch_assoc();
			$statement->close();
			// Existing account IDs respect the same username collation as MySQL.
			$account = $user ? 'id:' . $user['id'] : 'name:' . mb_strtolower($username, 'UTF-8');
			$retryAfter = $throttle->begin($account, $_SERVER['REMOTE_ADDR'] ?? 'unknown');
			if ($retryAfter > 0) {
				header('Retry-After: ' . $retryAfter);
				http_response_code(429);
				header('Content-Type: application/json; charset=utf-8');
				return json_encode(['error' => 'Too many login attempts. Retry in ' . (int) ceil($retryAfter / 60) . ' min.', 'retry_after' => $retryAfter]);
			}
			if (!$user || !gym_password_verify($password, (string) $user['password'])) {
				$throttle->finish(false);
				return 3;
			}
			$role = (int) $user['type'];
			if (!in_array($role, [1, 2], true)) {
				$throttle->finish(false);
				return 2;
			}
			if (gym_password_needs_rehash($user['password'])) {
				$hash = gym_password_hash($password);
				$id = (int) $user['id'];
				$oldHash = $user['password'];
				// Do not overwrite a password changed by another request in the meantime.
				$upgrade = $this->db->prepare('UPDATE users SET password = ? WHERE id = ? AND password = ?');
				if (!$upgrade) return $this->action_error(503, 'Unable to log in right now. Please try again.');
				$upgrade->bind_param('sis', $hash, $id, $oldHash);
				if (!$upgrade->execute()) {
					$upgrade->close();
					return $this->action_error(503, 'Unable to log in right now. Please try again.');
				}
				$changed = $upgrade->affected_rows;
				$upgrade->close();
				// A concurrent password change requires a fresh login attempt.
				if ($changed !== 1) {
					$throttle->finish(false);
					return 3;
				}
			}
			$throttle->finish(true);
			if (!session_regenerate_id(true)) {
				return $this->action_error(503, 'Unable to log in right now. Please try again.');
			}
			$_SESSION['login_id'] = (int) $user['id'];
			$_SESSION['login_name'] = (string) $user['name'];
			$_SESSION['login_username'] = (string) $user['username'];
			$_SESSION['login_type'] = $role;
			$_SESSION['login_auth_version'] = (int) $user['auth_version'];
			return 1;
		} catch (mysqli_sql_exception $exception) {
			error_log('Login database error (code ' . (int) $exception->getCode() . ').');
			return $this->action_error(503, 'Unable to log in right now. Please try again.');
		} catch (ValueError | RuntimeException $exception) {
			error_log('Login security check failed.');
			return $this->action_error(503, 'Unable to log in right now. Please try again.');
		} finally {
			$throttle->cancel();
		}
	}
	function login2(){
		
			extract($_POST);
			if(isset($email))
				$username = $email;
		$qry = $this->db->query("SELECT * FROM users where username = '".$username."' and password = '".md5($password)."' ");
		if($qry->num_rows > 0){
			foreach ($qry->fetch_array() as $key => $value) {
				if($key != 'passwors' && !is_numeric($key))
					$_SESSION['login_'.$key] = $value;
			}
			if($_SESSION['login_alumnus_id'] > 0){
				$bio = $this->db->query("SELECT * FROM alumnus_bio where id = ".$_SESSION['login_alumnus_id']);
				if($bio->num_rows > 0){
					foreach ($bio->fetch_array() as $key => $value) {
						if($key != 'passwors' && !is_numeric($key))
							$_SESSION['bio'][$key] = $value;
					}
				}
			}
			if($_SESSION['bio']['status'] != 1){
					foreach ($_SESSION as $key => $value) {
						unset($_SESSION[$key]);
					}
					return 2 ;
					exit;
				}
				return 1;
		}else{
			return 3;
		}
	}
	function logout(){
		require_action_access('logout');
		clear_login_session();
		header('Location: login.php', true, 303);
	}
	function logout2(){
		session_destroy();
		foreach ($_SESSION as $key => $value) {
			unset($_SESSION[$key]);
		}
		header("location:../index.php");
	}

	function save_user(){
		require_action_access('save_user');
		$id = $_POST['id'] ?? '';
		$id = $id === '' || $id === null ? 0 : filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 2147483647]]);
		if ($id === false) {
			return $this->action_error(400, 'Invalid user record ID.');
		}
		$name = $_POST['name'] ?? '';
		$username = $_POST['username'] ?? '';
		$password = $_POST['password'] ?? '';
		$type = $_POST['type'] ?? null;
		if (!is_string($name) || !is_string($username) || !is_string($password)
			|| !preg_match('//u', $name) || !preg_match('//u', $username)) {
			return $this->action_error(400, 'Invalid user details.');
		}
		$name = trim($name);
		$username = trim($username);
		if (!$this->valid_user_identity($name, $username)) {
			return $this->action_error(400, 'Name and username are required and must not exceed 200 characters.');
		}
		if ((!$id && $password === '') || strlen($password) > 4096) {
			return $this->action_error(400, 'A password is required for new users and must not exceed 4096 bytes.');
		}
		if (!in_array($type, [1, 2, '1', '2'], true)) {
			return $this->action_error(400, 'Choose Admin or Staff as the user type.');
		}
		$type = (int) $type;
		$transaction = false;
		try {
			if (!$this->db->begin_transaction()) throw new RuntimeException('Unable to start user save.');
			$transaction = true;
			$accounts = $this->db->query('SELECT id, type FROM users ORDER BY id FOR UPDATE')->fetch_all(MYSQLI_ASSOC);
			$adminCount = 0; $wasAdmin = false; $actorIsAdmin = false;
			foreach ($accounts as $account) {
				if ((int)$account['type'] === 1) $adminCount++;
				if ((int)$account['id'] === $id && (int)$account['type'] === 1) $wasAdmin = true;
				if ((int)$account['id'] === (int)$_SESSION['login_id'] && (int)$account['type'] === 1) $actorIsAdmin = true;
			}
			if (!$actorIsAdmin) return $this->action_error(403, 'Your account no longer has Admin access.');
			if ($wasAdmin && $type !== 1 && $adminCount <= 1) return $this->action_error(409, 'Cannot change the last Admin to Staff. Create or appoint another Admin first.');
			if ($id && !$this->user_record($id)) {
				return $this->action_error(404, 'User no longer exists. Refresh the page.');
			}
			if ($id === (int)$_SESSION['login_id'] && $password !== '') {
				$verification = $this->verify_current_password($id);
				if ($verification !== null) return $verification;
			}
			$check = $this->db->prepare('SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1');
			$check->bind_param('si', $username, $id);
			$check->execute();
			$duplicate = $check->get_result()->num_rows > 0;
			$check->close();
			if ($duplicate) {
				return $this->action_error(409, 'Username already exists.');
			}
			if (!$id) {
				$hash = gym_password_hash($password);
				$save = $this->db->prepare('INSERT INTO users (name, username, password, type) VALUES (?, ?, ?, ?)');
				$save->bind_param('sssi', $name, $username, $hash, $type);
			} elseif ($password === '') {
				$save = $this->db->prepare('UPDATE users SET name = ?, username = ?, type = ? WHERE id = ?');
				$save->bind_param('ssii', $name, $username, $type, $id);
			} else {
				$hash = gym_password_hash($password);
				$save = $this->db->prepare('UPDATE users SET name = ?, username = ?, password = ?, type = ?, auth_version = auth_version + 1 WHERE id = ?');
				$save->bind_param('sssii', $name, $username, $hash, $type, $id);
			}
			$executed = $save->execute();
			$changed = $save->affected_rows;
			$save->close();
			if (!$executed) {
				return $this->action_error(500, 'Unable to save user. Please try again.');
			}
			if ($id && $changed === 0 && !$this->user_record($id)) {
				return $this->action_error(404, 'User no longer exists. Refresh the page.');
			}
			if (!$this->db->commit()) throw new RuntimeException('Unable to commit user save.');
			$transaction = false;
			if ($id === (int) $_SESSION['login_id']) {
				$_SESSION['login_name'] = $name;
				$_SESSION['login_username'] = $username;
				$_SESSION['login_type'] = $type;
			}
			return 1;
		} catch (mysqli_sql_exception $exception) {
			if ((int) $exception->getCode() === 1062) {
				return $this->action_error(409, 'Username already exists.');
			}
			error_log('Unable to save user (database code ' . (int) $exception->getCode() . ').');
			return $this->action_error(500, 'Unable to save user. Please try again.');
		} catch (ValueError | RuntimeException $exception) {
			error_log('User password hashing failed.');
			return $this->action_error(500, 'Unable to save user. Please try again.');
		} finally { if ($transaction) $this->db->rollback(); }
	}
	private function valid_user_identity($name, $username){
		// UTF-8 code points, including when mbstring is unavailable. Passwords use byte limits separately.
		return preg_match('/\A.{1,200}\z/us', $name) === 1 && preg_match('/\A.{1,200}\z/us', $username) === 1;
	}
	private function user_record($id){
		$statement = $this->db->prepare('SELECT id FROM users WHERE id = ?');
		$statement->bind_param('i', $id);
		$statement->execute();
		$record = $statement->get_result()->fetch_assoc();
		$statement->close();
		return $record;
	}
	private function verify_current_password($id){
		$currentPassword = $_POST['current_password'] ?? null;
		if (!is_string($currentPassword) || $currentPassword === '' || strlen($currentPassword) > 4096) {
			return $this->action_error(400, 'Enter your current password to change your password.');
		}
		$verify = $this->db->prepare('SELECT password, auth_version FROM users WHERE id = ?');
		if (!$verify) throw new RuntimeException('Unable to verify current password.');
		try {
			$verify->bind_param('i', $id);
			if (!$verify->execute()) throw new RuntimeException('Unable to verify current password.');
			$account = $verify->get_result()->fetch_assoc();
		} finally { $verify->close(); }
		if (!$account || (int)$account['auth_version'] !== (int)$_SESSION['login_auth_version']) {
			return $this->action_error(409, 'Your account changed. Sign in again before changing your password.');
		}
		if (!gym_password_verify($currentPassword, $account['password'])) return $this->action_error(400, 'Current password is incorrect.');
		return null;
	}
	function save_account(){
		require_action_access('save_account');
		$name = $_POST['name'] ?? '';
		$username = $_POST['username'] ?? '';
		$password = $_POST['password'] ?? '';
		if (!is_string($name) || !is_string($username) || !is_string($password)
			|| !preg_match('//u', $name) || !preg_match('//u', $username)) {
			return 3;
		}
		$name = trim($name);
		$username = trim($username);
		if (!$this->valid_user_identity($name, $username) || strlen($password) > 4096) {
			return 3;
		}
		try {
			// The target comes from the session; role is never included in this update.
			$id = (int) $_SESSION['login_id'];
			if ($password !== '') {
				$verification = $this->verify_current_password($id);
				if ($verification !== null) return $verification;
			}
			$check = $this->db->prepare('SELECT id FROM users WHERE username = ? AND id != ?');
			if (!$check) return 3;
			$check->bind_param('si', $username, $id);
			if (!$check->execute()) {
				$check->close();
				return 3;
			}
			$duplicate = $check->get_result()->num_rows > 0;
			$check->close();
			if ($duplicate) return 2;
			if ($password === '') {
				$save = $this->db->prepare('UPDATE users SET name = ?, username = ? WHERE id = ?');
				if (!$save) return 3;
				$save->bind_param('ssi', $name, $username, $id);
			} else {
				$hash = gym_password_hash($password);
				$version = (int) $_SESSION['login_auth_version'];
				$save = $this->db->prepare('UPDATE users SET name = ?, username = ?, password = ?, auth_version = auth_version + 1 WHERE id = ? AND auth_version = ?');
				if (!$save) return 3;
				$save->bind_param('sssii', $name, $username, $hash, $id, $version);
			}
			$saved = $save->execute();
			$changed = $save->affected_rows;
			$save->close();
			if (!$saved) return 3;
			if ($password !== '') {
				// Do not adopt the version of a concurrent password reset.
				if ($changed !== 1) return $this->action_error(409, 'Your account changed. Sign in again before changing your password.');
				if (!session_regenerate_id(true)) { clear_login_session(); return 3; }
				$_SESSION['login_auth_version'] = $version + 1;
			}
			$_SESSION['login_name'] = $name;
			$_SESSION['login_username'] = $username;
			return 1;
		} catch (mysqli_sql_exception $exception) {
			if ((int)$exception->getCode() === 1062) return $this->action_error(409, 'Username already exists.');
			error_log('Unable to save account.');
			return 3;
		} catch (ValueError | RuntimeException $exception) {
			error_log('Unable to save account.');
			return 3;
		}
	}
	function delete_user(){
		require_action_access('delete_user');
		$id = $_POST['id'] ?? null;
		$id = is_string($id) || is_int($id) ? filter_var($id, FILTER_VALIDATE_INT, ['options'=>['min_range'=>1,'max_range'=>2147483647]]) : false;
		if ($id === false) return $this->action_error(400, 'Invalid user ID.');
		$transaction = false;
		try {
			if (!$this->db->begin_transaction()) throw new RuntimeException('Unable to start user deletion.');
			$transaction = true;
			// All role changes/deletions lock users in the same order to preserve the final Admin.
			$users = $this->db->query('SELECT id, type FROM users ORDER BY id FOR UPDATE')->fetch_all(MYSQLI_ASSOC);
			$target = null; $admins = 0; $actorIsAdmin = false;
			foreach ($users as $user) {
				if ((int)$user['type'] === 1) $admins++;
				if ((int)$user['id'] === $id) $target = $user;
				if ((int)$user['id'] === (int)$_SESSION['login_id'] && (int)$user['type'] === 1) $actorIsAdmin = true;
			}
			if (!$actorIsAdmin) return $this->action_error(403, 'Your account no longer has Admin access.');
			if (!$target) return $this->action_error(404, 'User no longer exists. Refresh the page.');
			if ((int)$target['type'] === 1 && $admins <= 1) return $this->action_error(409, 'Cannot delete the last Admin. Create or appoint another Admin first.');
			$self = $id === (int)$_SESSION['login_id'];
			if ($self) {
				$password = $_POST['password'] ?? null;
				$statement = $this->db->prepare('SELECT password FROM users WHERE id = ?');
				$statement->bind_param('i', $id); $statement->execute();
				$hash = $statement->get_result()->fetch_assoc()['password']; $statement->close();
				if (!is_string($password) || strlen($password) > 4096 || !gym_password_verify($password, $hash)) return $this->action_error(400, 'Enter your correct current password to delete your account.');
			}
			$statement = $this->db->prepare('DELETE FROM users WHERE id = ?');
			$statement->bind_param('i', $id); $statement->execute();
			$deleted = $statement->affected_rows; $statement->close();
			if ($deleted !== 1 || !$this->db->commit()) throw new RuntimeException('User deletion failed.');
			$transaction = false;
			if ($self) {
				clear_login_session();
				header('Content-Type: application/json; charset=utf-8');
				return json_encode(['deleted'=>true, 'self_deleted'=>true]);
			}
			return 1;
		} catch (mysqli_sql_exception | RuntimeException $exception) {
			error_log('Unable to delete user.');
			return $this->action_error(500, 'Unable to delete user. Please try again.');
		} finally { if ($transaction) $this->db->rollback(); }
	}
	function signup(){
		extract($_POST);
		$data = " name = '".$firstname.' '.$lastname."' ";
		$data .= ", username = '$email' ";
		$data .= ", password = '".md5($password)."' ";
		$chk = $this->db->query("SELECT * FROM users where username = '$email' ")->num_rows;
		if($chk > 0){
			return 2;
			exit;
		}
			$save = $this->db->query("INSERT INTO users set ".$data);
		if($save){
			$uid = $this->db->insert_id;
			$data = '';
			foreach($_POST as $k => $v){
				if($k =='password')
					continue;
				if(empty($data) && !is_numeric($k) )
					$data = " $k = '$v' ";
				else
					$data .= ", $k = '$v' ";
			}
			if($_FILES['img']['tmp_name'] != ''){
							$fname = strtotime(date('y-m-d H:i')).'_'.$_FILES['img']['name'];
							$move = move_uploaded_file($_FILES['img']['tmp_name'],'assets/uploads/'. $fname);
							$data .= ", avatar = '$fname' ";

			}
			$save_alumni = $this->db->query("INSERT INTO alumnus_bio set $data ");
			if($data){
				$aid = $this->db->insert_id;
				$this->db->query("UPDATE users set alumnus_id = $aid where id = $uid ");
				$login = $this->login2();
				if($login)
				return 1;
			}
		}
	}
	function update_account(){
		extract($_POST);
		$data = " name = '".$firstname.' '.$lastname."' ";
		$data .= ", username = '$email' ";
		if(!empty($password))
		$data .= ", password = '".md5($password)."' ";
		$chk = $this->db->query("SELECT * FROM users where username = '$email' and id != '{$_SESSION['login_id']}' ")->num_rows;
		if($chk > 0){
			return 2;
			exit;
		}
			$save = $this->db->query("UPDATE users set $data where id = '{$_SESSION['login_id']}' ");
		if($save){
			$data = '';
			foreach($_POST as $k => $v){
				if($k =='password')
					continue;
				if(empty($data) && !is_numeric($k) )
					$data = " $k = '$v' ";
				else
					$data .= ", $k = '$v' ";
			}
			if($_FILES['img']['tmp_name'] != ''){
							$fname = strtotime(date('y-m-d H:i')).'_'.$_FILES['img']['name'];
							$move = move_uploaded_file($_FILES['img']['tmp_name'],'assets/uploads/'. $fname);
							$data .= ", avatar = '$fname' ";

			}
			$save_alumni = $this->db->query("UPDATE alumnus_bio set $data where id = '{$_SESSION['bio']['id']}' ");
			if($data){
				foreach ($_SESSION as $key => $value) {
					unset($_SESSION[$key]);
				}
				$login = $this->login2();
				if($login)
				return 1;
			}
		}
	}

	/*
	 * Legacy Settings reference only; intentionally disabled.
	 * Before rebuilding: add a supported schema/UI, prepared statements, validation,
	 * POST/CSRF checks and safe image uploads. Do not simply uncomment this handler.
	function save_settings(){
		extract($_POST);
		$data = " name = '".str_replace("'","&#x2019;",$name)."' ";
		$data .= ", email = '$email' ";
		$data .= ", contact = '$contact' ";
		$data .= ", about_content = '".htmlentities(str_replace("'","&#x2019;",$about))."' ";
		if($_FILES['img']['tmp_name'] != ''){
			$fname = strtotime(date('y-m-d H:i')).'_'.$_FILES['img']['name'];
			$move = move_uploaded_file($_FILES['img']['tmp_name'],'assets/uploads/'. $fname);
			$data .= ", cover_img = '$fname' ";
		}
		$chk = $this->db->query("SELECT * FROM system_settings");
		if($chk->num_rows > 0){
			$save = $this->db->query("UPDATE system_settings set ".$data);
		}else{
			$save = $this->db->query("INSERT INTO system_settings set ".$data);
		}
		if($save){
			$query = $this->db->query("SELECT * FROM system_settings limit 1")->fetch_array();
			foreach ($query as $key => $value) {
				if(!is_numeric($key)) $_SESSION['settings'][$key] = $value;
			}
			return 1;
		}
	}
	*/
	function save_plan(){
		require_action_access('save_plan');
		$id = $_POST['id'] ?? '';
		if (!is_scalar($id) || is_bool($id)) return $this->action_error(400, 'Invalid plan record ID.');
		$id = $id === '' ? 0 : filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 2147483647]]);
		if ($id === false) return $this->action_error(400, 'Invalid plan record ID.');
		$months = $_POST['plan'] ?? null;
		if (!is_scalar($months) || is_bool($months)) return $this->action_error(400, 'Plan months must be a positive whole number.');
		$months = filter_var($months, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 2147483647]]);
		if ($months === false) return $this->action_error(400, 'Plan months must be a positive whole number.');
		$amount = $_POST['amount'] ?? '';
		if (!is_string($amount) || !preg_match('/\A[0-9]{1,10}(?:\.[0-9]{1,2})?\z/', $amount)) {
			return $this->action_error(400, 'Amount must be zero or greater, with up to two decimal places (maximum 9999999999.99).');
		}
		try {
			if ($id && !$this->plan_record($id)) return $this->action_error(404, 'Plan no longer exists. Refresh the page.');
			if ($id) {
				$version = $_POST['version'] ?? null;
				if (!is_string($version) || !ctype_digit($version)) return $this->action_error(400, 'Reopen Edit Plan before saving.');
				$version = filter_var($version, FILTER_VALIDATE_INT, ['options'=>['min_range'=>1,'max_range'=>2147483647]]);
				if ($version === false) return $this->action_error(400, 'Reopen Edit Plan before saving.');
				$save = $this->db->prepare('UPDATE plans SET plan = ?, amount = ?, version = version + 1 WHERE id = ? AND version = ?');
				if (!$save) return $this->action_error(500, 'Unable to save plan. Please try again.');
				$save->bind_param('isii', $months, $amount, $id, $version);
			} else {
				$save = $this->db->prepare('INSERT INTO plans (plan, amount) VALUES (?, ?)');
				if (!$save) return $this->action_error(500, 'Unable to save plan. Please try again.');
				$save->bind_param('is', $months, $amount);
			}
			$executed = $save->execute();
			$changed = $save->affected_rows;
			$save->close();
			if (!$executed) return $this->action_error(500, 'Unable to save plan. Please try again.');
			if ($id && $changed === 0 && !$this->plan_record($id)) return $this->action_error(404, 'Plan no longer exists. Refresh the page.');
			if ($id && $changed !== 1) return $this->action_error(409, 'Plan has changed. Refresh and review before saving.');
			return 1;
		} catch (mysqli_sql_exception | RuntimeException $exception) {
			error_log('Unable to save plan (error code ' . (int) $exception->getCode() . ').');
			return $this->action_error(500, 'Unable to save plan. Please try again.');
		}
	}
	private function plan_record($id){
		$statement = $this->db->prepare('SELECT id FROM plans WHERE id = ?');
		if (!$statement) throw new RuntimeException('Unable to read plan.');
		$statement->bind_param('i', $id);
		if (!$statement->execute()) {
			$statement->close();
			throw new RuntimeException('Unable to read plan.');
		}
		$record = $statement->get_result()->fetch_assoc();
		$statement->close();
		return $record;
	}
	function delete_plan(){
		return $this->delete_membership_resource('plan');
	}
	function save_package(){
		require_action_access('save_package');
		$id = $_POST['id'] ?? '';
		if (!is_scalar($id) || is_bool($id)) return $this->action_error(400, 'Invalid package record ID.');
		$id = $id === '' ? 0 : filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 2147483647]]);
		if ($id === false) return $this->action_error(400, 'Invalid package record ID.');
		$package = $_POST['package'] ?? '';
		$description = $_POST['description'] ?? '';
		if (!is_string($package) || !is_string($description) || !preg_match('//u', $package) || !preg_match('//u', $description)) {
			return $this->action_error(400, 'Invalid package details.');
		}
		$package = trim($package);
		$description = trim($description);
		$length = function_exists('mb_strlen') ? mb_strlen($package, 'UTF-8') : strlen($package);
		if ($package === '' || $length > 200) return $this->action_error(400, 'Package name is required and must not exceed 200 characters.');
		if (strlen($description) > 65535) return $this->action_error(400, 'Description is too long.');
		$amount = $_POST['amount'] ?? '';
		if (!is_string($amount) || !preg_match('/\A[0-9]{1,10}(?:\.[0-9]{1,2})?\z/', $amount)) {
			return $this->action_error(400, 'Amount must be zero or greater, with up to two decimal places (maximum 9999999999.99).');
		}
		try {
			if ($id && !$this->package_record($id)) return $this->action_error(404, 'Package no longer exists. Refresh the page.');
			if ($id) {
				$save = $this->db->prepare('UPDATE packages SET package = ?, description = ?, amount = ? WHERE id = ?');
				if (!$save) return $this->action_error(500, 'Unable to save package. Please try again.');
				$save->bind_param('sssi', $package, $description, $amount, $id);
			} else {
				$save = $this->db->prepare('INSERT INTO packages (package, description, amount) VALUES (?, ?, ?)');
				if (!$save) return $this->action_error(500, 'Unable to save package. Please try again.');
				$save->bind_param('sss', $package, $description, $amount);
			}
			$executed = $save->execute();
			$changed = $save->affected_rows;
			$save->close();
			if (!$executed) return $this->action_error(500, 'Unable to save package. Please try again.');
			if ($id && $changed === 0 && !$this->package_record($id)) return $this->action_error(404, 'Package no longer exists. Refresh the page.');
			return 1;
		} catch (mysqli_sql_exception | RuntimeException $exception) {
			error_log('Unable to save package (error code ' . (int) $exception->getCode() . ').');
			return $this->action_error(500, 'Unable to save package. Please try again.');
		}
	}
	private function package_record($id){
		$statement = $this->db->prepare('SELECT id FROM packages WHERE id = ?');
		if (!$statement) throw new RuntimeException('Unable to read package.');
		$statement->bind_param('i', $id);
		if (!$statement->execute()) {
			$statement->close();
			throw new RuntimeException('Unable to read package.');
		}
		$record = $statement->get_result()->fetch_assoc();
		$statement->close();
		return $record;
	}
	function delete_package(){
		return $this->delete_membership_resource('package');
	}
	function save_trainer(){
		require_action_access('save_trainer');
		$id = $_POST['id'] ?? '';
		if (!is_scalar($id) || is_bool($id)) return $this->action_error(400, 'Invalid trainer record ID.');
		$id = $id === '' ? 0 : filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 2147483647]]);
		if ($id === false) return $this->action_error(400, 'Invalid trainer record ID.');
		$fields = [];
		foreach (['name', 'email', 'contact'] as $field) {
			$value = $_POST[$field] ?? '';
			if (!is_string($value) || !preg_match('//u', $value)) return $this->action_error(400, 'Invalid trainer details.');
			$value = trim($value);
			$length = function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : strlen($value);
			if ($value === '' || $length > ($field === 'name' ? 200 : 100)) {
				return $this->action_error(400, 'Name, email and contact are required. Name must not exceed 200 characters; email and contact must not exceed 100.');
			}
			$fields[$field] = $value;
		}
		$name = $fields['name'];
		$email = $fields['email'];
		$contact = $fields['contact'];
		if (!filter_var($email, FILTER_VALIDATE_EMAIL)) return $this->action_error(400, 'Enter a valid email address.');
		if (!preg_match('/\A[+0-9(). -]+\z/', $contact) || !preg_match('/[0-9]/', $contact)) return $this->action_error(400, 'Enter a valid contact number.');
		$rate = $_POST['rate'] ?? '';
		if (!is_string($rate) || !preg_match('/\A[0-9]{1,10}(?:\.[0-9]{1,2})?\z/', $rate)) {
			return $this->action_error(400, 'Rate must be zero or greater, with up to two decimal places (maximum 9999999999.99).');
		}
		try {
			if ($id && !$this->trainer_record($id)) return $this->action_error(404, 'Trainer no longer exists. Refresh the page.');
			if ($id) {
				$save = $this->db->prepare('UPDATE trainers SET name = ?, email = ?, contact = ?, rate = ? WHERE id = ?');
				if (!$save) return $this->action_error(500, 'Unable to save trainer. Please try again.');
				$save->bind_param('ssssi', $name, $email, $contact, $rate, $id);
			} else {
				$save = $this->db->prepare('INSERT INTO trainers (name, email, contact, rate) VALUES (?, ?, ?, ?)');
				if (!$save) return $this->action_error(500, 'Unable to save trainer. Please try again.');
				$save->bind_param('ssss', $name, $email, $contact, $rate);
			}
			$executed = $save->execute();
			$changed = $save->affected_rows;
			$save->close();
			if (!$executed) return $this->action_error(500, 'Unable to save trainer. Please try again.');
			if ($id && $changed === 0 && !$this->trainer_record($id)) return $this->action_error(404, 'Trainer no longer exists. Refresh the page.');
			return 1;
		} catch (mysqli_sql_exception | RuntimeException $exception) {
			error_log('Unable to save trainer (error code ' . (int) $exception->getCode() . ').');
			return $this->action_error(500, 'Unable to save trainer. Please try again.');
		}
	}
	private function trainer_record($id){
		$statement = $this->db->prepare('SELECT id FROM trainers WHERE id = ?');
		if (!$statement) throw new RuntimeException('Unable to read trainer.');
		$statement->bind_param('i', $id);
		if (!$statement->execute()) {
			$statement->close();
			throw new RuntimeException('Unable to read trainer.');
		}
		$record = $statement->get_result()->fetch_assoc();
		$statement->close();
		return $record;
	}
	function delete_trainer(){
		return $this->delete_membership_resource('trainer');
	}
	private function delete_membership_resource($kind){
		// SQL identifiers come only from this internal allowlist.
		$resources = [
			'plan' => ['plans', 'plan_id'],
			'package' => ['packages', 'package_id'],
			'trainer' => ['trainers', 'trainer_id'],
			'member' => ['members', 'member_id'],
		];
		require_action_access('delete_' . $kind);
		[$table, $column] = $resources[$kind];
		$id = $_POST['id'] ?? null;
		if (!is_scalar($id) || is_bool($id)) return $this->action_error(400, 'Invalid ' . $kind . ' ID.');
		$id = filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 2147483647]]);
		if ($id === false) return $this->action_error(400, 'Invalid ' . $kind . ' ID.');
		$transaction = false;
		try {
			if (!$this->db->begin_transaction()) throw new RuntimeException('Unable to start deletion.');
			$transaction = true;
			// Creation/renewal hold a shared lock here; wait before checking committed references.
			$record = $this->membership_lookup('SELECT id FROM ' . $table . ' WHERE id = ? FOR UPDATE', $id);
			if (!$record) return $this->action_error(404, ucfirst($kind) . ' no longer exists. Refresh the page.');
			// A non-locking read avoids reversing the membership creation lock order.
			$reference = $this->membership_lookup('SELECT id FROM registration_info WHERE ' . $column . ' = ? LIMIT 1', $id);
			if ($reference) {
				$message = $kind === 'member'
					? 'Cannot delete this member because membership history exists, including closed memberships.'
					: 'Cannot delete this ' . $kind . ' because it is used by membership records, including closed memberships.';
				return $this->action_error(409, $message);
			}
			if ($kind === 'member' && $this->membership_lookup('SELECT id FROM schedules WHERE member_id = ? LIMIT 1', $id)) {
				return $this->action_error(409, 'Cannot delete this member because schedule records exist.');
			}
			$delete = $this->db->prepare('DELETE FROM ' . $table . ' WHERE id = ?');
			if (!$delete) throw new RuntimeException('Unable to prepare deletion.');
			$delete->bind_param('i', $id);
			$executed = $delete->execute();
			$changed = $delete->affected_rows;
			$delete->close();
			if (!$executed || $changed !== 1 || !$this->db->commit()) throw new RuntimeException('Unable to delete record.');
			$transaction = false;
			return 1;
		} catch (mysqli_sql_exception | RuntimeException $exception) {
			error_log('Unable to delete ' . $kind . ' (error code ' . (int) $exception->getCode() . ').');
			return $this->action_error(500, 'Unable to delete ' . $kind . '. Please try again.');
		} finally {
			if ($transaction) $this->db->rollback();
		}
	}
	function save_member(){
		require_action_access('save_member');
		$id = $_POST['id'] ?? '';
		$id = $id === '' || $id === null ? 0 : filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 2147483647]]);
		if ($id === false) {
			return $this->action_error(400, 'Invalid member record ID.');
		}
		$fields = [];
		foreach (['lastname', 'firstname', 'middlename', 'email', 'contact', 'gender', 'address'] as $field) {
			$value = $_POST[$field] ?? '';
			if (!is_string($value) || !preg_match('//u', $value)) {
				return $this->action_error(400, 'Invalid member details.');
			}
			$value = trim($value);
			$length = function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : strlen($value);
			if (($field === 'address' && strlen($value) > 65535) || ($field !== 'address' && $length > 100)) {
				return $this->action_error(400, 'Member details exceed the allowed length.');
			}
			$fields[$field] = $value;
		}
		foreach (['lastname', 'firstname', 'email', 'contact', 'gender'] as $field) {
			if ($fields[$field] === '') {
				return $this->action_error(400, 'Complete all required member details.');
			}
		}
		if (!filter_var($fields['email'], FILTER_VALIDATE_EMAIL) || !in_array($fields['gender'], ['Male', 'Female'], true)) {
			return $this->action_error(400, 'Enter a valid email address and gender.');
		}
		$number = $_POST['member_id'] ?? '';
		if (!is_string($number)) {
			return $this->action_error(400, 'Invalid member ID number.');
		}
		$number = trim($number);
		$memberNumber = $number === '' ? null : filter_var(ltrim($number, '0'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 2147483647]]);
		if ($memberNumber === false || ($number !== '' && !ctype_digit($number))) {
			return $this->action_error(400, 'Member ID number must be between 1 and 2147483647.');
		}
		try {
			$current = $id ? $this->member_record($id) : null;
			if ($id && !$current) {
				return $this->action_error(404, 'Member no longer exists. Refresh the page.');
			}
			if ($memberNumber === null && $current) {
				$memberNumber = (int) $current['member_id'];
			}
			$automatic = $memberNumber === null;
			for ($attempt = 0; $attempt < ($automatic ? 10 : 1); $attempt++) {
				if ($automatic) $memberNumber = random_int(10000000, 99999999);
				if ($this->member_number_exists($memberNumber, $id)) {
					if ($automatic) continue;
					return $this->action_error(409, 'ID No. already exists.');
				}
				// Profile saving never creates or modifies a membership registration.
				if ($id) {
					$statement = $this->db->prepare('UPDATE members SET member_id = ?, lastname = ?, firstname = ?, middlename = ?, email = ?, contact = ?, gender = ?, address = ? WHERE id = ?');
					$statement->bind_param('isssssssi', $memberNumber, $fields['lastname'], $fields['firstname'], $fields['middlename'], $fields['email'], $fields['contact'], $fields['gender'], $fields['address'], $id);
				} else {
					$statement = $this->db->prepare('INSERT INTO members (member_id, lastname, firstname, middlename, email, contact, gender, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
					$statement->bind_param('isssssss', $memberNumber, $fields['lastname'], $fields['firstname'], $fields['middlename'], $fields['email'], $fields['contact'], $fields['gender'], $fields['address']);
				}
				try {
					$executed = $statement->execute();
					$changed = $statement->affected_rows;
				} catch (mysqli_sql_exception $exception) {
					if ((int)$exception->getCode() !== 1062) throw $exception;
					if ($automatic) continue;
					return $this->action_error(409, 'ID No. already exists.');
				} finally { $statement->close(); }
				if (!$executed) return $this->action_error(500, 'Unable to save member. Please try again.');
				if ($id && $changed === 0 && !$this->member_record($id)) return $this->action_error(404, 'Member no longer exists. Refresh the page.');
				return 1;
			}
			return $this->action_error(503, 'Unable to generate a member ID number. Please try again.');
		} catch (mysqli_sql_exception $exception) {
			error_log('Unable to save member: ' . $exception->getMessage());
			return $this->action_error(500, 'Unable to save member. Please try again.');
		}
	}
	private function member_record($id){
		$statement = $this->db->prepare('SELECT id, member_id FROM members WHERE id = ?');
		$statement->bind_param('i', $id);
		$statement->execute();
		$record = $statement->get_result()->fetch_assoc();
		$statement->close();
		return $record;
	}
	private function member_number_exists($number, $excludeId){
		$statement = $this->db->prepare('SELECT id FROM members WHERE member_id = ? AND id <> ? LIMIT 1');
		$statement->bind_param('ii', $number, $excludeId);
		$statement->execute();
		$exists = $statement->get_result()->num_rows > 0;
		$statement->close();
		return $exists;
	}
	function delete_member(){
		return $this->delete_membership_resource('member');
	}
	function save_schedule(){
		require_action_access('save_schedule');
		$id = $_POST['id'] ?? '';
		$memberId = $_POST['member_id'] ?? null;
		if (!is_scalar($id) || is_bool($id) || !is_scalar($memberId) || is_bool($memberId)) return $this->action_error(400, 'Invalid schedule or member ID.');
		$id = $id === '' ? 0 : filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 2147483647]]);
		$memberId = filter_var($memberId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 2147483647]]);
		if ($id === false || $memberId === false) return $this->action_error(400, 'Invalid schedule or member ID.');
		foreach (['date_from', 'date_to', 'time_from', 'time_to'] as $field) {
			$value = $_POST[$field] ?? '';
			$pattern = strpos($field, 'date_') === 0 ? '/\A[1-9][0-9]{3}-(?:0[1-9]|1[0-2])\z/' : '/\A(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?\z/';
			if (!is_string($value) || !preg_match($pattern, $value)) return $this->action_error(400, 'Enter valid schedule months and times.');
		}
		$days = $_POST['dow'] ?? [];
		if (!is_array($days) || !$days) return $this->action_error(400, 'Choose at least one schedule day.');
		foreach ($days as $day) {
			if (!in_array($day, [0,1,2,3,4,5,6,'0','1','2','3','4','5','6'], true)) return $this->action_error(400, 'Choose valid schedule days.');
		}
		$dow = implode(',', array_unique($days));
		$dateFrom = $_POST['date_from'] . '-01';
		$dateTo = (new DateTimeImmutable($_POST['date_to'] . '-01'))->modify('last day of this month')->format('Y-m-d');
		$timeFrom = $_POST['time_from'];
		$timeTo = $_POST['time_to'];
		if ($dateTo < $dateFrom) return $this->action_error(400, 'Month To must be the same as or after Month From.');
		// Normalize optional seconds before comparing; sessions end on the same day.
		$timeFrom = strlen($timeFrom) === 5 ? $timeFrom . ':00' : $timeFrom;
		$timeTo = strlen($timeTo) === 5 ? $timeTo . ':00' : $timeTo;
		if ($timeTo <= $timeFrom) return $this->action_error(400, 'Time To must be after Time From on the same day.');
		$transaction = false;
		try {
			if (!$this->db->begin_transaction()) throw new RuntimeException('Unable to start schedule save.');
			$transaction = true;
			// Serialize all schedule saves for this member and coordinate with Delete Member.
			if (!$this->membership_lookup('SELECT id FROM members WHERE id = ? FOR UPDATE', $memberId)) {
				return $this->action_error(404, 'Member no longer exists. Refresh the page.');
			}
			if ($id && !$this->membership_lookup('SELECT id FROM schedules WHERE id = ? FOR UPDATE', $id)) return $this->action_error(404, 'Schedule no longer exists. Refresh the page.');
			$check = $this->db->prepare('SELECT id, dow, date_from, date_to, time_from, time_to FROM schedules WHERE member_id = ? AND id <> ? AND date_from <= ? AND date_to >= ? AND time_from < ? AND time_to > ? ORDER BY id');
			if (!$check) throw new RuntimeException('Unable to check schedule conflicts.');
			try {
				$check->bind_param('iissss', $memberId, $id, $dateTo, $dateFrom, $timeTo, $timeFrom);
				if (!$check->execute()) throw new RuntimeException('Unable to check schedule conflicts.');
				$existing = $check->get_result()->fetch_all(MYSQLI_ASSOC);
			} finally { $check->close(); }
			foreach ($existing as $other) {
				$sharedDays = array_intersect(explode(',', $dow), explode(',', $other['dow']));
				if (!$sharedDays) continue;
				$overlapStart = max($dateFrom, $other['date_from']);
				$overlapEnd = min($dateTo, $other['date_to']);
				$start = new DateTimeImmutable($overlapStart);
				$end = new DateTimeImmutable($overlapEnd);
				foreach ($sharedDays as $day) {
					// A common weekday must actually occur within the intersecting dates.
					$offset = ((int)$day - (int)$start->format('w') + 7) % 7;
					if ($start->modify('+' . $offset . ' days') <= $end) {
						return $this->action_error(409, 'This member already has an overlapping schedule (#' . (int)$other['id'] . ', ' . $other['time_from'] . ' - ' . $other['time_to'] . '). Choose another day or time.');
					}
				}
			}
			if ($id) {
				$save = $this->db->prepare('UPDATE schedules SET member_id = ?, date_from = ?, date_to = ?, time_from = ?, time_to = ?, dow = ? WHERE id = ?');
				if (!$save) throw new RuntimeException('Unable to prepare schedule save.');
				$save->bind_param('isssssi', $memberId, $dateFrom, $dateTo, $timeFrom, $timeTo, $dow, $id);
			} else {
				$save = $this->db->prepare('INSERT INTO schedules (member_id, date_from, date_to, time_from, time_to, dow) VALUES (?, ?, ?, ?, ?, ?)');
				if (!$save) throw new RuntimeException('Unable to prepare schedule save.');
				$save->bind_param('isssss', $memberId, $dateFrom, $dateTo, $timeFrom, $timeTo, $dow);
			}
			$executed = $save->execute();
			$save->close();
			if (!$executed || !$this->db->commit()) throw new RuntimeException('Unable to save schedule.');
			$transaction = false;
			return 1;
		} catch (mysqli_sql_exception | RuntimeException $exception) {
			error_log('Unable to save schedule (error code ' . (int) $exception->getCode() . ').');
			return $this->action_error(500, 'Unable to save schedule. Please try again.');
		} finally {
			if ($transaction) $this->db->rollback();
		}
	}
	function delete_schedule(){
		require_action_access('delete_schedule');
		$id = $_POST['id'] ?? null;
		$id = is_string($id) || is_int($id) ? filter_var($id, FILTER_VALIDATE_INT, ['options'=>['min_range'=>1,'max_range'=>2147483647]]) : false;
		if ($id === false) return $this->action_error(400, 'Invalid schedule ID.');
		try {
			$statement = $this->db->prepare('DELETE FROM schedules WHERE id = ?');
			if (!$statement) throw new RuntimeException('Unable to prepare schedule deletion.');
			try {
				$statement->bind_param('i', $id);
				if (!$statement->execute()) throw new RuntimeException('Unable to delete schedule.');
				$deleted = $statement->affected_rows;
			} finally { $statement->close(); }
			if ($deleted !== 1) return $this->action_error(404, 'Schedule no longer exists. Refresh the calendar.');
			return 1;
		} catch (mysqli_sql_exception | RuntimeException $exception) {
			error_log('Unable to delete schedule.');
			return $this->action_error(500, 'Unable to delete schedule. Please try again.');
		}
	}
	function get_schecdule(){
		require_action_access('get_schecdule');
		try {
			$qry = $this->db->query("SELECT s.*,concat(m.lastname,',',m.firstname,' ', m.middlename) as name FROM schedules s inner join members m on m.id = s.member_id");
			if (!$qry) throw new RuntimeException('Schedule lookup unavailable.');
			$data = $qry->fetch_all(MYSQLI_ASSOC);
			$qry->free();
			header('Content-Type: application/json; charset=utf-8');
			return json_encode($data, JSON_THROW_ON_ERROR);
		} catch (mysqli_sql_exception | RuntimeException | JsonException $exception) {
			error_log('Unable to load schedules.');
			return $this->action_error(503, 'Unable to load schedules. Please try again.');
		}
	}
	function save_payment(){
		require_action_access('save_payment');
		$requestKey = $_POST['request_key'] ?? null;
		if (!is_string($requestKey) || !preg_match('/\A[a-f0-9]{64}\z/', $requestKey)) return $this->action_error(400, 'Payment form has expired. Reopen payments and try again.');
		$id = $_POST['registration_id'] ?? null;
		if (!is_scalar($id) || is_bool($id)) return $this->action_error(400, 'Invalid membership ID.');
		$id = filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 2147483647]]);
		if ($id === false) return $this->action_error(400, 'Invalid membership ID.');
		$amount = $_POST['amount'] ?? '';
		if (!is_string($amount) || !preg_match('/\A[0-9]{1,10}(?:\.[0-9]{1,2})?\z/', $amount) || (float) $amount <= 0) {
			return $this->action_error(400, 'Amount must be greater than zero, with up to two decimal places (maximum 9999999999.99).');
		}
		$remarks = $_POST['remarks'] ?? '';
		if (!is_string($remarks) || !preg_match('//u', $remarks) || strlen($remarks) > 65535) return $this->action_error(400, 'Remarks must be valid text within the allowed length.');
		$remarks = trim($remarks);
		require_once __DIR__ . '/payment_read.php';
		$planAmount = array_key_exists('plan_amount', $_POST) ? $_POST['plan_amount'] : '0.00';
		$planCents = payment_cents($planAmount);
		if ($planCents === false || $planCents > payment_cents($amount)) return $this->action_error(400, 'Plan allocation must be between zero and the payment amount, with up to two decimal places.');
		$transaction = false;
		try {
			require_once __DIR__ . '/membership_read.php';
			if (!$this->db->begin_transaction()) throw new RuntimeException('Unable to start payment transaction.');
			$transaction = true;
			// Serialize payments for this membership before checking its remaining Plan fee.
			$locked = $this->membership_lookup('SELECT id FROM registration_info WHERE id = ? FOR UPDATE', $id);
			if (!$locked) return $this->action_error(404, 'Membership no longer exists. Refresh the page.');
			$existing = $this->payment_request_record($requestKey);
			if ($existing) return $this->payment_replay_result($existing, $id, $amount, $planAmount, $remarks);
			$records = membership_read_records($this->db, null, $id);
			if (!$records) return $this->action_error(404, 'Membership no longer exists. Refresh the page.');
			$membershipState = membership_read_state($records[0]);
			if (!$membershipState['can_pay']) return $this->action_error(409, 'Membership details need attention. Review Membership Validity before adding payments.');
			$remaining = payment_plan_balance($this->db, $id, $records[0]['pamount']);
			if ($planCents > $remaining) return $this->action_error(409, 'Plan allocation exceeds the remaining Plan fee. Refresh payments and check the balance.');
			// Allow only payment fields; membership must exist at the time of insertion.
			$save = $this->db->prepare('INSERT INTO payments (registration_id, amount, remarks, type, plan_amount, request_key) SELECT id, ?, ?, 2, ?, ? FROM registration_info WHERE id = ?');
			if (!$save) return $this->action_error(500, 'Unable to save payment. Please try again.');
			$save->bind_param('ssssi', $amount, $remarks, $planAmount, $requestKey, $id);
			$executed = $save->execute();
			$changed = $save->affected_rows;
			$save->close();
			if (!$executed) return $this->action_error(500, 'Unable to save payment. Please try again.');
			if ($changed !== 1) return $this->action_error(404, 'Membership no longer exists. Refresh the page.');
			if (!$this->db->commit()) throw new RuntimeException('Unable to commit payment.');
			$transaction = false;
			return 1;
		} catch (mysqli_sql_exception | RuntimeException $exception) {
			if ((int)$exception->getCode() === 1062) {
				// A request key raced on a different membership: check the committed winner.
				if ($transaction) { $this->db->rollback(); $transaction = false; }
				try {
					$existing = $this->payment_request_record($requestKey);
					if ($existing) return $this->payment_replay_result($existing, $id, $amount, $planAmount, $remarks);
				} catch (mysqli_sql_exception | RuntimeException $lookupError) {
					// Fail safely if the result cannot be confirmed; retry retains the same key.
				}
			}
			error_log('Unable to save payment (database code ' . (int) $exception->getCode() . ').');
			return $this->action_error(500, 'Unable to save payment. Please try again.');
		} finally {
			if ($transaction) $this->db->rollback();
		}
	}
	private function payment_request_record($key){
		$statement = $this->db->prepare('SELECT registration_id, amount, plan_amount, remarks FROM payments WHERE request_key = ?');
		if (!$statement) throw new RuntimeException('Payment request lookup unavailable.');
		$statement->bind_param('s', $key);
		if (!$statement->execute()) throw new RuntimeException('Payment request lookup unavailable.');
		$row = $statement->get_result()->fetch_assoc();
		$statement->close();
		return $row;
	}
	private function payment_replay_result($row, $id, $amount, $planAmount, $remarks){
		if ((int)$row['registration_id'] === $id && payment_cents((string)$row['amount']) === payment_cents($amount)
			&& payment_cents((string)$row['plan_amount']) === payment_cents($planAmount) && $row['remarks'] === $remarks) return 1;
		return $this->action_error(409, 'This payment request was already used with different details. Check payment history before starting a new payment.');
	}
	function renew_membership(){
		require_action_access('renew_membership');
		$rid = $_POST['rid'] ?? null;
		if (!is_scalar($rid) || is_bool($rid)) return $this->action_error(400, 'Invalid membership ID.');
		$rid = filter_var($rid, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 2147483647]]);
		if ($rid === false) return $this->action_error(400, 'Invalid membership ID.');
		$transaction = false;
		try {
			$source = $this->membership_lookup('SELECT member_id FROM registration_info WHERE id = ?', $rid);
			if (!$source) return $this->action_error(404, 'Membership no longer exists. Refresh the page.');
			if (!$this->db->begin_transaction()) throw new RuntimeException('Unable to start renewal.');
			$transaction = true;
			// Match New Membership lock order: member first, then membership records.
			$memberId = (int) $source['member_id'];
			if (!$this->membership_lookup('SELECT id FROM members WHERE id = ? FOR UPDATE', $memberId)) {
				return $this->action_error(404, 'Member no longer exists. Refresh the page.');
			}
            $previous = $this->membership_lookup('SELECT id, member_id, plan_id, package_id, trainer_id, status, start_date, end_date FROM registration_info WHERE id = ? FOR UPDATE', $rid);
			if (!$previous) return $this->action_error(404, 'Membership no longer exists. Refresh the page.');
			if ((int) $previous['member_id'] !== $memberId || (int) $previous['status'] !== 1) {
				return $this->action_error(409, 'Membership has already been renewed or ended. Refresh the page.');
			}
			$start = new DateTimeImmutable('today');
			$startDate = $start->format('Y-m-d');
			$oldEnd = DateTimeImmutable::createFromFormat('!Y-m-d', $previous['end_date']);
			$oldStart = DateTimeImmutable::createFromFormat('!Y-m-d', $previous['start_date']);
			if (!$oldStart || $oldStart->format('Y-m-d') !== $previous['start_date'] || $previous['start_date'] < '1000-01-01'
				|| !$oldEnd || $oldEnd->format('Y-m-d') !== $previous['end_date'] || $previous['end_date'] < $previous['start_date'] || $previous['end_date'] >= $startDate) {
				return $this->action_error(409, 'Only expired active memberships can be renewed.');
			}
			// The member lock already serializes creation/renewal; avoid locking unrelated history rows.
			$other = $this->db->prepare('SELECT id FROM registration_info WHERE member_id = ? AND status = 1 AND id <> ? LIMIT 1');
			if (!$other) throw new RuntimeException('Unable to check renewal.');
			$other->bind_param('ii', $memberId, $rid);
			if (!$other->execute()) {
				$other->close();
				throw new RuntimeException('Unable to check renewal.');
			}
			$conflict = $other->get_result()->fetch_assoc();
			$other->close();
			if ($conflict) return $this->action_error(409, 'This member has another active membership. Refresh the page.');
			$planId = (int) $previous['plan_id'];
			$packageId = (int) $previous['package_id'];
			$trainerId = (int) $previous['trainer_id'];
			$plan = $this->membership_lookup('SELECT plan, amount FROM plans WHERE id = ? LOCK IN SHARE MODE', $planId);
			$package = $this->membership_lookup('SELECT id, amount FROM packages WHERE id = ? LOCK IN SHARE MODE', $packageId);
			if (!$plan || !$package) {
				return $this->action_error(404, 'Plan or package no longer exists. Refresh the page.');
			}
			if ($trainerId < 0 || $trainerId > 127) return $this->action_error(400, 'Membership has an invalid trainer ID.');
			$trainer = $trainerId ? $this->membership_lookup('SELECT id, rate FROM trainers WHERE id = ? LOCK IN SHARE MODE', $trainerId) : ['rate'=>'0.00'];
			if (!$trainer) {
				return $this->action_error(404, 'Trainer no longer exists. Refresh the page.');
			}
			$fees = $this->membership_price_snapshot($plan, $package, $trainer);
			if ($fees === false) return $this->action_error(400, 'Selected plan, package or trainer has an invalid price.');
			$months = filter_var($plan['plan'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
			$maxMonths = (9999 - (int) $start->format('Y')) * 12 + 12 - (int) $start->format('n');
			if ($months === false || $months > $maxMonths) return $this->action_error(400, 'Selected plan has an invalid duration.');
			$endDate = membership_end_date($start, $months);
			if (strlen($endDate) !== 10) return $this->action_error(400, 'Selected plan has an invalid duration.');
			$close = $this->db->prepare('UPDATE registration_info SET status = 0 WHERE id = ? AND status = 1');
			if (!$close) throw new RuntimeException('Unable to end original membership.');
			$close->bind_param('i', $rid);
			if (!$close->execute() || $close->affected_rows !== 1) throw new RuntimeException('Unable to end original membership.');
			$close->close();
			$save = $this->db->prepare("INSERT INTO registration_info (member_id, plan_id, package_id, trainer_id, start_date, end_date, status, plan_fee, package_fee, trainer_fee_snapshot, price_source, prices_recorded_at, plan_months) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'captured', CURRENT_TIMESTAMP, ?)");
			if (!$save) throw new RuntimeException('Unable to prepare renewal.');
			$save->bind_param('iiiisssssi', $memberId, $planId, $packageId, $trainerId, $startDate, $endDate, $fees[0], $fees[1], $fees[2], $months);
			$executed = $save->execute();
			$newId = (int) $this->db->insert_id;
			$save->close();
			if (!$executed || $newId < 1 || !$this->db->commit()) throw new RuntimeException('Unable to save renewal.');
			$transaction = false;
			return $newId;
		} catch (mysqli_sql_exception | RuntimeException $exception) {
			error_log('Unable to renew membership (error code ' . (int) $exception->getCode() . ').');
			return $this->action_error(500, 'Unable to renew membership. Please try again.');
		} finally {
			if ($transaction) $this->db->rollback();
		}
	}
	function end_membership(){
		require_action_access('end_membership');
		$registrationId = filter_var($_POST['rid'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
		if ($registrationId === false) {
			return $this->action_error(400, 'Invalid membership ID.');
		}
		try {
			// A single conditional update also prevents duplicate requests reporting success.
			$statement = $this->db->prepare('UPDATE registration_info SET status = 0 WHERE id = ? AND status = 1');
			if (!$statement) {
				return $this->action_error(500, 'Unable to end membership. Please try again.');
			}
			$statement->bind_param('i', $registrationId);
			$executed = $statement->execute();
			$changed = $statement->affected_rows;
			$statement->close();
			if (!$executed) {
				return $this->action_error(500, 'Unable to end membership. Please try again.');
			}
			if ($changed !== 1) {
				return $this->action_error(409, 'Membership is already ended or no longer exists. Refresh the page.');
			}
			return 1;
		} catch (mysqli_sql_exception $exception) {
			error_log('Unable to end membership: ' . $exception->getMessage());
			return $this->action_error(500, 'Unable to end membership. Please try again.');
		}
	}
	private function action_error($status, $message){
		http_response_code($status);
		header('Content-Type: application/json; charset=utf-8');
		return json_encode(['error' => $message]);
	}
	
	function save_membership(){
		require_action_access('save_membership');
		$ids = [];
		foreach (['member_id', 'plan_id', 'package_id', 'trainer_id'] as $field) {
			$value = $_POST[$field] ?? '';
			if ($field === 'trainer_id' && ($value === '' || $value === '0' || $value === 0)) {
				$ids[$field] = 0;
				continue;
			}
			if (!is_scalar($value) || is_bool($value)) return $this->action_error(400, 'Choose valid member, plan, package and trainer records.');
			$value = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 2147483647]]);
			if ($value === false) return $this->action_error(400, 'Choose valid member, plan, package and trainer records.');
			$ids[$field] = $value;
		}
		// registration_info.trainer_id is currently a signed TINYINT, not an INT.
		if ($ids['trainer_id'] > 127) return $this->action_error(400, 'Selected trainer exceeds the supported ID range.');
		$transaction = false;
		try {
			if (!$this->db->begin_transaction()) throw new RuntimeException('Unable to start membership transaction.');
			$transaction = true;
			// All New Membership requests for the same member serialize on this row.
			$member = $this->membership_lookup('SELECT id FROM members WHERE id = ? FOR UPDATE', $ids['member_id']);
			if (!$member) return $this->action_error(404, 'Member no longer exists. Refresh the page.');
			$active = $this->membership_lookup('SELECT id FROM registration_info WHERE member_id = ? AND status = 1 LIMIT 1 FOR UPDATE', $ids['member_id']);
			if ($active) return $this->action_error(409, 'This member already has an active membership. Refresh the page before continuing.');
			$plan = $this->membership_lookup('SELECT plan, amount FROM plans WHERE id = ? LOCK IN SHARE MODE', $ids['plan_id']);
			$package = $this->membership_lookup('SELECT id, amount FROM packages WHERE id = ? LOCK IN SHARE MODE', $ids['package_id']);
			if (!$plan || !$package) return $this->action_error(404, 'Plan or package no longer exists. Refresh the page.');
			$trainer = $ids['trainer_id'] ? $this->membership_lookup('SELECT id, rate FROM trainers WHERE id = ? LOCK IN SHARE MODE', $ids['trainer_id']) : ['rate'=>'0.00'];
			if (!$trainer) {
				return $this->action_error(404, 'Trainer no longer exists. Refresh the page.');
			}
			$fees = $this->membership_price_snapshot($plan, $package, $trainer);
			if ($fees === false) return $this->action_error(400, 'Selected plan, package or trainer has an invalid price.');
			$start = new DateTimeImmutable('today');
			$months = filter_var($plan['plan'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
			$maxMonths = (9999 - (int) $start->format('Y')) * 12 + 12 - (int) $start->format('n');
			if ($months === false || $months > $maxMonths) return $this->action_error(400, 'Selected plan has an invalid duration.');
			$startDate = $start->format('Y-m-d');
			$endDate = membership_end_date($start, $months);
			if (strlen($endDate) !== 10) return $this->action_error(400, 'Selected plan has an invalid duration.');
			$save = $this->db->prepare("INSERT INTO registration_info (member_id, plan_id, package_id, trainer_id, start_date, end_date, status, plan_fee, package_fee, trainer_fee_snapshot, price_source, prices_recorded_at, plan_months) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'captured', CURRENT_TIMESTAMP, ?)");
			if (!$save) throw new RuntimeException('Unable to prepare membership.');
			$save->bind_param('iiiisssssi', $ids['member_id'], $ids['plan_id'], $ids['package_id'], $ids['trainer_id'], $startDate, $endDate, $fees[0], $fees[1], $fees[2], $months);
			$executed = $save->execute();
			$save->close();
			if (!$executed || !$this->db->commit()) throw new RuntimeException('Unable to save membership.');
			$transaction = false;
			return 1;
		} catch (mysqli_sql_exception | RuntimeException $exception) {
			error_log('Unable to save membership (error code ' . (int) $exception->getCode() . ').');
			return $this->action_error(500, 'Unable to save membership. Please try again.');
		} finally {
			if ($transaction) $this->db->rollback();
		}
	}
	private function membership_price_snapshot($plan, $package, $trainer){
		$fees = [(string)$plan['amount'], (string)$package['amount'], (string)$trainer['rate']];
		foreach ($fees as $fee) if (!preg_match('/\A[0-9]{1,10}(?:\.[0-9]{1,2})?\z/', $fee)) return false;
		return $fees;
	}
	private function membership_lookup($sql, $id){
		$statement = $this->db->prepare($sql);
		if (!$statement) throw new RuntimeException('Unable to look up membership records.');
		$statement->bind_param('i', $id);
		if (!$statement->execute()) {
			$statement->close();
			throw new RuntimeException('Unable to look up membership records.');
		}
		$record = $statement->get_result()->fetch_assoc();
		$statement->close();
		return $record;
	}
}
