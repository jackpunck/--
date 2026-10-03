# Local MediaPipe assets

These unmodified files ship with the app so video analysis makes no requests to an external CDN or model service. The npm JavaScript and both SIMD/non-SIMD WASM builds are pinned to `@mediapipe/tasks-vision@0.10.32`. High precision (the default) uses Google's `pose_landmarker_heavy/float16/1` (30,664,242 bytes); standard uses `pose_landmarker_full/float16/1`. Both versions are pinned in the manifest, served by this app and cached on demand. Inference uses the user's browser CPU/GPU; the server only serves assets.

`manifest.json` records upstream URLs, npm SHA-512 integrity, and SHA-256 for every shipped runtime/model/license asset. Run `node scripts/setup-motion-assets.mjs --verify` to verify without network access, or run without `--verify` to restore missing/corrupt files from the recorded sources. An upstream checksum mismatch fails rather than silently upgrading assets.

The package and model use Apache-2.0. See `LICENSE` for upstream terms and notices, and page 2 of `MODEL_CARD.pdf` for the model's license and limitations. The model estimates 33 landmarks from monocular images; it does not provide metric-accurate depth or a validated exercise-quality score.

The JavaScript API is imported into a **classic** dedicated worker because the pinned WASM loader calls `importScripts`. Inference never runs on the main UI thread. The application first tries the GPU delegate and creates a fresh worker with the CPU delegate if GPU initialization fails. Current Chrome/Edge with OffscreenCanvas and WebGL are the initial target; a CPU delegate still requires the runtime's image-processing capabilities.

The pinned JavaScript API returns `visibility` for each landmark but does not expose a separate `presence` probability. The frame contract preserves `presence: null` in that case; it must not be treated as a model confidence value.

Both modes sample 15 positions per second. The VIDEO instance considers up to four people; a separate IMAGE instance of the same selected model analyzes the target crop every frame and checks side regions every 0.5 seconds. The subject tracker selects the central or user-selected person and marks uncertain frames lost or ambiguous. Sampled discovery cannot guarantee detection of every brief entrance or heavily occluded person. Model selection survives GPU-to-CPU and decoder fallbacks, and `modelVersion` identifies the selected model in the complete AI pose payload. Changing modes clears current observations and requires a new analysis.

Heavy increases model capacity, download size and inference cost. Google's legacy pose benchmark reports better landmark accuracy than Full, but this is not a measured improvement in this app's exercise identification or form verdicts. Those still depend on the configured AI, image evidence and recording conditions. Do not describe complete frame coverage or higher confidence as ground-truth accuracy. See the [official model guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker) and [benchmark scope](https://chuoling.github.io/mediapipe/solutions/pose.html#pose-estimation-quality).

Supported MP4 tracks use native WebCodecs sequential decoding inside the pose worker; see `../mp4box/README.md`. Other videos use the browser's HTMLVideo decoder and seek every 1/15 second across the full clip. This fallback transfers one resized ImageBitmap at a time (long edge at most 960 pixels), while prefetching the next frame during worker inference. At most two bitmaps are held. Both paths preserve sampling coverage even when inference is slower than playback. Analysis may take longer than the original video. Codec availability, especially HEVC MOV, varies by browser/OS. No decoding/conversion service is included. The returned `timing` fields distinguish model initialization, decoding/resizing, and worker inference; fallback decoding and inference overlap, so their sum is not wall time.

Required server headers: `.wasm` as `application/wasm`, `.mjs/.js` as JavaScript, `.task` as binary. CSP must permit same-origin scripts/workers/connect requests, `script-src 'wasm-unsafe-eval'`, and `media-src blob:` for the user's local video.

Official documentation: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js

Official worker example (newer versions may differ): https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/workers/pose-landmarker.worker.ts
