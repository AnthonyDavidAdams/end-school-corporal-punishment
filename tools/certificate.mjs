// Builds one recognition certificate per district that has prohibited corporal punishment, as a
// self-contained printable page. Exported for build-site.mjs.
//
// The certificate is the campaign's only piece of good news and its credibility is the whole point, so
// it says only what the record can support:
//   - it names the policy and quotes it, with the link, so a superintendent can check it in one click;
//   - it gives the date the board acted only where the policy itself prints one;
//   - it says what EarthPilot is (a project, not an accrediting body) rather than implying a standing
//     nobody granted us;
//   - it never says "you stopped" to a district whose prohibition predates the federal filing it is
//     being congratulated over. Lubbock ISD removed corporal punishment in 2020 and still filed two
//     students for 2023-24; the honest sentence there is about 2020.
export const certifiable = (d) => d.status === "bans" && d.source && d.quote;

const fmt = (iso) => {
  if (!iso) return null;
  const [y, m, day] = iso.split("-").map(Number);
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${MONTHS[m - 1]} ${day}, ${y}`;
};

export function certificateHtml({ d, stateName, esc, n, base }) {
  const acted = d.policy_revised || d.policy_adopted || null;
  const year = acted ? Number(acted.slice(0, 4)) : null;
  // The 2023-24 collection covers a school year that ends in late May or June 2024, so a policy dated
  // from June 2024 onward post-dates the conduct being reported. Pike County revised its ban on
  // 17 June 2024, after the year in which it reported 252 students struck, and a later cutoff put it
  // on the wrong side of this line.
  const changedSince = year !== null && acted >= "2024-06-01";
  const struck = d.crdc_students_latest > 0 ? d.crdc_students_latest : null;

  const line = changedSince && struck
    ? `In the 2023-24 school year this district reported to the United States Department of Education that ${n(struck)} of its students had been struck. On ${fmt(acted)} its board adopted the policy below, and that will not happen again.`
    : changedSince
      ? `On ${fmt(acted)} this district's board adopted the policy below, ending the use of corporal punishment in its schools.`
      : acted
        ? `This district's board has prohibited corporal punishment in its schools since ${fmt(acted)}.`
        : `This district's board prohibits corporal punishment in its schools.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.name)}: certificate of recognition</title>
<meta name="description" content="${esc(d.name)}, ${esc(stateName)} prohibits corporal punishment in its schools. Recognition from EarthPilot's End School Corporal Punishment project.">
<meta property="og:title" content="${esc(d.name)} prohibits corporal punishment">
<meta property="og:description" content="${esc(line)}">
<meta property="og:image" content="${base}/assets/og-image.png">
<meta property="og:url" content="${base}/stopped/${d.code.toLowerCase()}-${d.slug}/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="End School Corporal Punishment">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(d.name)} prohibits corporal punishment">
<meta name="twitter:description" content="${esc(line)}">
<meta name="twitter:image" content="${base}/assets/og-image.png">
<style>
  :root { --ink:#0D132D; --green:#2D6A4F; --rule:#C9A227; --paper:#FCFBF7; }
  * { box-sizing:border-box; }
  body { margin:0; background:#E9E7E0; color:var(--ink);
         font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif; }
  /* The gold frame is drawn at 0.3in inset, so the content has to clear it or the footer prints over
     the rule -- which it did on the first pass. */
  .sheet { background:var(--paper); width:11in; height:8.5in; margin:24px auto; padding:0.72in 0.85in;
           box-shadow:0 2px 24px rgba(0,0,0,.18); position:relative; display:flex; flex-direction:column; }
  .sheet::before { content:""; position:absolute; inset:0.3in; border:2px solid var(--rule);
                   border-radius:2px; pointer-events:none; }
  .sheet::after { content:""; position:absolute; inset:0.36in; border:1px solid var(--rule); opacity:.5;
                  border-radius:2px; pointer-events:none; }
  .inner { position:relative; z-index:1; display:flex; flex-direction:column; height:100%; text-align:center; }
  .issuer { letter-spacing:.22em; text-transform:uppercase; font-size:11px; color:var(--green); font-weight:700;
            font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
  .issuer span { display:block; letter-spacing:.1em; color:var(--ink); opacity:.6; font-weight:600; margin-top:3px; }
  h1 { font-size:20px; letter-spacing:.32em; text-transform:uppercase; margin:22px 0 4px; font-weight:400; }
  .rule { width:120px; height:2px; background:var(--rule); margin:10px auto 18px; }
  .district { font-size:40px; line-height:1.1; margin:0 0 2px; font-weight:600; }
  .place { font-size:15px; opacity:.65; margin-bottom:18px; }
  .lede { font-size:15.5px; line-height:1.6; max-width:7.4in; margin:0 auto 16px; }
  blockquote { margin:0 auto; max-width:7.2in; font-size:13.5px; line-height:1.55; font-style:italic;
               border-left:3px solid var(--green); padding:2px 0 2px 14px; text-align:left; }
  blockquote cite { display:block; font-style:normal; font-size:11.5px; opacity:.6; margin-top:6px; }
  /* The body sits in the optical centre and the footer sits under it, rather than the footer being
     shoved to the bottom edge and leaving a hole in the middle of the page. */
  .body { margin:auto 0; }
  .foot { margin-top:0.5in; display:flex; align-items:flex-end; justify-content:space-between; gap:20px;
          font-size:11px; font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
  .foot div { text-align:left; }
  .foot .sig { border-top:1px solid var(--ink); padding-top:5px; min-width:2.6in; opacity:.75; }
  .foot a { color:var(--green); }
  .note { font-size:10.5px; opacity:.55; text-align:left; line-height:1.45; max-width:4.6in; }
  .actions { text-align:center; margin:0 0 30px;
             font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
  .actions button, .actions a { font:inherit; font-size:14px; padding:9px 18px; margin:0 4px; cursor:pointer;
             border:1px solid var(--ink); background:var(--ink); color:#fff; border-radius:5px;
             text-decoration:none; display:inline-block; }
  .actions a { background:transparent; color:var(--ink); }
  /* Screen only. Headless Chrome lays out at an 800px viewport before it prints, so an unscoped
     max-width rule here wins over the print rules and the footer lands outside the gold frame -- which
     is exactly what the first proof did. */
  @media screen and (max-width:1180px) { .sheet { width:100%; height:auto; min-height:0; padding:28px 22px 30px; }
    .district { font-size:30px; } h1 { font-size:16px; } }
  @page { size:letter landscape; margin:0; }
  @media print { body { background:#fff; } .actions { display:none; }
    .sheet { width:11in; height:8.5in; margin:0; box-shadow:none; } }
</style>
</head>
<body>
<div class="sheet"><div class="inner">
  <div class="issuer">EarthPilot<span>End School Corporal Punishment</span></div>
  <h1>Certificate of Recognition</h1>
  <div class="rule"></div>
  <div class="body">
  <p class="district">${esc(d.name)}</p>
  <p class="place">${esc(stateName)}</p>
  <p class="lede">${esc(line)}</p>
  <blockquote>${esc(d.quote)}
    <cite>${d.policy_code && d.policy_code.length <= 24 ? `Policy ${esc(d.policy_code)} &middot; ` : ""}Read from the district's own published policy on ${esc(d.last_verified || "")}</cite>
  </blockquote>
  </div>
  <div class="foot">
    <div class="note">Issued by EarthPilot, an independent project that keeps a public record of which
      United States school districts permit corporal punishment. This is recognition, not an
      accreditation, and it is granted on the district's own published policy, which anyone can check:
      <a href="${esc(d.source)}">the policy as read</a>. If any of it is wrong, write to us and we will
      correct the public record.</div>
    <div class="sig">${base.replace(/^https?:\/\//, "")}/stopped/</div>
  </div>
</div></div>
<div class="actions">
  <button onclick="window.print()">Download or print this certificate</button>
  <a href="/kids/stopped/">All districts that stopped</a>
</div>
</body>
</html>`;
}
