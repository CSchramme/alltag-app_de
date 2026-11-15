# Alltag - Fernsteuerung fuer diesen PC
# Schickt den Bildschirm an Alltag und nimmt von dort Maus und Tastatur an - nur solange dieses Programm laeuft.
# Ohne offene Bildschirm-Ansicht wartet es nur (kein Bild, kaum Datenverkehr).
# Starten: Rechtsklick -> "Mit PowerShell ausfuehren", oder als Befehl (z. B. HASS.Agent "Benutzerdefiniert"):
#   powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "<Pfad>\alltag-fernsteuerung.ps1"
# Grenzen: zeigt nichts, solange Windows gesperrt ist; Fenster mit Administratorrechten nehmen keine Eingaben an.
$Server = '__SERVER__'
$Key = '__KEY__'

Add-Type -AssemblyName System.Drawing, System.Windows.Forms, System.Net.Http
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class AlltagInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
'@
[AlltagInput]::SetProcessDPIAware() | Out-Null   # echte Pixel statt skalierter (sonst passt der Mausklick nicht)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$http = New-Object System.Net.Http.HttpClient
$http.Timeout = [TimeSpan]::FromSeconds(40)
$http.DefaultRequestHeaders.Add('X-Key', $Key)   # im Header, damit der Schluessel nicht im Zugriffsprotokoll des Servers steht
$jpeg = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$quality = New-Object Drawing.Imaging.EncoderParameters 1
$quality.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), ([long]55)
$md5 = [Security.Cryptography.MD5]::Create()
$keys = @{
  Enter = '{ENTER}'; Backspace = '{BACKSPACE}'; Tab = '{TAB}'; Escape = '{ESC}'; Delete = '{DEL}'
  ArrowLeft = '{LEFT}'; ArrowRight = '{RIGHT}'; ArrowUp = '{UP}'; ArrowDown = '{DOWN}'
  Home = '{HOME}'; End = '{END}'; PageUp = '{PGUP}'; PageDown = '{PGDN}'; F5 = '{F5}'
  'Ctrl+A' = '^a'; 'Ctrl+C' = '^c'; 'Ctrl+V' = '^v'; 'Ctrl+X' = '^x'; 'Ctrl+Z' = '^z'; 'Alt+Tab' = '%{TAB}'; 'Alt+F4' = '%{F4}'
}
$btnDown = @(0x02, 0x08, 0x20); $btnUp = @(0x04, 0x10, 0x40)   # links, rechts, Mitte

$all = [Windows.Forms.Screen]::AllScreens
$sel = 0
for ($i = 0; $i -lt $all.Count; $i++) { if ($all[$i].Primary) { $sel = $i } }

function Get-Area {   # gewaehlter Bildschirm, -1 = alle zusammen
  $all = [Windows.Forms.Screen]::AllScreens
  if ($script:sel -lt 0 -or $script:sel -ge $all.Count) { return [Windows.Forms.SystemInformation]::VirtualScreen }
  return $all[$script:sel].Bounds
}

function Get-Frame($b) {
  $bmp = New-Object Drawing.Bitmap $b.Width, $b.Height
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
  $p = [Windows.Forms.Cursor]::Position
  if ($b.Contains($p)) { [Windows.Forms.Cursors]::Arrow.Draw($g, (New-Object Drawing.Rectangle ($p.X - $b.Left), ($p.Y - $b.Top), 32, 32)) }
  $g.Dispose()
  $k = [Math]::Min(1.0, 1600.0 / $b.Width)
  $out = New-Object Drawing.Bitmap ([int]($b.Width * $k)), ([int]($b.Height * $k))
  $g = [Drawing.Graphics]::FromImage($out)
  $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::Bilinear
  $g.DrawImage($bmp, 0, 0, $out.Width, $out.Height)
  $g.Dispose(); $bmp.Dispose()
  $ms = New-Object IO.MemoryStream
  $out.Save($ms, $jpeg, $quality); $out.Dispose()
  return , $ms.ToArray()
}

Write-Host 'Alltag-Fernsteuerung laeuft. Fenster schliessen beendet sie.'
$last = ''; $active = $false
while ($true) {
  $b = Get-Area; $body = [byte[]]@(); $locked = 0
  if ($active) {
    try {
      $f = Get-Frame $b
      $h = [BitConverter]::ToString($md5.ComputeHash($f))
      if ($h -ne $last) { $body = $f; $last = $h }   # unveraendertes Bild nicht nochmal schicken
    } catch { $locked = 1 }   # gesperrter Bildschirm laesst sich nicht abgreifen
  } else { $last = '' }
  # Bild als Formular-Datei mit Base64-Inhalt: die Firewall des Hosters sperrt sonst (image/jpeg) nach kurzer Zeit diesen PC
  $content = $null
  if ($body.Length) {
    $content = New-Object System.Net.Http.MultipartFormDataContent
    $content.Add((New-Object System.Net.Http.StringContent ([Convert]::ToBase64String($body))), 'bild', 'bild.jpg')
  }
  $url = "$Server/api/screen/agent?n=$([Windows.Forms.Screen]::AllScreens.Count)&s=$sel&locked=$locked"
  try {
    $r = $http.PostAsync($url, $content).GetAwaiter().GetResult()
    if ([int]$r.StatusCode -eq 403) { Write-Host 'Schluessel ungueltig - Programm in Alltag neu laden.'; break }
    if (-not $r.IsSuccessStatusCode) { Start-Sleep -Seconds 3; continue }
    $j = $r.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
  } catch { Start-Sleep -Seconds 5; continue }
  $active = [bool]$j.active
  foreach ($e in $j.events) {
    $b = Get-Area
    switch ($e.t) {
      'move' { [AlltagInput]::SetCursorPos([int]($b.Left + $e.x * ($b.Width - 1)), [int]($b.Top + $e.y * ($b.Height - 1))) | Out-Null }
      'down' { [AlltagInput]::mouse_event($btnDown[[int]$e.b], 0, 0, 0, [UIntPtr]::Zero) }
      'up' { [AlltagInput]::mouse_event($btnUp[[int]$e.b], 0, 0, 0, [UIntPtr]::Zero) }
      'wheel' { [AlltagInput]::mouse_event(0x0800, 0, 0, [int]$e.d, [UIntPtr]::Zero) }
      'text' { [Windows.Forms.SendKeys]::SendWait(($e.s -replace '[+^%~(){}\[\]]', '{$0}')) }
      'key' {
        if ($e.k -eq 'Win') { [AlltagInput]::keybd_event(0x5B, 0, 0, [UIntPtr]::Zero); [AlltagInput]::keybd_event(0x5B, 0, 2, [UIntPtr]::Zero) }
        elseif ($keys.ContainsKey($e.k)) { [Windows.Forms.SendKeys]::SendWait($keys[$e.k]) }
      }
      'screen' { $sel = [int]$e.i; $last = '' }
    }
  }
  if ($active) { Start-Sleep -Milliseconds 100 }
}
