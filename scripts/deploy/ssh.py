"""Private VPS transport. Secrets and first-use host key stay in ignored .local."""
import json, pathlib, sys
import paramiko

root = pathlib.Path(__file__).resolve().parents[2]
access = json.loads((root / '.local/vps-access.json').read_text(encoding='utf-8'))
known = root / '.local/vps-known-hosts'
client = paramiko.SSHClient()
if known.exists():
    client.load_host_keys(str(known))
else:
    known.touch()
class EnrollOnce(paramiko.MissingHostKeyPolicy):
    def missing_host_key(self, client, hostname, key):
        if client.get_host_keys().lookup(hostname):
            raise RuntimeError('Host key changed; refusing connection')
        client.get_host_keys().add(hostname, key.get_name(), key)
        client.save_host_keys(str(known))
client.set_missing_host_key_policy(EnrollOnce())
options = dict(hostname=access['host'], username=access['user'], timeout=20, auth_timeout=20, look_for_keys=False, allow_agent=False)
if access.get('key_path'):
    options['key_filename'] = access['key_path']
else:
    options['password'] = access['password']
client.connect(**options)
try:
    if sys.argv[1] in ('put', 'get'):
        with client.open_sftp() as sftp:
            if sys.argv[1] == 'put':
                sftp.put(sys.argv[2], sys.argv[3])
                sftp.chmod(sys.argv[3], 0o600)
            else:
                sftp.get(sys.argv[2], sys.argv[3])
        print('Transferred ' + pathlib.Path(sys.argv[2]).name)
    else:
        command = pathlib.Path(sys.argv[2]).read_text(encoding='utf-8') if sys.argv[1] == 'script' else sys.argv[2]
        stdin, stdout, stderr = client.exec_command(command, timeout=600)
        for line in stdout:
            print(line, end='', flush=True)
        print(stderr.read().decode('utf-8', errors='replace'), end='', file=sys.stderr)
        sys.exit(stdout.channel.recv_exit_status())
finally:
    client.close()
