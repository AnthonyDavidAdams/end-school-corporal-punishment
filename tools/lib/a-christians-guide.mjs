// "A Christian's Guide to Corporal Punishment": one markdown source (kit/a-christians-guide.md), one HTML
// body shared by the web page (tools/build-site.mjs, inside the site shell) and the print page / PDF
// (tools/kit/a-christians-guide.mjs), plus the closing page on its own for the read-aloud PDF.
// Claim ids cited in parentheses in the source, e.g. "(study-visser-2022-school-meta-analysis)", become
// links to the claim files when every id in the group exists in facts/claims/.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderMd, esc } from "./after-a-paddling.mjs";

export const GUIDE = {
  slug: "a-christians-guide",
  title: "A Christian's Guide to Corporal Punishment",
  kicker: "For pastors, church members, and the believer on a school board",
  description: "The rod verses read honestly in the King James, the fruit test of Hebrews 12:11 and Matthew 7:16 applied to the research, what the churches have said, and a page for the believer on a school board. By a former minister who has worked on this for fifteen years.",
};

const REPO = "https://github.com/AnthonyDavidAdams/end-school-corporal-punishment";

// "(id; id)" -> small linked citations, only when every id is a claim file.
export function linkClaims(html, root) {
  return html.replace(/\(((?:[a-z0-9]+(?:-[a-z0-9]+)+)(?:; [a-z0-9]+(?:-[a-z0-9]+)+)*)\)/g, (m, ids) => {
    const list = ids.split("; ");
    if (!list.every((id) => existsSync(join(root, "facts", "claims", `${id}.md`)))) return m;
    return `<span class="cite">(${list.map((id) => `<a href="${REPO}/blob/main/facts/claims/${id}.md">${esc(id)}</a>`).join("; ")})</span>`;
  });
}

export function loadSource(root) {
  return readFileSync(join(root, "kit", `${GUIDE.slug}.md`), "utf8");
}

// The closing page, between the one-page markers in the source.
export function onePageMd(md) {
  const m = md.match(/<!-- one-page:start -->([\s\S]*?)<!-- one-page:end -->/);
  if (!m) throw new Error("kit/a-christians-guide.md: one-page markers not found");
  return m[1].trim();
}

export function guideBody(root) {
  const md = loadSource(root);
  const body = linkClaims(renderMd(md.replace(/<!-- one-page:(start|end) -->\n?/g, "")), root);
  const onePage = renderMd(onePageMd(md));
  return { ...GUIDE, body, onePage };
}
