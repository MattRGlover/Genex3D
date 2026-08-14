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
  `babylon3D.js` everywhere. The 3D camera (`camera3D` in `babylon3D.js`) is
  a Babylon `ArcRotateCamera` orbiting a fixed target at the sculpture's
  center. Drag/swipe (Babylon's default pointer input) revolves around the
  target at a constant radius (`panningSensibility = 0` blocks any panning
  drift off-center); mouse wheel zooms via Babylon's own input. Two-finger
  pinch-to-zoom is custom (`pinchTouches` handler in `createBabylonScene`):
  Babylon's built-in pinch is neutralized (`pinchPrecision` set huge) and
  replaced with our own pinch-distance-ratio calculation feeding
  `camera3D.inertialRadiusOffset` - the same accumulator the wheel input
  uses - so pinch settles with the same glide as scroll instead of the
  built-in's disconnected, radius-blind raw-pixel feel. `index3D.html` also
  hard-blocks native page pinch-zoom (`gesturestart`/`gesturechange`/
  multi-touch `touchmove`) since iOS Safari ignores the viewport meta's
  `user-scalable=no` and was zooming the whole page on top of the camera's
  own zoom. `convertShapesTo3D()` re-targets and resets alpha/beta/radius to
  frame the sculpture each time it (re)builds the scene.
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
- **Materials…** — opens the materials picker (same panel as below).
- **Reset Composition** — `window.resetComposition()` in `sketchdesktopreset.js`.
  The composition no longer auto-resets after `MAX_ELEMENTS` (50) is reached;
  it stays complete on screen until manually reset from this menu.

## Base + strut materials

The pedestal and the support struts are the only parts of the piece the 2D
palette doesn't decide, so they're a user choice: **base** = white marble /
black marble / wood, **struts** = black / brass / steel / clear resin (the
last being the look everything had before the picker existed). Defined once
in `babylon3D.js` as `BASE_MATERIAL_OPTIONS` / `STRUT_MATERIAL_OPTIONS` and
read by the UI through `window.getMaterialOptions()`, so the swatches shown
can't drift from what actually gets built. Persisted to `localStorage`
(`kandinsky3d.materials`).

The scene has **no lights at all** (everything is `unlitMat`, emissive-only),
so material identity comes from the surface itself, two different ways:

- Stone/wood get a procedural `DynamicTexture` (`sculptureBaseTexture`) —
  veins as branching random walks, wood as wavy grain plus knots — drawn from
  a **seeded** LCG, not `Math.random`, so the slab is the same physical object
  on every rebuild instead of re-veining itself on each 2D→3D toggle.
- The metals get an emissive **Fresnel** ramp instead of a texture (bright
  facing the camera, dark at the silhouette = a cylinder's own shading). That
  reads right from every angle without depending on `CreateTube`'s UV
  orientation, and costs nothing across the 50+ struts a dense composition
  makes. The ramp *multiplies* the material's own tone, so a build that
  skipped the Fresnel block would still render the correct flat metal colour.

**Only struts that actually land on the base take the chosen strut
material.** Every shape-to-shape brace is hard-wired black regardless of the
picker — the metalwork is what stands the piece up, and a brass rod running
horizontally between two shapes read as part of the artwork rather than as
structure. `drawClearStrut` takes a `grounded` flag threaded down to
`createSolidTube3D`, set per strut (not per segment, so a strut bending
around an obstruction still draws as one consistent rod):

| grounded | site |
| --- | --- |
| yes | `drawBaseStrut`, tripod legs, diagonal face brace, arc-end→base, outrigger |
| no | `drawShapeStrut`, lattice brace, arc-end→nearest shape |

Two separate material instances back this (`sculptureMatCache.strut` /
`.strutBlack`) with their own mesh registries, kept separate even when the
chosen material *is* black — sharing one instance would mean a single
dispose during a refresh invalidated both registries at once. A strut-material
pick refreshes only the grounded set; a lighting change refreshes both.

### Black skeleton wires

Connectors (line/bezier/arcline/spiral, all via `lineTubeAbsolute`) render in
their exact 2D stroke colour, unlit — *except* the black ones, which are
blackened metal. The sketch's default connector colour is `color(0, 0, 15,
0.8)` in HSL, i.e. a neutral 15% grey; `isBlackWireColor` catches anything
both dark (max channel ≤ 0.30) and neutral (channel spread ≤ 0.06), so a dark
*saturated* palette colour stays as drawn — a deep navy line is a drawn
colour, not metalwork.

`applyMetalFinish` is shared by the struts and these wires so all the metal
reads as one family, but the wire ramp is deliberately gentler (`hi` 1.70 vs
the struts' 2.30). A thin wire shows the camera almost nothing but facing
normals — the grazing silhouette that keeps a fat rod dark is a pixel or two
wide — so the strut ramp would light the full visible width and turn every
black line mid-grey (`#4f4f59`), washing out the drawing. The wire ramp lands
at `#3b3b42` facing, `#0a0a0c` grazing, against the `#262626` flat it
replaced.

Materials are cached per **alpha** (`blackWireMats`), since the sketch uses
0.8 for most connectors and 0.6 for others and that translucency is part of
the drawing's weight — preserved rather than forced opaque.

Note lattices deliberately never get a direct-to-base strut
(`drawBaseStrut` returns early for them) — "lattices are only supported by
horizontal braces from other shapes behind them… the idea is that they appear
to be floating."

Black marble is the one case that overrides the file's universal black
outline (`outline` on the option) — black-on-black erased the slab's
silhouette and bevel entirely.

`window.setSculptureMaterials({base, strut})` swaps materials **live, with no
scene rebuild** — `baseSurfaceMeshes`/`baseOutlineMeshes`/`strutShellMeshes`
hold the meshes to re-point, and `resetSculptureMaterialRegistry()` (called
from `convertShapesTo3D`'s teardown) drops the handles the mesh disposal
already invalidated. One shared material per surface class, not one per mesh.
Note the COG/stability analysis still uses `DENSITY_WOOD` for the base
whatever material is picked — strut layout is computed at build time, so
tying density to the choice would leave a live swap inconsistent with the
struts already drawn.

## Spotlight mode

`window.setSpotlightMode(on)` / `getSpotlightMode()`. Picked in the same
panel as the materials ("Lighting": Daylight / Spotlight). Four things move
together, and the separation comes from the combination — no one of them does
it alone:

1. A fixed three-point gallery rig (`buildSpotlightRig`): warm key high
   front-left, hemispheric fill so nothing goes pure black as you orbit, cool
   rim from +Z (behind the piece at the default camera angle) to draw a
   bright edge along the base's silhouette.
2. Base + strut materials switch to **lit** (`disableLighting = false`). They
   are the *only* things the rig touches — every artwork material already
   sets `disableLighting` itself, so the shapes ignore the lights and their
   exact 2D colours survive. **That pre-existing flag is what makes dropping
   a real light rig into this scene safe at all.**
3. The skybox is dimmed to `SPOTLIGHT_SKY_DIM` via the shared texture's
   `level` (one texture object fills both the diffuse and emissive slot on a
   sky face), with `clearColor` scaled to match or the face seams light up.
   This is the biggest single lever — the piece is translucent mid-tone
   against a bright paper wash, and dropping the background is what actually
   makes it step forward.
4. Contrast + vignette via `scene.imageProcessingConfiguration`.

In the lit branch the base gives up its **emissive** texture slot — leaving
the texture there would add the slab's full brightness back on top of the
shading and flatten the modelling the rig exists to create; a small flat
`emissiveColor` stands in as an ambient floor. Struts keep their Fresnel ramp
in both modes, but under lighting it only modulates that dimmed floor.
`twoSidedLighting` is on for both: the base's sides are a DOUBLESIDE ribbon
whose normal direction depends on ring winding, and `unlitMat` leaves back-
face culling off.

Toggling is fully live — `refreshSculptureSurfaces()` rebuilds the two
materials and re-points the registered meshes; no geometry is rebuilt.
`syncSpotlightEnvironment()` is idempotent and re-runs from
`convertShapesTo3D` so a restored preference survives every rebuild. Note
`renderSphereBackgroundTo2D` builds its **own** engine, scene and skybox, so
sky dimming can never leak into the 2D background screenshot.

## The materials & light panel

One panel hosts both of the above (wizard step `data-step="2"`), reachable
three ways: step 3 of the setup wizard, the **swatchbook button**
(`#material-btn`, mirrored opposite the palette button around the 2D/3D
toggle — it appears in 3D exactly where the palette button drops out), and
the hamburger menu. Unlike the palette panel it deliberately does *not* call
`beginUserSetup()`: none of these affect what the 2D sketch draws, and only
`applyUserSettings`/`changePaletteFromHere` ever clear that pause flag — so
pausing here would leave drawing stopped with nothing to restart it.

## Bottom bar

Three satellite buttons flank the 2D/3D toggle, sharing one CSS rule (they
differ only in side and mode). Two slots, mode-dependent:

| slot | 2D | 3D |
| --- | --- | --- |
| left (−66px, −74 on touch) | `#refresh-btn` — new composition | `#material-btn` — materials & light |
| right (+30px) | `#palette-btn` — change palette | *(empty — palette can't affect 3D)* |

So 2D reads `[refresh] [3D] [palette]`, symmetric with an 8px gap either side
of the toggle. `#refresh-btn` calls the same `window.resetComposition()` the
desktop menu's "Reset Composition" does; that function guards its own
re-entry, and the fade-to-black is its own feedback, so the button needs no
disabled state or spinner.

**On touch** the hamburger is hidden (`.desktop-only`), so these buttons plus
the wizard's step 3 are the *only* routes to materials, palette and reset —
which is why each one exists. Mobile specifics that bit and are now handled:

- `#palette-toast` is a **sibling** of `#controls`, so it wasn't in
  `isUiEvent`'s selector list — tapping the toast fell through to p5 and
  started a shape behind the panel it opened. It's listed now.
- `#setup-overlay` uses `align-items: flex-start` + `margin: auto` on the
  panel, not `align-items: center`. A centred flex item taller than a
  scrolling container overflows in *both* directions and its top becomes
  unreachable; landscape phones hit that once the panel grew a third step.
- The strut row goes 2×2 under 520px. Four across leaves ~56px of label room
  and "Clear resin" needs ~63px, so `nowrap` labels overlapped.
- `@media (pointer: coarse)` takes the palette/material buttons to 44px with
  offsets adjusted to hold the same 8px gap either side of the mode toggle.

Base and strut swatches come from babylon3D.js via
`window.getMaterialOptions()` so they can't drift from what gets built; the
two lighting swatches are defined in the HTML (`LIGHT_OPTIONS`), since
lighting isn't a material and has no option table there.
