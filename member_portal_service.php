<?php
declare(strict_types=1);
require_once __DIR__ . '/member_portal_repository.php';
require_once __DIR__ . '/passwords.php';
require_once __DIR__ . '/login_throttle.php';
require_once __DIR__ . '/settings_images.php';

function member_avatar_storage(): SettingsImages
{
    return new SettingsImages(getenv('GYM_MEMBER_AVATAR_STORAGE') ?: dirname(__DIR__,2) . '/gym-storage/avatars');
}

final class MemberPortalService
{
    private DatabaseQueries $sql;
    private MemberPortalRepository $repository;
    public function __construct(private mysqli $db)
    {
        $this->sql=new DatabaseQueries($db);
        $this->repository=new MemberPortalRepository($db);
    }

    private function transaction(callable $work): array
    {
        $this->db->begin_transaction();
        try { $result=$work(); $this->db->commit(); return $result; }
        catch (Throwable $exception) { $this->db->rollback(); throw $exception; }
    }

    private function actor(int $id, int $version, int $role): array
    {
        $user=$this->sql->rows('SELECT * FROM users WHERE id=? FOR UPDATE','i',[$id])[0] ?? null;
        if (!$user || (int)$user['type']!==$role || (int)$user['auth_version']!==$version) throw new EventRequestException(403,'Your access changed. Sign in again.');
        return $user;
    }

    private function member(int $id): array
    {
        $member=$this->sql->rows('SELECT * FROM members WHERE id=? FOR UPDATE','i',[$id])[0] ?? null;
        if (!$member) throw new EventRequestException(404,'Member no longer exists.');
        return $member;
    }

    private function audit(?int $actorId, int $owner, string $action): void
    {
        $this->sql->execute('INSERT INTO member_portal_audit (actor_id,member_id,action) VALUES (?,?,?)','iis',[$actorId,$owner,$action]);
    }

    private function password(array $post): string
    {
        $password=$post['password'] ?? null;
        if (!is_string($password) || strlen($password)<12 || strlen($password)>128 || !preg_match('//u',$password)
            || !is_string($post['password_confirm'] ?? null) || !hash_equals($password,$post['password_confirm'])) {
            throw new EventRequestException(422,'Use a password of 12–128 bytes and enter the same confirmation. Spaces and passphrases are welcome.');
        }
        return gym_password_hash($password);
    }

    /** Admin-issued links expire after 24 hours; tokens are never stored in plaintext. */
    public function invite(array $post, int $actor, int $authVersion): array
    {
        $owner=event_positive_id($post['member_id'] ?? null,'member ID');
        $purpose=$post['purpose'] ?? 'activate';
        if (!in_array($purpose,['activate','reset'],true)) throw new EventRequestException(422,'Invalid invitation purpose.');
        $token=bin2hex(random_bytes(32)); $hash=hash('sha256',$token);
        return $this->transaction(function() use($owner,$purpose,$actor,$authVersion,$token,$hash) {
            $this->actor($actor,$authVersion,1); $this->member($owner);
            $account=$this->sql->rows('SELECT * FROM member_portal_accounts WHERE member_id=? FOR UPDATE','i',[$owner])[0] ?? null;
            if (($purpose==='activate' && $account) || ($purpose==='reset' && (!$account || !(int)$account['enabled']))) throw new EventRequestException(409,'Review the current account status before issuing this link.');
            $this->sql->execute('UPDATE member_portal_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE member_id=? AND used_at IS NULL AND revoked_at IS NULL','i',[$owner]);
            $this->sql->execute('INSERT INTO member_portal_tokens (member_id,purpose,token_hash,expires_at) VALUES (?,?,?,DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 24 HOUR))','iss',[$owner,$purpose,$hash]);
            $this->audit($actor,$owner,$purpose.'_link_issued');
            return ['saved'=>true,'activation_path'=>'activate_member.php#token='.$token,'message'=>'Copy this private link and deliver it only to the verified member. It expires in 24 hours.'];
        });
    }

