<?php
// First-party visit log for tagged links. GET/POST hit.php?r=<token>&p=<path> appends one JSON line to
// cache/hits.jsonl: time, token, path, referer, user agent, IP. Read back by tools/outreach/clicks.py.
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
  "ip" => $_SERVER["HTTP_CF_CONNECTING_IP"] ?? $_SERVER["REMOTE_ADDR"] ?? "",
];
@file_put_contents("$dir/hits.jsonl", json_encode($row) . "\n", FILE_APPEND | LOCK_EX);
echo "{\"ok\":true}";
