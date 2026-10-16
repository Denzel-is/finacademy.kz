set -eu
python3 - <<'PY'
import pathlib, urllib.request, urllib.parse
private = pathlib.Path('/root/finance-academy-export-url.txt')
url = private.read_text().strip()
if not urllib.parse.urlparse(url).hostname.endswith('.r2.cloudflarestorage.com'):
    raise RuntimeError('Unexpected export destination')
with urllib.request.urlopen(url, timeout=120) as response, open('/root/finance-academy-export-final.sql','wb') as output:
    while chunk := response.read(1024*1024):
        output.write(chunk)
private.unlink()
print('Final D1 snapshot downloaded to VPS')
PY
