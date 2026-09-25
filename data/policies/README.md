# Cached policy documents

The extracted text of every document a record cites, so the record can still be checked when the
document moves.

A school district's handbook is replaced each August at the same address. Within a year a fair share
of the 1,400-odd URLs in this record will serve a different document or none, and a verbatim quote
whose source cannot be fetched is a claim nobody can verify — which is the one thing this project
cannot afford, because the quote is the whole basis of it.

It is also what makes the corpus queryable. The corporal punishment question needed one sentence from
each document. The phone policy, AI policy, restraint and dress code questions need the same documents,
and nobody has to fetch them again.

## What is here

`<state>/<nces_id>.txt.gz` — the extracted text, gzipped. Extracted text rather than the original PDF:
it is a tenth of the size, it is what any later query reads, and the original stays at its URL.

`manifest.json` — one row per cached document: state, district, source URL, path, character count,
SHA-256 of the text, and the date it was cached. The hash is what tells you later whether a document
at the same address is still the same document.

## Reading one

```sh
gunzip -c data/policies/TX/4835550.txt.gz | grep -i -A4 "corporal punishment"
```

```js
import { gunzipSync } from "node:zlib";
const text = gunzipSync(readFileSync("data/policies/TX/4835550.txt.gz")).toString("utf8");
```

## Refresh

```sh
node tools/cache-documents.mjs        # caches anything not already on disk
```

It skips what it has, so re-running after a scan only fetches the new ones. A document that cannot be
read — a scan with no text layer, a dead link, a site behind a challenge — is counted and skipped
rather than written empty; the record still carries the URL and the quote a contributor read.
