<?php
// The Behavior Coach's only endpoint. POST {messages:[{role,content},...]} -> {text}. The conversation
// lives in the visitor's browser; this file forwards it to the model and keeps none of it. What it does
// keep, in ../cache/coach-<day>.json, is a per-day spend total and a per-day count under a one-way hash of
// the visitor's address that changes every day, so nobody can be rate-limited forever or looked up later.
// The key lives in ~/.escp-coach.env on the host, outside the web root.
header("Content-Type: application/json; charset=utf-8");
header("Cache-Control: no-store");
header("X-Robots-Tag: noindex");
if (($_SERVER["REQUEST_METHOD"] ?? "") !== "POST") { http_response_code(405); echo '{"error":"POST only"}'; exit; }

$env = [];
foreach ([dirname(__DIR__, 3) . "/.escp-coach.env", dirname(__DIR__, 2) . "/.escp-coach.env"] as $f) {
  if (!is_file($f)) continue;
  foreach (file($f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $l) {
    if ($l[0] === "#" || !str_contains($l, "=")) continue;
    [$k, $v] = explode("=", $l, 2); $env[trim($k)] = trim($v, " \t\"'");
  }
  break;
}
$key = $env["OPENROUTER_API_KEY"] ?? "";
if ($key === "") { http_response_code(503); echo json_encode(["error" => "The coach is not configured yet."]); exit; }
$model = $env["COACH_MODEL"] ?? "anthropic/claude-sonnet-5";
$dailyUsd = (float)($env["COACH_DAILY_USD"] ?? 10);
$perVisitor = (int)($env["COACH_VISITOR_DAILY"] ?? 40);
$salt = $env["COACH_SALT"] ?? "escp-coach";

$in = json_decode(file_get_contents("php://input"), true);
$msgs = is_array($in["messages"] ?? null) ? $in["messages"] : [];
if (!$msgs || count($msgs) > 30) { http_response_code(400); echo json_encode(["error" => "bad request"]); exit; }
$clean = []; $total = 0;
foreach ($msgs as $m) {
  $role = ($m["role"] ?? "") === "assistant" ? "assistant" : "user";
  $c = trim((string)($m["content"] ?? ""));
  if ($c === "") continue;
  if (mb_strlen($c) > 3000) $c = mb_substr($c, 0, 3000);
  $total += mb_strlen($c);
  $clean[] = ["role" => $role, "content" => $c];
}
if (!$clean || $clean[count($clean) - 1]["role"] !== "user" || $total > 30000) { http_response_code(400); echo json_encode(["error" => "bad request"]); exit; }

// Budget and rate limit, inside a lock so two visitors cannot write over each other.
$dir = dirname(__DIR__) . "/cache"; if (!is_dir($dir)) @mkdir($dir, 0755, true);
$day = gmdate("Y-m-d");
$state = "$dir/coach-$day.json";
$who = substr(hash("sha256", ($_SERVER["HTTP_CF_CONNECTING_IP"] ?? $_SERVER["REMOTE_ADDR"] ?? "") . "|$day|$salt"), 0, 16);
$lock = fopen("$dir/coach.lock", "c"); flock($lock, LOCK_EX);
$st = is_file($state) ? (json_decode(file_get_contents($state), true) ?: []) : [];
$st += ["usd" => 0, "calls" => 0, "visitors" => []];
$mine = $st["visitors"][$who] ?? 0;
if ($st["usd"] >= $dailyUsd) { flock($lock, LOCK_UN); http_response_code(429); echo json_encode(["error" => "The coach has reached today's limit. It resets at midnight UTC. The free kit at earthpilot.org/kids/kit/ has every practice the coach draws on."]); exit; }
if ($mine >= $perVisitor) { flock($lock, LOCK_UN); http_response_code(429); echo json_encode(["error" => "That is the limit for one visitor today. Come back tomorrow, or read the kit at earthpilot.org/kids/kit/."]); exit; }
$st["visitors"][$who] = $mine + 1; $st["calls"]++;
file_put_contents("$state.tmp", json_encode($st)); rename("$state.tmp", $state);
flock($lock, LOCK_UN);

require __DIR__ . "/prompt.inc.php";
$body = [
  "model" => $model,
  // Sonnet thinks before it answers and OpenRouter will not turn that off; the headroom keeps the visible reply whole.
  "max_tokens" => 2600,
  "temperature" => 0.4,
  "usage" => ["include" => true],
  "messages" => array_merge([["role" => "system", "content" => [["type" => "text", "text" => $COACH_PROMPT, "cache_control" => ["type" => "ephemeral"]]]]], $clean),
];
$ch = curl_init("https://openrouter.ai/api/v1/chat/completions");
curl_setopt_array($ch, [
  CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 90,
  CURLOPT_HTTPHEADER => ["Authorization: Bearer $key", "Content-Type: application/json", "HTTP-Referer: https://earthpilot.org/kids/coach/", "X-Title: Behavior Coach", "User-Agent: jev-chat/0.1"],
  CURLOPT_POSTFIELDS => json_encode($body),
]);
$res = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
$d = $res ? json_decode($res, true) : null;
$text = trim((string)($d["choices"][0]["message"]["content"] ?? ""));
$usd = (float)($d["usage"]["cost"] ?? 0);
if ($code !== 200 || $text === "") {
  @file_put_contents("$dir/coach-errors.log", gmdate("c") . " http=$code " . substr((string)$res, 0, 200) . "\n", FILE_APPEND | LOCK_EX);
  http_response_code(502); echo json_encode(["error" => "The coach did not answer. Try once more in a moment."]); exit;
}
// Spend, never content.
flock($lock, LOCK_EX);
$st = is_file($state) ? (json_decode(file_get_contents($state), true) ?: []) : []; $st += ["usd" => 0, "calls" => 0, "visitors" => []];
$st["usd"] += $usd; file_put_contents("$state.tmp", json_encode($st)); rename("$state.tmp", $state);
flock($lock, LOCK_UN); fclose($lock);
@file_put_contents("$dir/coach-calls.log", gmdate("c") . " $who turn=" . count($clean) . " in=" . ($d["usage"]["prompt_tokens"] ?? 0) . " out=" . ($d["usage"]["completion_tokens"] ?? 0) . " usd=" . number_format($usd, 5) . "\n", FILE_APPEND | LOCK_EX);
echo json_encode(["text" => $text]);
