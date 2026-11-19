<?php
// First-party visit log for tagged links. GET/POST hit.php?r=<token>&p=<path> appends one JSON line to
// cache/hits.jsonl: time, token, path, referer, user agent, IP; film events add e, v, k, s, w, d. Read back by tools/outreach/clicks.py.
header("Content-Type: application/json; charset=utf-8");
header("Cache-Control: no-store");
header("Access-Control-Allow-Origin: https://earthpilot.org");
$r = preg_replace('/[^A-Za-z0-9_-]/', '', $_REQUEST["r"] ?? "");
$p = substr(preg_replace('/[^A-Za-z0-9_\/.\-]/', '', $_REQUEST["p"] ?? ""), 0, 200);
if ($r === "" && $p === "") { echo "{}"; exit; }
$dir = __DIR__ . "/cache"; if (!is_dir($dir)) @mkdir($dir, 0755, true);
$row = [
  "t" => gmdate("c"), "r" => $r, "p" => $p,
  "ref" => substr($_SERVER["HTTP_REFERER"] ?? "", 0, 300),
  "ua" => substr($_SERVER["HTTP_USER_AGENT"] ?? "", 0, 200),
  "ip" => $_SERVER["HTTP_CF_CONNECTING_IP"] ?? $_SERVER["REMOTE_ADDR"] ?? "",];
// Film viewing events from the page: event, file, page-load id, furthest second, seconds played, length
$e = preg_replace('/[^a-z]/', '', $_REQUEST["e"] ?? "");
if ($e !== "") {
  $row["e"] = substr($e, 0, 10);
  $row["v"] = substr(preg_replace('/[^A-Za-z0-9_.\-]/', '', $_REQUEST["v"] ?? ""), 0, 80);
  $row["k"] = substr(preg_replace('/[^a-z0-9]/', '', $_REQUEST["k"] ?? ""), 0, 12);
  foreach (["s", "w", "d"] as $f) $row[$f] = min(100000, max(0, intval($_REQUEST[$f] ?? 0)));
}
@file_put_contents("$dir/hits.jsonl", json_encode($row) . "\n", FILE_APPEND | LOCK_EX);
echo "{\"ok\":true}";
