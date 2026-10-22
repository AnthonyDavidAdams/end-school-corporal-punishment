# BoardPolicyOnline (boardpolicyonline.com)

MicroScribe's BoardPolicyOnline carries board policy for most North Carolina districts and for the
South Carolina districts on SCSBA's Policies Online. `fetch_boardpolicyonline_policy` reads it
(`crew/readers/boardpolicyonline.mjs`).

## Why a plain fetch gets nothing

The legacy host `boardpolicyonline.com` resets the TLS connection for curl and for Node. The current
site, `v3.boardpolicyonline.com`, is a Blazor Server app: the HTML is a shell, and the policy text
arrives over a SignalR connection as binary render batches. There is no JSON API behind it to call.

## How the reader works

It speaks the same protocol the page does, over SignalR long polling (plain HTTP, so it runs on a
server with `fetch` and no browser):

1. `GET /b/<key>/s/<section>` for the shell, and the `<!--Blazor:...-->` component markers in it.
2. `POST /_blazor/negotiate`, then the `blazorpack` handshake and `StartCircuit` with those markers.
3. Answer the JavaScript calls the app makes on load (time zone, media queries, touch support); left
   unanswered, the app shows "An unknown error occurred" and serves nothing.
4. Acknowledge every render batch, and read the policy out of the markup frame containing
   `id="policy-content-title"`.

A search is the app's own: `LoadSearch(query)` on the page's .NET helper, then a click on each result
in the Telerik tree, with the displayed section id read from the `hfRestoreActiveSectionId` field.

A section read takes five to seven seconds; a search takes about thirty. Circuits are run one at a
time per server.

## Keys and dates

The board key is the `b=` value or the `/b/<key>/` part of the district's link: `greene`, `warren`,
`florence`, `hampton_consolidated`, `clarendon_county`. The reader cites
`https://v3.boardpolicyonline.com/b/<key>/s/<section>`, which opens the policy in a browser.

Titles and dates are printed in the policy itself and the two states print them differently:

| | Title | Dates |
|---|---|---|
| NC | `Policy Code: 4300 Student Code of Conduct` | `Adopted: July 19, 2010` / `Revised: August 8, 2011 ...` |
| SC | `Policy JKA Corporal Punishment` | `Issued 10/23`, then `Adopted 10/3/23; Revised ...`, sometimes month-only (`Adopted 11/06`) |

SC's `Issued` is the SCSBA model's issue stamp, not a board action.
