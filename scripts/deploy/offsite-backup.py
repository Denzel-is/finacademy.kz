"""Copy the newest VPS dump over pinned SSH; store only authenticated ciphertext locally."""
import datetime, hashlib, json, os, pathlib, re, sys, time
import paramiko
from cryptography.fernet import Fernet

project = pathlib.Path(__file__).resolve().parents[2]
destination = pathlib.Path(os.environ['USERPROFILE']) / '.codex' / 'backups' / 'finacademy'
key_path = pathlib.Path(os.environ['USERPROFILE']) / '.codex' / 'private' / 'finacademy-backup.key'
destination.mkdir(parents=True, exist_ok=True)
key_path.parent.mkdir(parents=True, exist_ok=True)
if not key_path.exists():
    with key_path.open('xb') as output:
        output.write(Fernet.generate_key())
    os.chmod(key_path, 0o600)
cipher = Fernet(key_path.read_bytes())
access = json.loads((project / '.local/vps-access.json').read_text(encoding='utf-8'))
client = paramiko.SSHClient()
client.load_host_keys(str(project / '.local/vps-known-hosts'))
client.set_missing_host_key_policy(paramiko.RejectPolicy())
options = dict(hostname=access['host'], username=access['user'], timeout=20, auth_timeout=20, look_for_keys=False, allow_agent=False)
private_key = pathlib.Path(access['key_path']) if access.get('key_path') else project / '.local/vps-id-ed25519'
if private_key.exists(): options['key_filename'] = str(private_key)
else: options['password'] = access['password']
try:
    client.connect(**options)
    with client.open_sftp() as sftp:
        files = [f for f in sftp.listdir_attr('/var/backups/finance-academy') if re.fullmatch(r'finacademy-\d{8}T\d{6}Z\.dump', f.filename)]
        if not files: raise RuntimeError('No VPS backup found')
        latest = max(files, key=lambda f: f.filename)
        if time.time() - latest.st_mtime > 36 * 3600: raise RuntimeError('VPS backup is older than 36 hours')
        if latest.st_size > 64 * 1024 * 1024: raise RuntimeError('Backup exceeds copy size guard; review required')
        target = destination / (latest.filename + '.fernet')
        if target.exists():
            print(json.dumps({'ok': True, 'copied': False, 'file': target.name, 'reason': 'already copied'}))
            sys.exit(0)
        with sftp.open('/var/backups/finance-academy/' + latest.filename, 'rb') as source:
            raw = source.read(64 * 1024 * 1024 + 1)
        if len(raw) != latest.st_size or not raw.startswith(b'PGDMP'): raise RuntimeError('Backup size/format verification failed')
        encrypted = cipher.encrypt(raw)
        if cipher.decrypt(encrypted) != raw: raise RuntimeError('Encryption round-trip failed')
        temporary = target.with_suffix(target.suffix + '.tmp')
        with temporary.open('xb') as output: output.write(encrypted)
        os.chmod(temporary, 0o600)
        temporary.replace(target)
        report = {'ok': True, 'copied': True, 'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'file': target.name, 'bytes': len(raw), 'source_sha256': hashlib.sha256(raw).hexdigest(), 'ciphertext_sha256': hashlib.sha256(encrypted).hexdigest(), 'encryption_verified': True}
        target.with_suffix(target.suffix + '.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        # Retain at least 30 most recent copies; remove only strictly named older files.
        old = sorted(destination.glob('finacademy-*.dump.fernet'), reverse=True)[30:]
        for file in old:
            if re.fullmatch(r'finacademy-\d{8}T\d{6}Z\.dump\.fernet', file.name) and time.time()-file.stat().st_mtime > 30*86400:
                file.unlink()
                file.with_suffix(file.suffix + '.json').unlink(missing_ok=True)
        print(json.dumps(report))
finally:
    client.close()