    public function setAccess(array $post, int $actor, int $authVersion): array
    {
        $owner=event_positive_id($post['member_id'] ?? null,'member ID');
        $version=event_positive_id($post['version'] ?? null,'account version');
        $enabled=$post['enabled'] ?? null;
        if (!in_array($enabled,['0','1'],true)) throw new EventRequestException(422,'Invalid access status.');
        return $this->transaction(function() use($owner,$version,$enabled,$actor,$authVersion) {
            // Lock all accounts in ID order, matching existing Admin user-management writes.
            $this->sql->rows('SELECT id FROM users ORDER BY id FOR UPDATE');
            $this->actor($actor,$authVersion,1);
            $this->member($owner);
            $account=$this->sql->rows('SELECT * FROM member_portal_accounts WHERE member_id=? FOR UPDATE','i',[$owner])[0] ?? null;
            if (!$account) throw new EventRequestException(404,'Portal account does not exist.');
            $changed=$this->sql->execute('UPDATE users SET auth_version=auth_version+1,version=version+1 WHERE id=? AND type=3 AND version=?','ii',[(int)$account['user_id'],$version]);
            if ($changed!==1) throw new EventRequestException(409,'Account changed. Reload and review before trying again.');
            $this->sql->execute('UPDATE member_portal_accounts SET enabled=? WHERE user_id=?','ii',[(int)$enabled,(int)$account['user_id']]);
            $this->sql->execute('UPDATE member_portal_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE member_id=? AND used_at IS NULL AND revoked_at IS NULL','i',[$owner]);
            $this->audit($actor,$owner,$enabled==='1'?'access_enabled':'access_disabled');
            return ['saved'=>true];
        });
    }

    public function activate(array $post, string $ip): array
    {
        $token=$post['token'] ?? null;
        if (!is_string($token) || !preg_match('/\A[a-f0-9]{64}\z/',$token)) throw new EventRequestException(422,'This link is invalid or expired. Request a new link from the gym.');
        $hash=hash('sha256',$token);
        $throttle=new LoginThrottle($this->db,'portal-activation:');
        try {
            $retry=$throttle->begin('token:'.$hash,$ip);
            if ($retry>0) throw new EventRequestException(429,'Too many attempts. Retry in '.(int)ceil($retry/60).' min.');
            $link=$this->sql->rows('SELECT * FROM member_portal_tokens WHERE token_hash=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP','s',[$hash])[0] ?? null;
            $throttle->finish($link!==null);
        } finally { $throttle->cancel(); }
        if (!$link) throw new EventRequestException(422,'This link is invalid or expired. Request a new link from the gym.');
        $password=$this->password($post);
        $username=$post['username'] ?? '';
        if ($link['purpose']==='activate' && (!is_string($username) || !preg_match('/\A[a-zA-Z0-9][a-zA-Z0-9_.@-]{2,99}\z/',$username))) throw new EventRequestException(422,'Choose a username of 3–100 letters, numbers, dots, underscores, @ or hyphens.');
        try {
            return $this->transaction(function() use($link,$hash,$username,$password) {
                // Account creation/recovery follows the same users-before-members lock order
                // as Admin account management and authenticated Member writes.
                $this->sql->rows('SELECT id FROM users ORDER BY id FOR UPDATE');
                $owner=(int)$link['member_id']; $member=$this->member($owner);
                $fresh=$this->sql->rows('SELECT * FROM member_portal_tokens WHERE token_hash=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP FOR UPDATE','s',[$hash])[0] ?? null;
                if (!$fresh) throw new EventRequestException(422,'This link is invalid or expired. Request a new link from the gym.');
                $account=$this->sql->rows('SELECT * FROM member_portal_accounts WHERE member_id=? FOR UPDATE','i',[$owner])[0] ?? null;
                if ($fresh['purpose']==='activate') {
                    if ($account) throw new EventRequestException(409,'Portal access already exists. Ask the gym for account recovery.');
                    $name=trim($member['firstname'].' '.$member['lastname']);
                    $this->sql->execute('INSERT INTO users (name,username,password,type) VALUES (?,?,?,3)','sss',[$name,$username,$password]);
                    $userId=(int)$this->db->insert_id;
                    $this->sql->execute('INSERT INTO member_portal_accounts (user_id,member_id) VALUES (?,?)','ii',[$userId,$owner]);
                } else {
                    if (!$account || !(int)$account['enabled']) throw new EventRequestException(409,'Portal access is unavailable. Contact the gym.');
                    $userId=(int)$account['user_id'];
                    $this->sql->execute('UPDATE users SET password=?,auth_version=auth_version+1,version=version+1 WHERE id=? AND type=3','si',[$password,$userId]);
                }
                $this->sql->execute('UPDATE member_portal_tokens SET used_at=CURRENT_TIMESTAMP WHERE id=?','i',[(int)$fresh['id']]);
                $this->sql->execute('UPDATE member_portal_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE member_id=? AND used_at IS NULL AND revoked_at IS NULL','i',[$owner]);
                $this->audit($userId,$owner,$fresh['purpose']==='activate'?'account_activated':'password_reset');
                return ['saved'=>true,'redirect'=>'login.php'];
            });
        } catch (mysqli_sql_exception $exception) {
            if ((int)$exception->getCode()===1062) throw new EventRequestException(409,'That username is unavailable or the account was already activated. Review and try again.');
            throw $exception;
        }
    }

