<?php
// Publisher marks for the news list. GET icon.php?d=<domain> -> that publisher's favicon.
//
// Fetched here and cached, rather than pointed at a favicon service from the page, because a browser
// asking a third party for an icon per headline tells that third party who is reading this page and
// what they are reading. One fetch per publisher, then it is served from here for a month.
//
// The domain comes from the RSS feed's own <source url>, but it arrives via the query string, so it
// is validated as a public hostname before anything is fetched: no addresses, no internal names, no
// ports, no credentials.

$d = strtolower(trim($_GET["d"] ?? ""));

// Nothing is returned on failure, deliberately. Answering with a transparent pixel means the <img>
// loads successfully and the page shows an empty square forever; an empty 404 makes the image error,
// the script removes it, and the publisher's initial shows through instead.
function refuse(int $code = 404): void {
  http_response_code($code);
  header("Cache-Control: public, max-age=3600");
  header("Content-Length: 0");
  exit;
}

// A public hostname: labels and dots, nothing else, and not a bare address.
if (!preg_match('/^(?=.{4,80}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}$/', $d)) refuse();
if (preg_match('/^\d+\.\d+\.\d+\.\d+$/', $d)) refuse();
if (preg_match('/(^|\.)(localhost|local|internal|intranet|test|invalid|example)$/', $d)) refuse();

$dir = __DIR__ . "/cache/icons";
if (!is_dir($dir)) @mkdir($dir, 0755, true);
$key  = $dir . "/" . sha1($d);
$meta = $key . ".json";

// A publisher's mark is remembered for a month; a failure only for an hour. Publishers time out and
// rate-limit, and caching a momentary blip for a month would blank that publisher until it expired.
$m = is_file($meta) ? json_decode(@file_get_contents($meta), true) : null;
$fresh = $m && filemtime($meta) > time() - (empty($m["type"]) ? 3600 : 2592000);
if ($fresh) {
  if (!empty($m["type"]) && is_file($key . ".img")) {
    header("Content-Type: " . $m["type"]);
    header("Cache-Control: public, max-age=604800");
    readfile($key . ".img");
    exit;
  }
  refuse();
}

function pull(string $url): ?string {
  if (!preg_match('#^https?://#i', $url)) return null;
  $ctx = stream_context_create(["http" => [
    "timeout" => 6,
    "follow_location" => 1,
    "max_redirects" => 3,
    "header" => "User-Agent: Mozilla/5.0 (compatible; earthpilot-kids/1.0; +https://earthpilot.org/kids/)\r\n",
  ]]);
  $b = @file_get_contents($url, false, $ctx, 0, 262144);
  return ($b === false || $b === "") ? null : $b;
}

// Only real images, identified by their own bytes rather than by what the server claims.
function imageType(?string $b): ?string {
  if ($b === null || strlen($b) < 16) return null;
  if (substr($b, 0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (substr($b, 0, 3) === "\xff\xd8\xff") return "image/jpeg";
  if (substr($b, 0, 6) === "GIF89a" || substr($b, 0, 6) === "GIF87a") return "image/gif";
  if (substr($b, 0, 4) === "\x00\x00\x01\x00") return "image/x-icon";
  if (substr($b, 0, 4) === "RIFF" && substr($b, 8, 4) === "WEBP") return "image/webp";
  if (stripos(substr($b, 0, 400), "<svg") !== false) return "image/svg+xml";
  return null;
}

// PHP's stream wrapper does not follow an apex-to-www redirect, and plenty of publishers only serve
// the icon from www. Try both rather than writing a redirect follower.
$hosts = str_starts_with($d, "www.") ? [$d] : [$d, "www.$d"];

// A publisher's apple-touch-icon is a large PNG made to be seen; favicon.ico is usually 16 pixels of
// mush at this size. So ask the homepage what it has, take the best of it, and only fall back to
// /favicon.ico if the page offers nothing usable.
$candidates = [];
$html = null;
foreach ($hosts as $h) { $html = pull("https://$h/"); if ($html !== null) break; }

if ($html !== null && preg_match_all('/<link\b[^>]*>/i', $html, $tags)) {
  foreach ($tags[0] as $tag) {
    if (!preg_match('/rel=["\']([^"\']*)["\']/i', $tag, $rel)) continue;
    $rel = strtolower($rel[1]);
    if (strpos($rel, "icon") === false) continue;
    if (!preg_match('/href=["\']([^"\']+)["\']/i', $tag, $hm)) continue;

    $href = html_entity_decode($hm[1], ENT_QUOTES, "UTF-8");
    if (str_starts_with($href, "//"))            $href = "https:$href";
    elseif (str_starts_with($href, "/"))         $href = "https://$d$href";
    elseif (!preg_match('#^https?://#i', $href)) $href = "https://$d/$href";

    // never leave the publisher's own site
    $host = strtolower(parse_url($href, PHP_URL_HOST) ?? "");
    if (!$host || ($host !== $d && !str_ends_with($host, "." . $d))) continue;

    // rank: a touch icon first, then the largest declared size, then anything else
    $size = 0;
    if (preg_match('/sizes=["\'](\d+)x/i', $tag, $sz)) $size = (int)$sz[1];
    $rank = (strpos($rel, "apple-touch") !== false ? 1000 : 0) + min($size, 512);
    $candidates[] = [$rank, $href];
  }
}
usort($candidates, fn($a, $b) => $b[0] <=> $a[0]);
foreach ($hosts as $h) $candidates[] = [-1, "https://$h/favicon.ico"];

$body = null; $type = null;
foreach ($candidates as [$rank, $href]) {
  $body = pull($href);
  $type = imageType($body);
  if ($type !== null) break;
}

@file_put_contents($meta, json_encode(["type" => $type, "at" => date("c")]));
if ($type === null) refuse();

@file_put_contents($key . ".img", $body);
header("Content-Type: $type");
header("Cache-Control: public, max-age=604800");
echo $body;
