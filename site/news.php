<?php
// Cached proxy for Google News RSS. GET news.php?q=<query> -> JSON {items:[{title,link,source,date}]}. Cache 1 hour per query.
header("Content-Type: application/json; charset=utf-8");
header("Cache-Control: public, max-age=900");
$q = trim($_GET["q"] ?? "");
if ($q === "" || strlen($q) > 200) { echo json_encode(["items" => []]); exit; }
$dir = __DIR__ . "/cache"; if (!is_dir($dir)) @mkdir($dir, 0755, true);
$file = "$dir/news-" . md5($q) . ".json";
if (is_file($file) && filemtime($file) > time() - 3600) { readfile($file); exit; }
$url = "https://news.google.com/rss/search?q=" . rawurlencode($q) . "&hl=en-US&gl=US&ceid=US:en";
$ctx = stream_context_create(["http" => ["timeout" => 8, "header" => "User-Agent: Mozilla/5.0 (compatible; earthpilot-kids/1.0)\r\n"]]);
$xml = @file_get_contents($url, false, $ctx);
$items = [];
if ($xml && ($rss = @simplexml_load_string($xml))) {
  foreach ($rss->channel->item as $it) {
    $title = html_entity_decode((string)$it->title, ENT_QUOTES, "UTF-8");
    $source = (string)$it->source;
    if ($source && str_ends_with($title, " - $source")) $title = substr($title, 0, -strlen(" - $source"));
    $items[] = ["title" => $title, "link" => (string)$it->link, "source" => $source, "date" => date("M j, Y", strtotime((string)$it->pubDate))];
    if (count($items) >= 12) break;
  }
}
$out = json_encode(["items" => $items, "fetched" => date("c")]);
if ($items) @file_put_contents($file, $out); elseif (is_file($file)) { readfile($file); exit; }
echo $out;
