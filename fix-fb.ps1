$path = 'e:\programs and applications\desktop\drug-manager\electron\config\firebase-bootstrap.ts'
$content = [System.IO.File]::ReadAllText($path)
$nl = "`n"

$oldSig = "export function resolveAndValidateFirebaseConfig(" + $nl + "  isDevelopment: boolean," + $nl + "  env: NodeJS.ProcessEnv = process.env," + $nl + "): FirebaseBootstrapResult {"
$newSig = "export function resolveAndValidateFirebaseConfig(" + $nl + "  isDevelopment: boolean," + $nl + "  allowFirebaseEmulators: boolean," + $nl + "  env: NodeJS.ProcessEnv = process.env," + $nl + "): FirebaseBootstrapResult {"
if ($content.Contains($oldSig)) { $content = $content.Replace($oldSig, $newSig); Write-Host '1 sig OK' } else { Write-Host '1 sig FAIL' }

$oldCall = "resolveFirebaseAuthConfig(isDevelopment ? 'development' : 'production', env)"
$newCall = "resolveFirebaseAuthConfig(" + $nl + "    isDevelopment ? 'development' : 'production'," + $nl + "    env," + $nl + "    allowFirebaseEmulators," + $nl + "  )"
if ($content.Contains($oldCall)) { $content = $content.Replace($oldCall, $newCall); Write-Host '2 call OK' } else { Write-Host '2 call FAIL' }

[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))
Write-Host 'Written'