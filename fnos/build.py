"""Build an offline fnOS FPK with the official fnpack tool."""
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tarfile

ROOT = pathlib.Path(__file__).resolve().parent
APP = ROOT / 'cloudsave'
IMAGE_NAME = 'CloudSave-Docker-amd64-1.2.1.tar.gz'
IMAGE_SHA = '3c6834be1a7156cdffe6a88b02293e0a2208678868039bd1e82f422479facccb'

def sha(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def main():
    image = APP / 'app/docker' / IMAGE_NAME
    if not image.is_file() or sha(image) != IMAGE_SHA:
        raise RuntimeError('Place the verified Docker release image in fnos/cloudsave/app/docker')
    for f in APP.rglob('*'):
        if not f.is_file() or f.suffix.lower() in ('.png', '.gz', '.fpk'):
            continue
        text = f.read_bytes()
        text.decode('utf-8')
        if b'\r' in text or text.startswith(b'\xef\xbb\xbf'):
            raise RuntimeError(f'Expected UTF-8 without BOM and LF: {f}')
    for f in list((APP / 'config').iterdir()) + list((APP / 'wizard').iterdir()) + [APP / 'app/ui/config']:
        json.loads(f.read_text(encoding='utf-8'))
    for f in (APP / 'cmd').iterdir():
        f.chmod(0o755)
    fnpack = os.environ.get('FNPACK_BIN') or shutil.which('fnpack')
    if not fnpack:
        raise RuntimeError('Set FNPACK_BIN to the official fnpack 1.2.3 executable')
    subprocess.run([fnpack, 'build', '--directory', str(APP)], check=True, cwd=APP)
    package = APP / 'cloudsave.fpk'
    with tarfile.open(package, 'r:gz') as archive:
        manifest = archive.extractfile('manifest').read().decode('utf-8')
        assert 'platform' in manifest and 'x86' in manifest
        inner = archive.extractfile('app.tgz')
        md5 = hashlib.md5()
        for chunk in iter(lambda: inner.read(1024 * 1024), b''):
            md5.update(chunk)
        checksum = dict(line.split('=', 1) for line in manifest.splitlines() if '=' in line)
        checksum = {k.strip(): v.strip() for k, v in checksum.items()}
        assert checksum['checksum'] == md5.hexdigest(), 'app.tgz checksum'
        for member in archive.getmembers():
            if member.isfile() and member.name.startswith('cmd/'):
                assert member.mode & 0o111, f'Non-executable lifecycle script: {member.name}'
    out = ROOT / 'dist'
    out.mkdir(exist_ok=True)
    target = out / 'CloudSave-fnOS-x86-1.2.1.fpk'
    shutil.copyfile(package, target)
    report = {'package': target.name, 'bytes': target.stat().st_size, 'sha256': sha(target),
              'embeddedImageSha256': IMAGE_SHA, 'officialFnpack': '1.2.3',
              'utf8LF': True, 'appChecksum': True, 'executableScripts': True,
              'realFnOSInstallTested': False}
    (out / 'fpk-validation.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    (out / 'SHA256SUMS.txt').write_text(report['sha256'] + '  ' + target.name + '\n', encoding='utf-8')
    print(json.dumps(report))

if __name__ == '__main__':
    main()
