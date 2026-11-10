<?php
// The door on the private ops pages: the CRM, the decisions desk, the correspondence board and data/crm.json.
// The .htaccess one level up rewrites those four URLs here. A device that has shown the ops token once (the
// #k= fragment of the desk link in Anthony's recap text, kept by the page in localStorage) gets a 60-day
// HttpOnly cookie and is served the file; anyone else gets a page that says it is private. The token is
// OPS_TOKEN in ~/.escp-coach.env on the host, outside the web root, the same one decide.php checks. The
// public status page (/kids/ops/) is not behind this door: it names districts, never people or addresses.
header("Cache-Control: private, no-store");
header("X-Robots-Tag: noindex, nofollow");
$allowed = [
  "ops/crm.html" => "text/html; charset=utf-8",
  "ops/decisions.html" => "text/html; charset=utf-8",
  "ops/board.html" => "text/html; charset=utf-8",
  "data/crm.json" => "application/json; charset=utf-8",
];
$token = "";
foreach ([dirname(__DIR__, 3) . "/.escp-coach.env", dirname(__DIR__, 2) . "/.escp-coach.env"] as $f) {
  if (is_readable($f)) foreach (file($f) as $l) { if (preg_match('/^OPS_TOKEN=\s*"?([^"\s]+)"?/', $l, $m)) $token = $m[1]; }
}
$device = $token === "" ? "" : hash_hmac("sha256", "ops-device-v1", $token);
if ($_SERVER["REQUEST_METHOD"] === "POST") {                              // a device shows the token once
  header("Content-Type: application/json; charset=utf-8");
  $in = json_decode(file_get_contents("php://input"), true);
  $given = is_array($in) ? (string)($in["token"] ?? "") : "";
  if ($token === "" || $given === "" || !hash_equals($token, $given)) { http_response_code(403); echo '{"error":"not allowed"}'; exit; }
  setcookie("opsd", $device, ["expires" => time() + 60 * 86400, "path" => "/kids/", "secure" => true, "httponly" => true, "samesite" => "Lax"]);
  echo '{"ok":true}'; exit;
}
$f = (string)($_GET["f"] ?? "");
if (!isset($allowed[$f])) { http_response_code(404); exit; }
$has = (string)($_COOKIE["opsd"] ?? "");
if ($device !== "" && $has !== "" && hash_equals($device, $has)) {
  $path = dirname(__DIR__) . "/" . $f;
  if (!is_readable($path)) { http_response_code(404); exit; }
  header("Content-Type: " . $allowed[$f]);
  readfile($path); exit;
}
if ($f === "data/crm.json") { http_response_code(403); header("Content-Type: application/json; charset=utf-8"); echo '{"error":"not allowed"}'; exit; }
header("Content-Type: text/html; charset=utf-8");
?><!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Private · Safe Schools Project</title><link rel="stylesheet" href="/kids/site.css"></head>
<body><main class="wrap" style="max-width:640px"><h1>Private page</h1>
<p id="msg">Checking this device.</p>
<p><a href="/kids/ops/">Public status page</a></p></main>
<script>
(function(){
  var msg=document.getElementById("msg"), m=location.hash.match(/k=([A-Za-z0-9_\-]+)/), k=m?m[1]:null, tried=false;
  try{ if(m) localStorage.setItem("opsk",m[1]); k=localStorage.getItem("opsk")||k; tried=sessionStorage.getItem("opsgate")==="1"; }catch(e){}
  var closed="This page is for the project's operator. Open it from the link in the daily recap text.";
  if(!k){ msg.textContent=closed; return; }
  if(tried){ msg.textContent="This device could not be verified. Open the link in the daily recap text again."; return; }
  try{ sessionStorage.setItem("opsgate","1"); }catch(e){}
  fetch("/kids/ops/gate.php",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:k})})
    .then(function(r){ if(!r.ok) throw new Error(r.status); try{ sessionStorage.removeItem("opsgate"); }catch(e){} location.reload(); })
    .catch(function(){ msg.textContent=closed; });
})();
</script></body></html>
