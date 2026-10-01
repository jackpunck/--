# Browser dependencies

Vendored ESM builds, served locally and available offline. No runtime CDN requests.

- marked 18.0.14: https://registry.npmjs.org/marked/-/marked-18.0.14.tgz (`package/lib/marked.esm.js`). MIT license in marked-LICENSE.md.
- DOMPurify 3.4.16: https://registry.npmjs.org/dompurify/-/dompurify-3.4.16.tgz (`package/dist/purify.es.mjs`). Apache-2.0 or MPL-2.0 license in DOMPurify-LICENSE.

Upstream documentation: https://marked.js.org/ and https://github.com/cure53/DOMPurify

To update, replace each ESM build and license from the pinned package archive, then run the chat rendering and browser regression checks. Keep the parser and sanitizer together: Marked does not sanitize HTML.

## Landing page motion

- GSAP and ScrollTrigger 3.15.0: unmodified `package/dist/gsap.min.js` and `package/dist/ScrollTrigger.min.js` from https://registry.npmjs.org/gsap/-/gsap-3.15.0.tgz. Copyright and license notices are retained in both files. License: https://gsap.com/standard-license.
- Three.js 0.186.0: `three.module.js` and `three.core.js` copied from the project's installed Three.js package; MIT license in `three-LICENSE.txt`. The homepage builds its articulated geometry and neon shaders locally in `landing-scene.js`.
- Cabinet Grotesk 400 and 700: WOFF2 files in `public/assets/fonts`, retrieved from Fontshare's CSS API on 2026-10-02. Source: https://www.fontshare.com/fonts/cabinet-grotesk. License: https://www.fontshare.com/licenses/itf-ffl. Chinese text uses the device's Chinese font fallback.

These files are served locally and included in the offline shell. Landing page animations use a scoped GSAP matchMedia context, reverted on pause, reduced motion, and authentication. Run `scripts/qa-landing.mjs` after updates.
