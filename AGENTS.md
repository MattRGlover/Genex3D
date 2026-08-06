# Project notes

## Running locally

```
python3 -m http.server 8080
```

Then open http://localhost:8080/ — `index.html` is a stub that redirects to
`index3D.html`, the canonical entry point. Do NOT open `index3D.html` via
`file://` or with a trailing slash (`/index3D.html/` 404s on python's server).

## Entry points / active files

- `index3D.html` — canonical entry (2D sketch + Babylon 3D mode)
- `index.html` — redirect stub only
- ONE project for all devices, scaled by viewport: `sketchdesktopreset.js` +
  `babylon3D.js` everywhere. Mobile-specific 3D controls (one-finger drag to
  look, pinch to move) are in `babylon3D.js`. Camera look-around is
  drag-based and stops on release (rotation inertia zeroed on pointerup).
- Shared: `config.js`, `shapes.js`, `audio.js`

Legacy/unused (do not reference): `Reference_code.js`, `ReferenceCode2.js`,
`referencecode3.js`, `referencecode4.js`, `sketchIOS.js`, `sketchIOS2.0.js`,
`sketch-unified.js`, gallery files (`gallery*.js/html`), `background-only.*`.

## 2D background architecture

The sky is a CUBE SKYBOX (`buildSkybox` in `babylon3D.js`): 4 side faces are
adjacent square slices of one horizontally-tileable strip texture
(`bigBgLayer`, 4 x face-size wide; slice order rightward: left [0], front [1],
right [2], back [3]), plus separate top/bottom cap textures (`bgCapTop`/
`bgCapBottom`). Side seams are continuous by construction; every splotch in
the strip is drawn at x and x +/- width for the wrap seam, and splotches keep
an edge margin so cube edges meet on plain paper. No sphere = no pole
stretching. The 2D background is a screenshot of the skybox front face
(camera fov 0.45 looking +Z, `renderSphereBackgroundTo2D`).
`generateWatercolorBackground({guaranteeVisible})` forces 2 splotches inside
the front-face window so at least 2 are always fully visible in the 2D view.

## 3D mode

The "Activate 3D Mode" button enables ~3s after page load (1s init + 2s enable
delay in `babylon3D.js`). The p5 draw loop is never paused (not `noLoop()`'d)
while in 3D - animations keep advancing in real time so 2D doesn't desync on
return. New-shape creation is blocked while `is3DMode` is true and on clicks
inside UI chrome (`isUiEvent()` in `sketchdesktopreset.js`), since p5's global
`mousePressed`/`mouseDragged` otherwise fire on any page click.

## Hamburger menu (desktop only)

Top-left menu button (`#menu-btn`/`#menu-dropdown` in `index3D.html`):
- **Export 3D Model (.OBJ)** — `window.exportSceneToOBJ()` in `babylon3D.js`.
  Exports all artwork meshes (skybox excluded) as a single
  `kandinsky-3d-<timestamp>.zip` containing the matching `.obj` + `.mtl` pair
  (one material per unique flat color) - bundled into one zip via a small
  dependency-free STORE-only zip writer (`buildZip`/`downloadZip`) because
  browsers silently block a page's second auto-triggered download, so two
  separate downloads meant the `.mtl` (all color data) never actually
  reached disk. Unzip, then import the `.obj` into Rhino.
  Axes are remapped so the piece stands upright in Rhino's Front view
  (Rhino Z = Babylon Y "up", Rhino Y = Babylon Z "depth"), with matching
  triangle-winding reversal to keep faces/normals correct. "Open" shapes
  (openRect/openTriangle/openSemiCircle) tag their mesh with the true
  polygon footprint + flat color via `metadata.exportPolygon`/`exportColor`,
  since their live 3D geometry is actually a texture-alpha-cutout plane that
  would otherwise export as a plain rectangle with a guessed color. Enabled
  once `window.isBabylonSceneReady()` is true (3D mode entered at least once).
- **Reset Composition** — `window.resetComposition()` in `sketchdesktopreset.js`.
  The composition no longer auto-resets after `MAX_ELEMENTS` (50) is reached;
  it stays complete on screen until manually reset from this menu.
