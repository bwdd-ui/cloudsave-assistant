<#
  Builds CloudSave-Standalone-<version>.apk without Gradle:
  node bundle -> aapt2 -> javac -> d8 -> zip in assets and dex -> zipalign -> apksigner -> entry gate.

  Keep this file ASCII-only: Windows PowerShell 5.1 reads a .ps1 without a BOM as the local
  code page, so Chinese comments here would break parsing on a zh-CN machine.

  .\build.ps1                # debug-signed APK, no keystore needed
  .\build.ps1 -Release       # signed with the release keystore
  .\build.ps1 -Sdk D:\android-sdk
#>
param(
  [string]$Sdk = 'C:\Android-sdk',
  [switch]$Release,
  [string]$Keystore = 'cloudsave-standalone-release.keystore',
  [string]$KeystorePass = ''
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$build = Join-Path $root 'build'

# The artifact name follows the manifest so a version bump cannot leave a misleading filename behind.
$version = [regex]::Match((Get-Content (Join-Path $root 'AndroidManifest.xml') -Raw),
  'android:versionName="([^"]+)"').Groups[1].Value
if (-not $version) { throw 'AndroidManifest.xml has no android:versionName' }

function Checked($what) {
  if ($LASTEXITCODE -ne 0) { throw "$what failed with exit code $LASTEXITCODE" }
}

function Latest($dir) {
  if (-not (Test-Path $dir)) { throw "not found: $dir" }
  (Get-ChildItem $dir -Directory | Sort-Object Name -Descending | Select-Object -First 1).FullName
}

$bt = Latest (Join-Path $Sdk 'build-tools')
$platform = Latest (Join-Path $Sdk 'platforms')
$androidJar = Join-Path $platform 'android.jar'
$javac = (Get-Command javac).Source
$keytool = (Get-Command keytool).Source
$node = (Get-Command node).Source
Write-Host "build-tools $((Get-Item $bt).Name), platform $((Get-Item $platform).Name)"

if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory -Path $build | Out-Null
New-Item -ItemType Directory -Path (Join-Path $build 'classes') | Out-Null
New-Item -ItemType Directory -Path (Join-Path $build 'dex') | Out-Null

# 0. The phone runs the same site modules the desktop app ships, bundled from cloudsave-windows/.
& $node (Join-Path $root 'tools\bundle.cjs')
Checked 'bundle'
if (-not (Test-Path (Join-Path $root 'assets\www\cloudsave-modules.js'))) { throw 'bundle.cjs did not emit cloudsave-modules.js' }

# 1. resources
& (Join-Path $bt 'aapt2.exe') compile --dir (Join-Path $root 'res') -o (Join-Path $build 'res.zip')
Checked 'aapt2 compile'
# No -A here on purpose: see step 4.
& (Join-Path $bt 'aapt2.exe') link -o (Join-Path $build 'linked.apk') `
  --manifest (Join-Path $root 'AndroidManifest.xml') -I $androidJar `
  --auto-add-overlay (Join-Path $build 'res.zip')
Checked 'aapt2 link'

# 2. java -- language classes come from JDK 11, android.* from android.jar.
#    -parameters is load-bearing: JDK 21 writes a MethodParameters entry with a *null* name for the
#    synthetic this$0 argument, and the d8 shipped in build-tools 34.0.0 throws
#    "Cannot invoke String.length() because <parameter1> is null" on every inner class that captures
#    the enclosing instance. Naming the parameters makes that path non-null and the dex step works.
$sources = Get-ChildItem (Join-Path $root 'src') -Recurse -Filter '*.java' | ForEach-Object { $_.FullName }
& $javac '-J-Duser.language=en' -nowarn -parameters --release 11 -encoding UTF-8 -classpath $androidJar `
  -d (Join-Path $build 'classes') $sources
Checked 'javac'

# 3. dex -- d8 re-checks every call against the API 23 library, so anything newer surfaces here.
$classes = Get-ChildItem (Join-Path $build 'classes') -Recurse -Filter '*.class' | ForEach-Object { $_.FullName }
& (Join-Path $bt 'd8.bat') --release --min-api 23 --lib $androidJar `
  --output (Join-Path $build 'dex') $classes
Checked 'd8'

# 4. classes.dex and the local page into the apk, with entry names we control.
#    aapt2 on Windows writes -A assets using platform separators, producing entries like
#    "assets/www\index.html". Android's AssetManager then cannot resolve www/index.html, so the phone
#    shows ERR_FILE_NOT_FOUND for a file that is plainly inside the apk. Worse, both Python's zipfile
#    and .NET's ZipArchive normalise "\" to "/" when *reading*, so every listing tool hides it; only
#    the byte-level central-directory check in step 7 catches it. Writing the entries ourselves keeps
#    the separator fixed at "/".
Add-Type -AssemblyName System.IO.Compression.FileSystem
$unsigned = Join-Path $build 'standalone-unsigned.apk'
Copy-Item (Join-Path $build 'linked.apk') $unsigned
# A zip entry carries a modified timestamp, and that timestamp is part of the signed bytes: two
# builds of identical content hashed differently here until the stamp was pinned to a fixed value.
$stamp = [System.DateTimeOffset]::new(2024, 1, 1, 0, 0, 0, [System.TimeSpan]::Zero)
$zip = [System.IO.Compression.ZipFile]::Open($unsigned, 'Update')
try {
  $entry = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
    $zip, (Join-Path $build 'dex\classes.dex'), 'classes.dex')
  $entry.LastWriteTime = $stamp
  $assetRoot = (Join-Path $root 'assets')
  # Page files go into the apk byte for byte, so their line endings decide the artifact hash.
  # A working copy made with core.autocrlf=true (or one older than the .gitattributes eol=lf
  # rules) turns them into CRLF and silently ships a different apk than everyone else builds.
  foreach ($file in Get-ChildItem $assetRoot -Recurse -File -Include '*.html', '*.css', '*.js') {
    if ([System.IO.File]::ReadAllBytes($file.FullName) -contains 13) {
      throw "asset $((Get-Item $file.FullName).Name) contains CR bytes; delete it and run 'git checkout -- .' to get the LF copy this repo stores (or set core.autocrlf=input) - otherwise the apk you build is not the apk anyone else can reproduce"
    }
  }
  foreach ($file in Get-ChildItem $assetRoot -Recurse -File) {
    $relative = $file.FullName.Substring($assetRoot.Length).TrimStart('\').Replace('\', '/')
    $entry = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip, $file.FullName, "assets/$relative")
    $entry.LastWriteTime = $stamp
  }
  # aapt2 stamps the entries it produced from the resource files' own mtimes, so those vary with
  # when the checkout happened; two builds of the same commit in two directories disagreed until
  # every entry was pinned. Nothing is signed yet here, so rewriting the stamps is safe.
  foreach ($entry in $zip.Entries) { $entry.LastWriteTime = $stamp }
} finally { $zip.Dispose() }

