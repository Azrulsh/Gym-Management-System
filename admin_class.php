<?php
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/passwords.php';
require_once __DIR__ . '/login_throttle.php';
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
			$statement = $this->db->prepare('SELECT id, name, username, type, password FROM users WHERE username = ? LIMIT 1');
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
		session_destroy();
		foreach ($_SESSION as $key => $value) {
			unset($_SESSION[$key]);
		}
		header("location:login.php");
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
		$nameLength = function_exists('mb_strlen') ? mb_strlen($name, 'UTF-8') : strlen($name);
		$usernameLength = function_exists('mb_strlen') ? mb_strlen($username, 'UTF-8') : strlen($username);
		if ($name === '' || $username === '' || $nameLength > 200 || $usernameLength > 200) {
			return $this->action_error(400, 'Name and username are required and must not exceed 200 characters.');
		}
		if ((!$id && $password === '') || strlen($password) > 4096) {
			return $this->action_error(400, 'A password is required for new users and must not exceed 4096 bytes.');
		}
		if (!in_array($type, [1, 2, '1', '2'], true)) {
			return $this->action_error(400, 'Choose Admin or Staff as the user type.');
		}
		$type = (int) $type;
		try {
			if ($id && !$this->user_record($id)) {
				return $this->action_error(404, 'User no longer exists. Refresh the page.');
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
				$save = $this->db->prepare('UPDATE users SET name = ?, username = ?, password = ?, type = ? WHERE id = ?');
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
		}
	}
	private function user_record($id){
		$statement = $this->db->prepare('SELECT id FROM users WHERE id = ?');
		$statement->bind_param('i', $id);
		$statement->execute();
		$record = $statement->get_result()->fetch_assoc();
		$statement->close();
		return $record;
	}
	function save_account(){
		require_action_access('save_account');
		$name = $_POST['name'] ?? '';
		$username = $_POST['username'] ?? '';
		$password = $_POST['password'] ?? '';
		if (!is_string($name) || !is_string($username) || !is_string($password)) {
			return 3;
		}
		$name = trim($name);
		$username = trim($username);
		if ($name === '' || $username === '' || strlen($username) > 200 || strlen($password) > 4096) {
			return 3;
		}
		try {
			// The target comes from the session; role is never included in this update.
			$id = (int) $_SESSION['login_id'];
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
				$save = $this->db->prepare('UPDATE users SET name = ?, username = ?, password = ? WHERE id = ?');
				if (!$save) return 3;
				$save->bind_param('sssi', $name, $username, $hash, $id);
			}
			$saved = $save->execute();
			$save->close();
			if (!$saved) return 3;
			$_SESSION['login_name'] = $name;
			$_SESSION['login_username'] = $username;
			return 1;
		} catch (mysqli_sql_exception | ValueError | RuntimeException $exception) {
			error_log('Unable to save account.');
			return 3;
		}
	}
	function delete_user(){
		extract($_POST);
		$delete = $this->db->query("DELETE FROM users where id = ".$id);
		if($delete)
			return 1;
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
		
		// echo "INSERT INTO system_settings set ".$data;
		$chk = $this->db->query("SELECT * FROM system_settings");
		if($chk->num_rows > 0){
			$save = $this->db->query("UPDATE system_settings set ".$data);
		}else{
			$save = $this->db->query("INSERT INTO system_settings set ".$data);
		}
		if($save){
		$query = $this->db->query("SELECT * FROM system_settings limit 1")->fetch_array();
		foreach ($query as $key => $value) {
			if(!is_numeric($key))
				$_SESSION['settings'][$key] = $value;
		}

			return 1;
				}
	}

	
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
		if (!is_string($amount) || strlen($amount) > 32 || !preg_match('/\A[0-9]+(?:\.[0-9]{1,2})?\z/', $amount)) {
			return $this->action_error(400, 'Amount must be zero or greater, with up to two decimal places.');
		}
		try {
			if ($id && !$this->plan_record($id)) return $this->action_error(404, 'Plan no longer exists. Refresh the page.');
			if ($id) {
				$save = $this->db->prepare('UPDATE plans SET plan = ?, amount = ? WHERE id = ?');
				if (!$save) return $this->action_error(500, 'Unable to save plan. Please try again.');
				$save->bind_param('isi', $months, $amount, $id);
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
		extract($_POST);
		$delete = $this->db->query("DELETE FROM plans where id = ".$id);
		if($delete){
			return 1;
		}
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
		if (!is_string($amount) || strlen($amount) > 32 || !preg_match('/\A[0-9]+(?:\.[0-9]{1,2})?\z/', $amount)) {
			return $this->action_error(400, 'Amount must be zero or greater, with up to two decimal places.');
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
		extract($_POST);
		$delete = $this->db->query("DELETE FROM packages where id = ".$id);
		if($delete){
			return 1;
		}
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
		if (!is_string($rate) || strlen($rate) > 32 || !preg_match('/\A[0-9]+(?:\.[0-9]{1,2})?\z/', $rate)) {
			return $this->action_error(400, 'Rate must be zero or greater, with up to two decimal places.');
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
		extract($_POST);
		$delete = $this->db->query("DELETE FROM trainers where id = ".$id);
		if($delete){
			return 1;
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
			if ($memberNumber === null) {
				// Bound retries instead of looping indefinitely when generating a number.
				for ($attempt = 0; $attempt < 10; $attempt++) {
					$candidate = random_int(10000000, 99999999);
					if (!$this->member_number_exists($candidate, $id)) {
						$memberNumber = $candidate;
						break;
					}
				}
				if ($memberNumber === null) {
					return $this->action_error(503, 'Unable to generate a member ID number. Please try again.');
				}
			} elseif ($this->member_number_exists($memberNumber, $id)) {
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
			$executed = $statement->execute();
			$changed = $statement->affected_rows;
			$statement->close();
			if (!$executed) {
				return $this->action_error(500, 'Unable to save member. Please try again.');
			}
			if ($id && $changed === 0 && !$this->member_record($id)) {
				return $this->action_error(404, 'Member no longer exists. Refresh the page.');
			}
			return 1;
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
		extract($_POST);
		$delete = $this->db->query("DELETE FROM members where id = ".$id);
		if($delete){
			return 1;
		}
	}
	function save_schedule(){
		extract($_POST);
		$data = " member_id = '$member_id' ";
		$data .= ", date_from = '{$date_from}-1' ";
		$data .= ", date_to = '".(date("Y-m-d",strtotime($date_to.'-1 +1 month -1 day')))."' ";
		$data .= ", time_from = '$time_from' ";
		$data .= ", time_to = '$time_to' ";
		$data .= ", dow = '".(implode(",",$dow))."'";

		if(empty($id)){

			$save = $this->db->query("INSERT INTO schedules set ".$data);
		}else{
			$save = $this->db->query("UPDATE schedules set ".$data." where id=".$id);
		}
		if($save)
			return 1;
	}
	function delete_schedule(){
		extract($_POST);
		$delete = $this->db->query("DELETE FROM schedules where id = ".$id);
		if($delete){
			return 1;
		}
	}
	function get_schecdule(){
		extract($_POST);
		$data = array();
		$qry = $this->db->query("SELECT s.*,concat(m.lastname,',',m.firstname,' ', m.middlename) as name FROM schedules s inner join members m on m.id = s.member_id");
		while($row=$qry->fetch_assoc()){
			
			$data[] = $row;
		}
			return json_encode($data);
	}
	function save_payment(){
		extract($_POST);
		$data = '';
		foreach($_POST as $k=> $v){
			if(!empty($v)){
				if(empty($data))
				$data .= " $k='{$v}' ";
				else
				$data .= ", $k='{$v}' ";
			}
		}
			$save = $this->db->query("INSERT INTO payments set ".$data);
		if($save)
			return 1;
	}
	function renew_membership(){
		extract($_POST);
		$prev = $this->db->query("SELECT * FROM registration_info where id = $rid")->fetch_array();
		$data = '';
		foreach($prev as $k=> $v){
			if(!empty($v) && !is_numeric($k) && !in_array($k,array('id','start_date','end_date','date_created'))){
				if(empty($data))
				$data .= " $k='{$v}' ";
				else
				$data .= ", $k='{$v}' ";
				$$k=$v;
			}
		}
				$data .= ", start_date ='".date("Y-m-d")."' ";
				$plan = $this->db->query("SELECT * FROM plans where id = $plan_id")->fetch_array()['plan'];
				$data .= ", end_date ='".date("Y-m-d",strtotime(date('Y-m-d').' +'.$plan.' months'))."' ";
				$save = $this->db->query("INSERT INTO registration_info set $data");
				if($save){
					$id = $this->db->insert_id;
					$this->db->query("UPDATE registration_info set status = 0 where member_id = $member_id and id != $id ");
					return $id;
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
		extract($_POST);
		$data = '';
		foreach($_POST as $k=> $v){
		if(!empty($v)){
			if(empty($data))
			$data .= " $k='{$v}' ";
			else
			$data .= ", $k='{$v}' ";
			$$k=$v;
		}
	}
	$data .= ", start_date ='".date("Y-m-d")."' ";
	$plan = $this->db->query("SELECT * FROM plans where id = $plan_id")->fetch_array()['plan'];
	$data .= ", end_date ='".date("Y-m-d",strtotime(date('Y-m-d').' +'.$plan.' months'))."' ";
	$save = $this->db->query("INSERT INTO registration_info set $data");
	if($save){
		$id = $this->db->insert_id;
		$this->db->query("UPDATE registration_info set status = 0 where member_id = $member_id and id != $id ");
		return 1;
	}
	}
}
