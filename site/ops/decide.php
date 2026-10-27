<?php
// The decisions inbox. Buttons on /kids/ops/decisions.html POST here (approve, retry, hold, drop, go, skip);
// the laptop's 15-minute outreach job reads the queue back, acts, and acknowledges. The token is OPS_TOKEN in
// ~/.escp-coach.env on the host, outside the web root; it reaches the page only through the #k= fragment of
// the desk link in Anthony's recap text, and the page keeps it in localStorage. Nothing here sends mail.
header("Content-Type: application/json; charset=utf-8");
header("Cache-Control: no-store");
$token = "";
foreach ([dirname(__DIR__, 3) . "/.escp-coach.env", dirname(__DIR__, 2) . "/.escp-coach.env"] as $f) {
  if (is_readable($f)) foreach (file($f) as $l) { if (preg_match('/^OPS_TOKEN=\s*"?([^"\s]+)"?/', $l, $m)) $token = $m[1]; }
}
$in = json_decode(file_get_contents("php://input"), true);
if (!is_array($in)) $in = [];
$given = (string)($in["token"] ?? $_GET["token"] ?? $_SERVER["HTTP_X_OPS_TOKEN"] ?? "");
if ($token === "" || $given === "" || !hash_equals($token, $given)) { http_response_code(403); echo '{"error":"not allowed"}'; exit; }
$dir = dirname(__DIR__) . "/cache"; if (!is_dir($dir)) @mkdir($dir, 0755, true);
$file = "$dir/decisions-inbox.jsonl";
$fh = fopen($file, "c+"); if (!$fh) { http_response_code(500); echo '{"error":"no store"}'; exit; }
flock($fh, LOCK_EX);
$rows = [];
rewind($fh); while (($l = fgets($fh)) !== false) { $j = json_decode(trim($l), true); if (is_array($j)) $rows[] = $j; }
if (isset($in["ack"]) && is_array($in["ack"])) {                       // the laptop has applied these
  $done = array_flip(array_map("strval", $in["ack"]));
  $rows = array_values(array_filter($rows, fn($r) => !isset($done[(string)$r["n"]])));
  ftruncate($fh, 0); rewind($fh); foreach ($rows as $r) fwrite($fh, json_encode($r) . "\n");
  flock($fh, LOCK_UN); fclose($fh); echo json_encode(["ok" => true, "left" => count($rows)]); exit;
}
if ($_SERVER["REQUEST_METHOD"] === "GET" || !empty($in["list"])) {    // the laptop reads, the page greys out
  flock($fh, LOCK_UN); fclose($fh); echo json_encode($rows); exit;
}
$id = substr(preg_replace('/[^A-Za-z0-9_:.\-]/', '', (string)($in["id"] ?? "")), 0, 120);
$action = (string)($in["action"] ?? "");
if ($id === "" || !in_array($action, ["approve", "retry", "hold", "drop", "go", "skip"], true)) { http_response_code(400); echo '{"error":"bad request"}'; exit; }
$row = ["n" => bin2hex(random_bytes(6)), "t" => gmdate("c"), "id" => $id, "action" => $action, "note" => substr((string)($in["note"] ?? ""), 0, 500)];
fseek($fh, 0, SEEK_END); fwrite($fh, json_encode($row) . "\n");
flock($fh, LOCK_UN); fclose($fh);
echo json_encode(["ok" => true, "queued" => $row]);
