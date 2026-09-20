# Reading district sites that refuse a server fetch

Three patterns account for nearly every district site this project cannot read, and they need
different answers.

## Imperva stub (3,038 bytes)

A plain curl returns a 3,038-byte `text/html` page beginning "Pardon Our Interruption". Simbli sits
behind this, and so do a number of district sites on Apptegy. It is rate-based rather than a
permanent block, so the first answer is to slow down: `fetch_simbli_policy` paces the whole fleet on
one server for exactly this reason, and agents reading Simbli directly from their own browsers are
what produced a fleet-wide block on an earlier run.

## Cloudflare challenge

Same shape, different vendor. Same answer.

## JavaScript-only document lists

ParentSquare/SmartSites, Finalsite and Apptegy build their document lists in the browser, so the page
is real HTML and the links are not in it. `resolve_handbook` knows the common file hosts and finds the
document where the pattern is one it has seen.

## The text proxy, and its limits

`https://r.jina.ai/<url>` returns the rendered static text of a page and reads several sites that
answer a stub to curl -- wmsd.net, valleyviewschools.net, chiltonboe.com and lcscougars.org were all
opened that way during the 2026-09 impact scan. It does not expand a JavaScript accordion, so a
documents page that builds its list on click is still out of reach.

Use it to FIND a document's URL. Then fetch the document itself with `fetch_document`, so the quote is
checked against the copy the server holds and the citation is one anybody can open. An `r.jina.ai`
URL is never the `source` on a record: the source is the document.

Note that this routes the URL through a third party. That is acceptable for a public policy manual and
is not acceptable for anything else.