# 5. align before signing, or apksigner's output would have to be re-aligned and invalidate the seal
$aligned = Join-Path $build 'standalone-aligned.apk'
& (Join-Path $bt 'zipalign.exe') -f 4 $unsigned $aligned
Checked 'zipalign'

# 6. sign
$out = Join-Path $build "CloudSave-Standalone-$version.apk"
if ($Release) {
  $ksPath = Join-Path $root $Keystore
  if (-not (Test-Path $ksPath)) { throw "release keystore missing: $ksPath (keep it off the network, see README.md)" }
  if (-not $KeystorePass) { throw 'pass -KeystorePass, or build without -Release for a debug-signed apk' }
  & (Join-Path $bt 'apksigner.bat') sign --ks $ksPath --ks-key-alias cloudsave-standalone `
    --ks-pass "pass:$KeystorePass" --key-pass "pass:$KeystorePass" --out $out $aligned
  Checked 'apksigner sign'
} else {
  $debugKs = Join-Path $build 'debug.keystore'
  & $keytool -genkeypair -v -keystore $debugKs -alias androiddebugkey -keyalg RSA -keysize 2048 `
    -validity 10000 -storepass android -keypass android `
    -dname 'CN=CloudSave Standalone Debug, O=bwdd-ui, C=CN' | Out-Null
  Checked 'keytool'
  & (Join-Path $bt 'apksigner.bat') sign --ks $debugKs --ks-key-alias androiddebugkey `
    --ks-pass pass:android --key-pass pass:android --out $out $aligned
  Checked 'apksigner debug sign'
}

