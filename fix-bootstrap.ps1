$path = 'e:\programs and applications\desktop\drug-manager\electron\config\firebase-bootstrap.ts'
$content = [System.IO.File]::ReadAllText($path)
$nl = [System.Environment]::NewLine

# 1) Function signature
$oldSig = "export function resolveAndValidateFirebaseConfig(${nl}  isDevelopment: boolean,${nl}  env: NodeJS.ProcessEnv = process.env,${nl}): FirebaseBootstrapResult {"
$newSig = "export function resolveAndValidateFirebaseConfig(${nl}  isDevelopment: boolean,${nl}  allowFirebaseEmulators: boolean,${nl}  env: NodeJS.ProcessEnv = process.env,${nl}): FirebaseBootstrapResult {"
if ($content.Contains($oldSig)) { $content = $content.Replace($oldSig, $newSig); Write-Host '1 sig OK' } else { Write-Host '1 sig FAIL' }

# 2) The resolveFirebaseAuthConfig call (multi-line)
$oldCall = "resolveFirebaseAuthConfig(isDevelopment ? 'development' : 'production'), env)"
$newCall = "resolveFirebaseAuthConfig(${nl}    isDevelopment ? 'development' : 'production',${nl}    env,${nl}    allowFirebaseEmulators,${nl}  )"
if ($content.Contains($oldCall)) { $content = $content.Replace($oldCall, $newCall); Write-Host '2 call OK' } else { Write-Host '2 call FAIL' }

# 3) validateFirebaseAuthConfig call
$oldVal = 'validateFirebaseAuthConfig(firebaseAuthConfig);'
$newVal = 'validateFirebaseAuthConfig(firebaseAuthConfig, allowFirebaseEmulators);'
if ($content.Contains($oldVal)) { $content = $content.Replace($oldVal, $newVal); Write-Host '3 val OK' } else { Write-Host '3 val FAIL' }

# 4) createFirebaseClients call to resolveAndValidateFirebaseConfig
$oldCC = 'resolveAndValidateFirebaseConfig(isDevelopment, env)'
$newCC = 'resolveAndValidateFirebaseConfig(isDevelopment, allowFirebaseEmulators, env)'
if ($content.Contains($oldCC)) { $content = $content.Replace($oldCC, $newCC); Write-Host '4 cc OK' } else { Write-Host '4 cc FAIL' }

# 5) createFirebaseClients signature
$oldCs = "export function createFirebaseClients<TAuth, TFirestore>(${nl}  isDevelopment: boolean,${nl}  env: NodeJS.ProcessEnv,"
$newCs = "export function createFirebaseClients<TAuth, TFirestore>(${nl}  isDevelopment: boolean,${nl}  allowFirebaseEmulators: boolean,${nl}  env: NodeJS.ProcessEnv,"
if ($content.Contains($oldCs)) { $content = $content.Replace($oldCs, $newCs); Write-Host '5 cs OK' } else { Write-Host '5 cs FAIL' }

[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))
Write-Host 'Done'