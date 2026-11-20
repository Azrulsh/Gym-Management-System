// Older unit suites isolate credential/profile logic; throttle integration uses real MariaDB.
export const allowLoginThrottle = `
  $throttleProperty = new ReflectionProperty('Action', 'loginThrottle');
  $throttleProperty->setAccessible(true);
  $throttleProperty->setValue($action, new class {
    public function begin($account, $ip) { return 0; }
    public function finish($success) {}
    public function cancel() {}
  });
`;

export const allowCurrentPasswordThrottle = allowLoginThrottle.replaceAll('loginThrottle', 'currentPasswordThrottle');
