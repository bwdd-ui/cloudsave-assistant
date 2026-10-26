<#
  Builds CloudSave-Shell-1.0.apk without Gradle: aapt2 -> javac -> d8 -> zipalign -> apksigner.

  Everything is resolved from an Android SDK directory (default C:\Android-sdk) and a JDK on PATH, so
  this stays usable on a machine that has no Android Studio and no network access for plugin downloads.

  .\build.ps1                       # debug-signed APK, no keystore needed
  .\build.ps1 -Release              # signed with the release keystore
  .\build.ps1 -Sdk D:\android-sdk
#>
param(
  [string]$Sdk = 'C:\Android-sdk',
  [switch]$Release,
  [string]$Keystore = 'cloudsave-shell-release.keystore',
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
$jar = (Get-Command jar).Source
$keytool = (Get-Command keytool).Source
Write-Host "build-tools $((Get-Item $bt).Name), platform $((Get-Item $platform).Name)"

if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory -Path $build | Out-Null
New-Item -ItemType Directory -Path (Join-Path $build 'classes') | Out-Null
New-Item -ItemType Directory -Path (Join-Path $build 'dex') | Out-Null

# 1. resources
& (Join-Path $bt 'aapt2.exe') compile --dir (Join-Path $root 'res') -o (Join-Path $build 'res.zip')
Checked 'aapt2 compile'
& (Join-Path $bt 'aapt2.exe') link -o (Join-Path $build 'linked.apk') `
  --manifest (Join-Path $root 'AndroidManifest.xml') -I $androidJar `
  --auto-add-overlay (Join-Path $build 'res.zip')
Checked 'aapt2 link'

# 2. java -- language classes come from JDK 11, android.* from android.jar; d8 below re-checks every
#    call against the API 21 library, so anything newer than the minSdk surfaces there instead of on
#    an old phone. -J-Duser.language=en keeps javac output readable in a non-UTF8 console.
#    -parameters is load-bearing: JDK 21 writes a MethodParameters entry with a *null* name for the
#    synthetic this$0 argument, and the d8 shipped in build-tools 34.0.0 throws
#    "Cannot invoke String.length() because <parameter1> is null" on every inner class that captures
#    the enclosing instance. Naming the parameters makes that path non-null and the dex step works.
$sources = Get-ChildItem (Join-Path $root 'src') -Recurse -Filter '*.java' | ForEach-Object { $_.FullName }
& $javac '-J-Duser.language=en' -nowarn -parameters --release 11 -encoding UTF-8 -classpath $androidJar `
  -d (Join-Path $build 'classes') $sources
Checked 'javac'

# 3. dex
$classes = Get-ChildItem (Join-Path $build 'classes') -Recurse -Filter '*.class' | ForEach-Object { $_.FullName }
& (Join-Path $bt 'd8.bat') --release --min-api 21 --lib $androidJar `
  --output (Join-Path $build 'dex') $classes
Checked 'd8'

# 4. classes.dex into the apk at the zip root
Add-Type -AssemblyName System.IO.Compression.FileSystem
$unsigned = Join-Path $build 'shell-unsigned.apk'
Copy-Item (Join-Path $build 'linked.apk') $unsigned
$zip = [System.IO.Compression.ZipFile]::Open($unsigned, 'Update')
try {
  [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
    $zip, (Join-Path $build 'dex\classes.dex'), 'classes.dex')
} finally { $zip.Dispose() }

# 5. align before signing, or apksigner's output would have to be re-aligned and invalidate the seal
$aligned = Join-Path $build 'shell-aligned.apk'
& (Join-Path $bt 'zipalign.exe') -f 4 $unsigned $aligned
Checked 'zipalign'

# 6. sign
$out = Join-Path $build "CloudSave-Shell-$version.apk"
if ($Release) {
  $ksPath = Join-Path $root $Keystore
  if (-not (Test-Path $ksPath)) { throw "release keystore missing: $ksPath (keep it off the network, see README.md)" }
  if (-not $KeystorePass) { throw 'pass -KeystorePass, or build without -Release for a debug-signed apk' }
  & (Join-Path $bt 'apksigner.bat') sign --ks $ksPath --ks-key-alias cloudsave-shell `
    --ks-pass "pass:$KeystorePass" --key-pass "pass:$KeystorePass" --out $out $aligned
  Checked 'apksigner sign'
} else {
  $debugKs = Join-Path $build 'debug.keystore'
  & $keytool -genkeypair -v -keystore $debugKs -alias androiddebugkey -keyalg RSA -keysize 2048 `
    -validity 10000 -storepass android -keypass android `
    -dname 'CN=CloudSave Shell Debug, O=bwdd-ui, C=CN' | Out-Null
  Checked 'keytool'
  & (Join-Path $bt 'apksigner.bat') sign --ks $debugKs --ks-key-alias androiddebugkey `
    --ks-pass pass:android --key-pass pass:android --out $out $aligned
  Checked 'apksigner debug sign'
}

# 7. report
& (Join-Path $bt 'apksigner.bat') verify --print-certs $out
Checked 'apksigner verify'
& (Join-Path $bt 'aapt2.exe') dump badging $out | Select-String -Pattern "^(package|application-label|sdkVersion|targetSdkVersion|launchable-activity|uses-permission)"
Write-Host ""
Write-Host ("artifact: {0} ({1:N0} bytes)" -f $out, (Get-Item $out).Length)
