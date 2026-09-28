# Chat Markdown dependencies

Vendored ESM builds, served locally and available offline. No runtime CDN requests.

- marked 18.0.14: https://registry.npmjs.org/marked/-/marked-18.0.14.tgz (`package/lib/marked.esm.js`). MIT license in marked-LICENSE.md.
- DOMPurify 3.4.16: https://registry.npmjs.org/dompurify/-/dompurify-3.4.16.tgz (`package/dist/purify.es.mjs`). Apache-2.0 or MPL-2.0 license in DOMPurify-LICENSE.

Upstream documentation: https://marked.js.org/ and https://github.com/cure53/DOMPurify

To update, replace each ESM build and license from the pinned package archive, then run the chat rendering and browser regression checks. Keep the parser and sanitizer together: Marked does not sanitize HTML.