# 7. gate: read the central directory byte by byte. Every listing helper we might reach for
#    (unzip, Python zipfile, .NET ZipArchive) rewrites '\' into '/' on read, so a name that Android
#    cannot resolve looks perfectly fine everywhere except here.
function Entry-Names($path) {
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $eoc = -1
  for ($i = $bytes.Length - 22; $i -ge 0; $i--) {
    if ($bytes[$i] -eq 0x50 -and $bytes[$i + 1] -eq 0x4B -and $bytes[$i + 2] -eq 0x05 -and $bytes[$i + 3] -eq 0x06) { $eoc = $i; break }
  }
  if ($eoc -lt 0) { throw 'no zip end-of-central-directory record' }
  $count = [BitConverter]::ToUInt16($bytes, $eoc + 10)
  $position = [int][BitConverter]::ToUInt32($bytes, $eoc + 16)
  $names = @()
  for ($i = 0; $i -lt $count; $i++) {
    if (-not ($bytes[$position] -eq 0x50 -and $bytes[$position + 1] -eq 0x4B -and
              $bytes[$position + 2] -eq 0x01 -and $bytes[$position + 3] -eq 0x02)) {
      throw "central directory entry $i has a bad signature"
    }
    $length = [BitConverter]::ToUInt16($bytes, $position + 28)
    $extra = [BitConverter]::ToUInt16($bytes, $position + 30)
    $comment = [BitConverter]::ToUInt16($bytes, $position + 32)
    $names += [System.Text.Encoding]::ASCII.GetString($bytes, $position + 46, $length)
    $position += 46 + $length + $extra + $comment
  }
  return ,$names
}

$names = Entry-Names $out
$slashed = @($names | Where-Object { $_.Contains([char]0x5C) })
if ($slashed.Count) { throw ('zip entry names contain a backslash, Android cannot load them: ' + ($slashed -join ', ')) }
# Which assets the page actually loads is decided by index.html, not by a list kept here:
# adding shell.js or library.js to the page must not need a matching edit in this script.
$html = Get-Content -Raw (Join-Path $root 'assets\www\index.html')
$referenced = @([regex]::Matches($html, '(?:src|href)="(?!https?:|data:|#)([^"]+)"') |
  ForEach-Object { 'assets/www/' + $_.Groups[1].Value })
if (-not $referenced.Count) { throw 'index.html references no packaged asset - this gate stopped checking anything' }
foreach ($required in (@('AndroidManifest.xml', 'resources.arsc', 'classes.dex') + $referenced)) {
  if (-not ($names -ccontains $required)) { throw "the signed apk is missing $required" }
}
Write-Host ("entry names verified byte-wise: {0} entries, all using /; page loads {1} assets: {2}" -f
  $names.Count, $referenced.Count, (($referenced | Sort-Object) -join ' '))

# 8. report
& (Join-Path $bt 'apksigner.bat') verify --print-certs $out
Checked 'apksigner verify'
& (Join-Path $bt 'aapt2.exe') dump badging $out | Select-String -Pattern "^(package|application-label|sdkVersion|targetSdkVersion|launchable-activity|uses-permission)"
Write-Host ""
Write-Host ("artifact: {0} ({1:N0} bytes)" -f $out, (Get-Item $out).Length)
