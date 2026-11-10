// The one place the shared <head> lives: canonical link, favicon, Open Graph and Twitter Card tags, and
// the ad and analytics tags. build-site.mjs (shell(), the live board, the share page), certificate.mjs
// and kit/build.sh all get their tags from here, so the tag shape is written once and a page cannot
// ship without it.
//
// As a module:   import { metaHead, trackingHead } from "./lib/head.mjs";
// From a shell:  node tools/lib/head.mjs meta --title T --description D --path /kit/ [--type article]
//                    [--image URL] [--social-title T] [--social-description D]
//                node tools/lib/head.mjs tracking
//                node tools/lib/head.mjs inject FILE      (prints FILE with the TRACKING_MARK comment
//                                                          replaced by the tracking tags)
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BASE = "https://earthpilot.org/kids";
export const SITE_NAME = "End School Corporal Punishment";
export const DEFAULT_IMAGE = `${BASE}/assets/og-image.png`;
// A page that is also printed to PDF by headless Chrome carries this comment where the tags will go, and
// the tags are put in only on the copy that is published, so a print run never reports a page view.
export const TRACKING_MARK = "<!--escp:tracking-->";
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The site has no favicon file of its own. The EarthPilot mark already in site/assets (the one in the
// header) is used as the icon, and only if it is there.
const ICON = "assets/earthpilot.png";
export const iconLink = () => existsSync(join(root, "site", ICON)) ? `<link rel="icon" type="image/png" href="/kids/${ICON}">` : "";

// title, description, canonical, icon, Open Graph, Twitter Card. `path` is the page's path under /kids
// with its slashes ("/", "/kit/"). socialTitle and socialDescription are for the pages whose card says
// something other than the browser tab does (a certificate's card names what the district did).
export function metaHead({ title, description, path, image = DEFAULT_IMAGE, type = "website", socialTitle, socialDescription }) {
  const url = `${BASE}${path}`;
  const st = socialTitle || title, sd = socialDescription || description;
  const icon = iconLink();
  return `<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">${icon ? `\n${icon}` : ""}
<meta property="og:title" content="${esc(st)}">
<meta property="og:description" content="${esc(sd)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="${esc(type)}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(st)}">
<meta name="twitter:description" content="${esc(sd)}">
<meta name="twitter:image" content="${esc(image)}">`;
}

// Ad and analytics tags. Ids live in data/site/tracking.json and nowhere else; a tag is written only
// when its id is set, so a site with no ids still builds. Global Privacy Control turns the ad tags off.
const TRACK = (() => { try { return JSON.parse(readFileSync(join(root, "data/site/tracking.json"), "utf8")); } catch { return {}; } })();
export function trackingHead() {
  let h = `<script>window.__escpNoAds = (navigator.globalPrivacyControl === true);</script>\n`;
  if (TRACK.meta_pixel_id) h += `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');if(!window.__escpNoAds){fbq('init','${TRACK.meta_pixel_id}');fbq('track','PageView');}</script>\n`;
  const g = TRACK.ga4_measurement_id || TRACK.google_ads_id;
  if (g) h += `<script async src="https://www.googletagmanager.com/gtag/js?id=${g}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());if(window.__escpNoAds){gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied'})}${TRACK.ga4_measurement_id ? `gtag('config','${TRACK.ga4_measurement_id}');` : ""}${TRACK.google_ads_id ? `gtag('config','${TRACK.google_ads_id}');` : ""}</script>\n`;
  if (TRACK.linkedin_partner_id) h += `<script>if(!window.__escpNoAds){_linkedin_partner_id="${TRACK.linkedin_partner_id}";window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];window._linkedin_data_partner_ids.push(_linkedin_partner_id);(function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}var s=document.getElementsByTagName("script")[0];var b=document.createElement("script");b.type="text/javascript";b.async=true;b.src="https://snap.licdn.com/li.lms-analytics/insight.min.js";s.parentNode.insertBefore(b,s)})(window.lintrk);}</script>\n`;
  // First-party: remember a tagged link (?r=) for the session and log the visit; tell the ad tags who came, by district only
  h += `<script>(function(){try{var q=new URLSearchParams(location.search),r=q.get("r");if(r){localStorage.setItem("escp_r",r);localStorage.setItem("escp_r_at",String(Date.now()))}r=r||localStorage.getItem("escp_r");if(!r&&!/\\/kids\\/board\\//.test(location.pathname))return;var p=location.pathname;navigator.sendBeacon?navigator.sendBeacon("/kids/hit.php",new Blob([new URLSearchParams({r:r||"",p:p})],{type:"application/x-www-form-urlencoded"})):fetch("/kids/hit.php?r="+encodeURIComponent(r||"")+"&p="+encodeURIComponent(p),{keepalive:true});if(r&&window.fbq)fbq("trackCustom","TaggedVisit",{page:p});if(r&&window.gtag)gtag("event","tagged_visit",{page:p});if(r&&window.lintrk)lintrk("track",{conversion_id:"tagged_visit"})}catch(e){}})();</script>\n`;
  return h;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "tracking") process.stdout.write(trackingHead());
  else if (cmd === "inject") process.stdout.write(readFileSync(rest[0], "utf8").replace(TRACKING_MARK, () => trackingHead().trimEnd()));
  else if (cmd === "meta") {
    const o = {};
    for (let i = 0; i < rest.length; i += 2) o[rest[i].replace(/^--/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = rest[i + 1];
    if (!o.title || !o.description || !o.path) { console.error("meta needs --title, --description and --path"); process.exit(2); }
    process.stdout.write(metaHead(o));
  } else { console.error("usage: head.mjs meta|tracking|inject (see the top of this file)"); process.exit(2); }
}
