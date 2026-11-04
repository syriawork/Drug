$path = 'e:\programs and applications\desktop\drug-manager\electron\config\firebase-bootstrap.ts'
$text = [System.IO.File]::ReadAllText($path)
$lines = $text.Split([string[]]@("`r`n"), [System.StringSplitOptions]::None)
for ($i = 9; $i -le 15; $i++) {
    $line = $lines[$i]
    Write-Host ('LINE ' + $i + ': [' + $line + ']')
}
Write-Host '---'
Write-Host ('Contains signature: ' + $text.Contains('export function resolveAndValidateFirebaseConfig'))
Write-Host ('Contains resolveFirebaseAuthConfig call: ' + $text.Contains("resolveFirebaseAuthConfig(isDevelopment"))
Write-Host ('Contains validateFirebaseAuthConfig: ' + $text.Contains('validateFirebaseAuthConfig(firebaseAuthConfig)'))
Write-Host ('Contains createFirebaseClients call: ' + $text.Contains('resolveAndValidateFirebaseConfig(isDevelopment, env)'))
Write-Host ('Contains createFirebaseClients sig: ' + $text.Contains('export function createFirebaseClients'))