    public function profile(array $post, array $files, int $actor, int $authVersion): array
    {
        $version=event_positive_id($post['version'] ?? null,'profile version');
        $contact=$post['contact'] ?? null; $address=$post['address'] ?? null;
        if (!is_string($contact) || !preg_match('/\A[+0-9() .-]{3,50}\z/',$contact)
            || !is_string($address) || !preg_match('//u',$address) || mb_strlen($address,'UTF-8')>1000 || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/',$address)) throw new EventRequestException(422,'Enter a valid contact number and address (maximum 1000 characters).');
        $remove=$post['remove_avatar'] ?? '0';
        if (!in_array($remove,['0','1'],true)) throw new EventRequestException(422,'Invalid avatar removal option.');
        $upload=$files['avatar'] ?? ['error'=>UPLOAD_ERR_NO_FILE];
        if (!is_array($upload) || ($remove==='1' && ($upload['error'] ?? null)!==UPLOAD_ERR_NO_FILE)) throw new EventRequestException(422,'Choose an avatar or Remove, not both.');
        $images=member_avatar_storage(); $new=null; $committing=false; $old=null;
        try {
            $new=$images->store($upload,'avatar');
            $this->db->begin_transaction();
            $this->actor($actor,$authVersion,3);
            $account=$this->repository->account($actor,true);
            if (!$account || !(int)$account['enabled']) throw new EventRequestException(403,'Portal access changed. Sign in again.');
            $owner=(int)$account['profile_id'];
            $changed=$this->sql->execute('UPDATE members SET contact=?,address=?,version=version+1 WHERE id=? AND version=?','ssii',[trim($contact),trim($address),$owner,$version]);
            if ($changed!==1) throw new EventRequestException(409,'Profile changed. Reload before saving again.');
            $old=$account['avatar_filename']; $next=$remove==='1'?null:($new ?? $old);
            $this->sql->execute('UPDATE member_portal_accounts SET avatar_filename=? WHERE user_id=?','si',[$next,$actor]);
            $this->audit($actor,$owner,'profile_updated');
            $committing=true; $this->db->commit();
            if ($old!==$next) $images->remove($old);
            return ['saved'=>true];
        } catch (Throwable $exception) {
            $this->db->rollback();
            if (!$committing && $new!==null) $images->remove($new);
            throw $exception;
        }
    }

    public function changePassword(array $post, int $actor, int $authVersion, string $ip): array
    {
        $current=$post['current_password'] ?? null;
        if (!is_string($current) || $current==='' || strlen($current)>4096) throw new EventRequestException(422,'Enter your current password.');
        $account=$this->repository->account($actor);
        if (!$account || !(int)$account['enabled']) throw new EventRequestException(403,'Portal access changed.');
        $throttle=new LoginThrottle($this->db,'reauth:');
        try {
            $retry=$throttle->begin('id:'.$actor,$ip);
            if ($retry>0) throw new EventRequestException(429,'Too many password verification attempts. Retry in '.(int)ceil($retry/60).' min.');
            $valid=gym_password_verify($current,$account['password']); $throttle->finish($valid);
        } finally { $throttle->cancel(); }
        if (!$valid) throw new EventRequestException(422,'Current password is incorrect.');
        $new=$this->password($post);
        return $this->transaction(function() use($actor,$authVersion,$account,$new) {
            $this->actor($actor,$authVersion,3);
            $fresh=$this->repository->account($actor,true);
            if (!$fresh || !(int)$fresh['enabled'] || !hash_equals($account['password'],$fresh['password'])) throw new EventRequestException(409,'Account changed. Sign in again.');
            $this->sql->execute('UPDATE users SET password=?,auth_version=auth_version+1,version=version+1 WHERE id=?','si',[$new,$actor]);
            $this->sql->execute('UPDATE member_portal_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE member_id=? AND used_at IS NULL AND revoked_at IS NULL','i',[(int)$fresh['profile_id']]);
            $this->audit($actor,(int)$fresh['profile_id'],'password_changed');
            return ['saved'=>true,'redirect'=>'login.php','logout'=>true];
        });
    }
}
