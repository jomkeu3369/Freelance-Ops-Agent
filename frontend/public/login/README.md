# Login scene media

## Motion candidate

`pet-path-motion-v1.mp4` is a self-hosted derivative of the delivered Blender-based
pet-path clip. It is 1280×720, H.264/yuv420p, 24 fps, 189 frames (7.875 seconds),
1,750,652 bytes, silent, and faststart-enabled. No runtime generation occurs.
The original 193-frame / 6,110,614-byte input is preserved separately.

Its forward-moving camera has different endpoints. A four-frame (0.167-second)
offline wrap dissolve softens the reset using two intermediate mixed frames;
it remains visibly a reset and is not a geometrically seamless loop. A longer
eight-frame dissolve was rejected because it prolonged overlapping pet shapes.
This is not a 60 fps asset. One native video decoder is sufficient.

`pet-path-motion-poster-v1.webp` is decoded from output frame 0 (source frame 4)
and is 35,266 bytes. It stays behind the video and is shown before playback,
during automatic visibility pauses. Explicit pause, reduced-motion/Save-Data,
autoplay refusal and errors show the original `pet-path-poster-v1.webp` instead.
`pet-path-motion-v1.json` records hashes, inspected metadata, and frame order.

## Previous static concept

`pet-path-poster-v1.webp` preserves the earlier approved static concept,
proportionally optimized to 1600×900 / 113,720 bytes. It is retained as a source
milestone and the explicit paused/static mode; the moving clip uses its own
matching first-frame poster while loading.
