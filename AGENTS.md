# Project notes

## Running locally

```
python3 devserver.py 8080
```

Use this rather than `python3 -m http.server`: the stdlib server sends **no
cache headers at all** and answers `If-Modified-Since` with a 304, so Safari —
especially on iOS, where there is no hard-reload gesture — serves a stale
`babylon3D.js` indefinitely. That makes "did my fix work?" unanswerable: an
ordinary reload returns the OLD code and the symptom looks unchanged.
`devserver.py` sends `no-store` and strips conditional request headers in
`send_head()` (both `do_GET` and `do_HEAD` funnel through it), so every reload
fetches fresh files.

Testing on a phone: same Wi-Fi, then `http://<your-mac-lan-ip>:8080/`
(`ipconfig getifaddr en0`). Each exporter logs a build stamp to the console
when you tap AR — if it doesn't match the latest change, you're on cached JS.

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
  `genex-3d-<timestamp>.zip` containing the matching `.obj` + `.mtl` pair
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

## Welcome / front door

`#welcome-overlay` shows before anything else (the setup overlay now starts
`hidden`). Two routes:

- **Get Started** → `startCurated(false)`: commits `applyUserSettings({artist:
  false, paletteIndex: null, shapeTypes: null})` and gets out of the way.
  `paletteIndex: null` means a fresh palette per composition — that *is* the
  curated default, being the untouched classic behaviour; locking a
  first-time visitor to one palette is the worse failure.
- **Advanced Mode** → `openUserSetup()`, the existing three-step wizard.
- **"Surprise me" checkbox** modifies Get Started *only* (Advanced is the
  user choosing each of these by hand, so randomising there is
  contradictory — the label says so explicitly). Randomises base + strut
  material, spotlight on/off, and features a random 3–6 shape types.

It's deliberately a **separate overlay, not a wizard step** — it's a fork in
the road rather than a stage of one journey, and keeping it out leaves the
step machinery (bounds, dots, back/next labels) untouched. `z-index: 320`
sits above the setup overlay's 300, and it uses the same
`align-items: flex-start` + `margin: auto` fix against the landscape
overflow trap.

The menu's **New Composition…** routes through `window.openWelcome()` rather
than straight to the wizard, so a returning user gets the quick path too.
Like the wizard it has no cancel — it calls `beginUserSetup()` to pause
drawing, and only `applyUserSettings` clears that flag.

Step 2's palette strip has **both** `#strip-prev` and `#strip-cycle`. The
cycle ring is ordered (candidates → surprise me → artist's palette), so
stepping −1 lands exactly where you just were — cycling past the palette you
liked with no way back was the reason it needed a partner button.

## The materials & light panel

One panel hosts both of the above (wizard step `data-step="2"`), reachable
three ways: step 3 of the setup wizard, the **swatchbook button**
(`#material-btn`, mirrored opposite the palette button around the 2D/3D
toggle — it appears in 3D exactly where the palette button drops out), and
the hamburger menu. Unlike the palette panel it deliberately does *not* call
`beginUserSetup()`: none of these affect what the 2D sketch draws, and only
`applyUserSettings`/`changePaletteFromHere` ever clear that pause flag — so
pausing here would leave drawing stopped with nothing to restart it.

## AR (iOS only)

**iOS Safari has no WebXR at all**, so in-page AR is impossible on iPhone.
The only route is Apple's **AR Quick Look**: hand it a `.usdz` and the system
viewer does surface detection, placement and scaling natively.

- `window.isARQuickLookSupported()` — `a.relList.supports('ar')`, the
  canonical detection. True on iOS Safari, false everywhere else. It sets
  `body.ar-capable`, which is what reveals `#ar-btn`. **Never sniff the user
  agent for this.**
- `window.buildSculptureUSDZ()` → Blob. `window.launchAR()` hands it over.
- The anchor **must contain an `<img>`** or Safari navigates to the file
  instead of opening AR. The blob URL is revoked after 15s, not immediately —
  Quick Look reads it asynchronously.

A `.usdz` is an **uncompressed zip** holding an ASCII `.usda` (Quick Look
accepts ASCII, so no binary crate writer needed). `buildZip` gained
`alignDataTo` for this: USDZ requires every file's data to start on a 64-byte
boundary, and the local header's extra field is the only legal place to put
the padding. The `.usda` must be the archive's **first** entry.

Geometry reuses the OBJ exporter's machinery via the shared
`collectExportMeshes()`, including the `exportPolygon` substitution for open
shapes. Two conversions matter:

- **Handedness.** Babylon's scene is left-handed, USD is right-handed Y-up, so
  Z is negated. **Winding is then decided PER MESH from its own signed
  volume** (`windingIsOutward`), not by a global rule — because the file mixes
  two conventions and no single rule is right for both:
  - `extrudePrism` builds `DOUBLESIDE`: both windings in one mesh. Its halves
    cancel to ~zero volume, and it renders correctly either way. Triangles,
    semiCircles and lattice cells are therefore immune and can never reveal a
    mistake.
  - `CreateBox` / `CreateCylinder` default to `FRONTSIDE`, a single winding.
    Inverted, a closed prism shows its far interior wall through a missing
    near face — it reads as **an open bowl that changes as you move**. Rects,
    circles, concentric and halo rings were the only shapes that could show it.

  The volume is measured about each mesh's **own centre**, which is not
  optional: the formula sums tetrahedra from the origin, so a flat sheet away
  from the origin returns the volume of the pyramid beneath it — a confident,
  meaningless sign. Centred, a flat sheet correctly returns zero and is left
  alone. Without that the base's flat ground caps would be "corrected" and the
  slab would break open again.
  **Winding is passed through unchanged** — one flip fewer than it looks like
  it needs. Babylon is left-handed with clockwise-front (the DirectX
  convention), so negating Z already mirrors it into USD's counter-clockwise
  front. Reversing on top of that turned every face inward. The base is what
  proved it: its sides are a DOUBLESIDE ribbon carrying both windings (right
  either way), while its caps are single-sided grounds — so the slab rendered
  as an open white tray with a black interior, the only part of the model
  that could show the error. **Note the OBJ exporter uses a different remap
  (x, z, y) and does reverse; don't "fix" one to match the other.**
- **No explicit normals — deliberately.** The Z negation mirrors the
  geometry, so winding *and* normals both have to flip to stay in agreement.
  When they disagreed, faces lit as though pointing the wrong way: the base's
  top cap read as an open hole and individual shapes shaded patchily face to
  face. Letting USD derive normals from the winding makes the winding the one
  source of truth — which is what the proven OBJ path already does (it writes
  no `vn` either). Flat shading is the cost, and it's the right cost: every
  material here is unlit and flat on screen anyway.
- **Framing.** The piece is scaled so its longest dimension is
  `USDZ_TARGET_SIZE_M` (0.32 m, desk-sized), centred on X/Z, and its lowest
  point dropped to y=0 so Quick Look seats it on the surface.

Three USDA details that are **not optional**, each of which fails quietly:

- `prepend apiSchemas = ["MaterialBindingAPI"]` on every Mesh. Without it a
  strict consumer ignores `rel material:binding` outright and renders the
  whole model default grey.
- `uniform bool doubleSided = true`, not `= 1` — `1` is int-typed to a strict
  USDA parser.
- Per-mesh `extent`. Handing every prim the whole model's bounds makes a
  renderer's culling and bounds maths lie.

**Translucent bodies are only possible because the specular lobe is
suppressed.** A dielectric in `UsdPreviewSurface` carries an F0 reflection
derived from `ior` (1.5 → ~4%), which RealityKit lights with environment IBL.
On an opaque surface that's a pleasant sheen; on a *translucent* one it lands
on top of everything showing through and whitens the whole body — which is why
vivid colours came back as pastel the first time, **even against a dark
background** (that's the observation that ruled out background bleed-through
and identified the real cause). Translucent non-metals therefore emit
`useSpecularWorkflow = 1`, `specularColor = (0,0,0)`, `ior = 1`. Applied only
there: struts and wires need the metallic workflow (catching real room light
is the point of brass), and the opaque base isn't at risk.

### Translucency is BLENDED, at the app's own alpha

Bodies emit scalar `inputs:opacity = 0.6` — the same number as the app's
`BODY_ALPHA_3D` — so a shape's full volume reads as it does on screen: front,
back and side walls all visible through each other.

Why plain blending is safe *now* when it failed before: alpha blending is only
order-dependent when the stacked layers have **different colours**, and a
renderer never sorts the triangles inside one mesh. A body blending with
*itself* — front wall over back wall, same unlit colour, same alpha —
composites identically in either order. The app relies on exactly this
(Babylon doesn't sort intra-mesh triangles either). Every earlier
"translucency looks broken" had a different, since-fixed cause that made the
two walls *different*: PBR lit them by orientation, specular IBL whitened
whatever faced the room, inverted winding removed one of them, and an opacity
wired to a texture killed depth writes. With bodies unlit, specular dead and
winding per-mesh, the commutativity argument holds.

- The ramp texture's RGB is **premultiplied by the body alpha** (`C*a`), and
  its alpha channel is unused. The ghost-plane episode proved this renderer
  composites emission without scaling it by opacity, so correct "over"
  compositing must be built into the colour. Too dim on device → raise the
  premultiply factor in `buildRampCanvas`, don't touch opacity.
- **Every translucent body ships BOTH windings** (a reversed twin per
  triangle, added in `collectUsdParts`; meshes where `windingIsOutward`
  returns null are flat or already doubled and are skipped). Forced by
  observation: opaque single-winding meshes (the black outline tubes) render
  correctly from every angle, but on the BLENDED pass single-winding faces
  showed only from the far side — "front from the back, back from the front"
  — i.e. RealityKit's transparent pass draws one side per surface,
  `doubleSided = true` notwithstanding, and not the side the opaque rules
  predict. Shipping both windings makes every face drawable from every
  viewpoint no matter which side that pass culls.
- Residual limit: where two *different*-coloured bodies overlap, per-mesh sort
  order can pick wrong at oblique angles — the app has the same ambiguity.
- The **dither cutout fallback** (`USDZ_DITHER`, off) remains: alpha-masked,
  depth-correct, order-independent — rejected as default because the Bayer
  pattern read as grain/noise at phone distance. Its machinery
  (`buildDitherCanvas`, `primvars:st1`, `USDZ_DITHER_CELLS_PER_M`) only
  activates when the flag is true.

**Never wire `opacity` to a texture on an opaque surface.** Connecting it marks
the material TRANSPARENT, and that classification is made from the *wiring*,
not from the values — so a ramp whose every texel is alpha 1.0 still lands in
the blended queue, where it **stops writing depth**. Nothing occludes anything
and you see straight through a solid shape to its own far wall: *"we only see
the colour of the right side from the right, the backside from the front."*
Fully opaque bodies (and the base) therefore emit a scalar
`float inputs:opacity = 1` and leave the texture's alpha channel unconnected;
only genuinely translucent bodies connect it.

**Opacity is UNIFORM (`USDZ_CORE_OPACITY` = `USDZ_RIM_OPACITY` = 1), and this
is a correction worth recording.** Fading alpha with distance-from-centre was
tried as a stand-in for Beer–Lambert absorption — core opaque, rim glassy — on
the reasoning that a shape is thick through its middle and thin at its edges.
That is true of a chunky body and **false of a flat plate**, and this piece is
mostly flat plates: a thin slab is nearly all "far from centre", so the
falloff ate most of every face and left a complete black outline around a fill
that stopped short of it. Open shapes, the flattest things in the piece,
vanished almost entirely — *"shape faces are not complete, open shapes are
empty."*

The same trap applies to the **colour** ramp, which is why
`USDZ_GRADIENT_STRENGTH` is 0.35 with a broad `USDZ_GRADIENT_CORE` plateau of
0.55: a strong ramp starting early bleaches the majority of every flat face
and reads as an unfinished fill rather than as depth. **Any field that varies
with distance-from-centre must stay gentle here.**

**Opacity is otherwise deliberately not faithful, and deliberately uniform.** On screen
bodies are 60% opaque so you can read the layering through them; in AR that
same stack of 50+ translucent meshes must be depth-sorted in real time and
the result is mush. Every body gets the *same* `USDZ_BODY_OPACITY` (0.88) so
they read as one material rather than a jumble. Anything at or above
`USDZ_OPAQUE_ABOVE` (outlines, struts, the base) stays solid; anything at or
under `USDZ_GLASS_BELOW` (0.25) — the clear-resin strut option,
concentricArc's wedge — keeps its transparency, since it would read as an
ugly solid otherwise.

### Artwork bodies are exported UNLIT (`USDZ_UNLIT_BODIES`)

**This is the single most important thing in the export, and it was learned
the hard way.** The artwork is drawn unlit on screen (`unlitMat`:
`emissiveColor` set, `diffuseColor` black, `disableLighting` true), so a
surface shows its exact colour from every angle. `UsdPreviewSurface` is PBR.
Essentially every defect this export ever had traces to that one mismatch:

| symptom | actually was |
| --- | --- |
| colour washed to pastel | specular IBL over a translucent surface |
| colour only on some faces, "based on perspective" | diffuse shading by face orientation |
| shapes reading hollow / faces incomplete | attempts to fake volume through alpha |

Each was PBR shading doing its job on something never meant to be shaded, and
each "fix" tuned PBR into a closer imitation of unlit. The answer is to ask USD
for unlit **directly**, which it expresses exactly:

```
color3f inputs:diffuseColor  = (0, 0, 0)   # no lit contribution at all
color3f inputs:emissiveColor = <colour>    # the surface simply IS its colour
int   inputs:useSpecularWorkflow = 1       # and no environment sheen
color3f inputs:specularColor = (0, 0, 0)
float inputs:ior = 1
```

Same recipe as `unlitMat`, so AR now matches the screen **by construction
rather than by approximation**. The ramp texture is therefore written at full
colour and wired to `emissiveColor` only.

Applied **only to the artwork**. The marble base and brass/steel struts stay
physically lit — they're meant to read as real materials sitting in your room
catching your actual light, and neither was ever the thing that looked wrong.
`USDZ_EMISSIVE` (0.05) still governs those.

*Note: OBJ is not in the AR path at all — it exists only for Rhino. USDZ is
Apple's current format and the only thing iOS AR Quick Look opens, so the
container was never the problem; the material model was.* Quick Look
estimates the real light direction and intensity in the room and lights the
model with it — that's automatic, and it's most of what makes the piece look
like it's *in* the space. An emissive surface is self-lit and ignores all of
it, so a high emissive made the sculpture read as a flat sticker floating on
the desk. The whisper that remains only stops the darkest colours going dead
in a dim room. Metals and the base are at 0 so they take room light fully.

**Geometry matches the OBJ export, deliberately.** Both exporters share
`collectExportMeshes()` and `exportGeometryFor()`, so they see the same
sculpture and build the same triangles. Texturing an open shape *does* carry
its alpha gradient, but it also means exporting the mesh's real geometry —
a **padded rectangle** with the silhouette cut out by alpha. Anything that
then fails to respect that alpha (emission, a renderer's blend mode, a UV
orientation guess) leaves the entire rectangle visible as a clear plane
slicing through the piece. The OBJ path never had that failure mode, because
it substitutes the true polygon prism and never emits a padded rectangle at
all. So the proven path is the default and texturing is **opt-in** via
`metadata.usdTexture`.

**Textures are carried only where they're safe.** Currently that's **only the base**, whose texture
sits on real solid geometry with no alpha cutout, so none of the above
applies. Its canvas is written into the archive as a PNG with `primvars:st`
UVs and a `UsdPrimvarReader_float2` → `UsdUVTexture` → `UsdPreviewSurface`
network bound to it, which is what gives the pedestal its marble veining and
wood grain in AR.

Open shapes are treated as **solid bodies exactly like closed ones** — same
`volumeGradient` tag, same unlit material, same density ramp, same
tessellation. `exportPolygon` already substitutes a real closed prism for
them, so nothing about an open shape needs different handling on export. They
were briefly the only artwork left untagged, which left them alone on the
PBR-lit path while everything else went unlit — so they alone still shaded by
face orientation and their front face went dark, reading as a missing face.

The cost of the flat-colour trade: **open shapes export as uniform prisms**
rather than fading out at their open edge. Restoring that fade means solving
the padded-rectangle problem first.

### Volume density gradient (export only)

On screen a body is 60% translucent, and that is what makes it read as a
volume — you see through it to its far wall. AR can't use that:
`USDZ_BODY_OPACITY` is `1` because translucent surfaces in RealityKit pick up
environment reflection and washed every vivid colour to pastel. With
translucency gone, nothing conveyed volume and shapes exported flat.

The replacement: **colour is a function of 3D position** — dense and saturated
at the core, lifting toward the rim, like pigment in cast resin. Because the
field is evaluated in each mesh's own local space, *every face of a shape
agrees with every other*, so it reads as one carved solid rather than six
independently painted faces. A per-face material cannot express that. This is
a deliberate divergence from the app's rendering, not drift — the two convey
the same property by different means because only one can afford translucency.

Three parts:

1. `densityField()` / `densityAt()` — `t` from distance to the local centroid.
   The field records **both** the bounding-corner radius (sizes tessellation)
   and the range of distances that actually occur (normalises the ramp). Those
   differ a lot and using the wrong one flattens the effect: a cube's nearest
   *surface* point sits at 0.58 of its corner radius, so normalising by the
   corner radius would confine every visible pixel to the top 42% of the ramp —
   the dense core would exist only inside the material, where nobody can see
   it.
2. `tessellateForGradient()` inside `exportGeometryFor`, gated on
   `metadata.volumeGradient` (set by `tagVolumeBody`). Needed because a box's
   four face corners are **equidistant** from its centroid, so a radial field
   sampled only at corners interpolates to a flat face — the gradient would
   vanish on exactly the shapes it matters most for. (A *linear* ramp needs no
   subdivision; barycentric interpolation of a position-linear function is
   exact. A radial one does.) Export-only, so it costs the running app nothing.
   `USDZ_GRADIENT_MAX_TRIS` is a **soft** cap — the tail of one level can
   overshoot by ~13%.
3. A 256×1 **ramp PNG** per distinct colour, with `st = (t, 0.5)`. Reuses the
   proven `stReader → UsdUVTexture` network rather than a
   `UsdPrimvarReader_float3` path whose Quick Look support is inconsistent —
   and it puts the *easing curve* in the image, so `t` only ever has to
   interpolate linearly.

Gradient meshes deliberately do **not** take the `textured` branch, which
bypasses `exportGeometryFor` and would resurrect the ghost planes; they take
the normal geometry path and gain only `st`.

**Emissive is gated on `metadata.usdTextureCutout`, not on the presence of a
texture.** The silence-emission rule exists only for alpha cutouts (a padded
rectangle whose silhouette lives in the alpha channel). The base's stone
texture and these ramps have no cutout, and silencing them would rob every
body of the `USDZ_EMISSIVE` whisper that keeps dark colours alive in a dim
room.

Tagged: shape bodies (circle/rect/triangle/semiCircle), concentric rings, halo
solid rings, lattice cells. **Untagged on purpose:** outlines and wires (crisp
opaque strokes are part of the 2D look), struts, the base, and the three
`CLEAR_RESIN_COLOR` volumes — those are meant to be nearly invisible and a
gradient would only make them noticeable.

**The three `CLEAR_RESIN_COLOR` volumes are excluded from USDZ**
(`tagResinVolume` → `metadata.skipUsdz`), kept in OBJ. They exist to suggest
"clear material holding this together" in a scene where bodies are
translucent; in AR bodies are opaque so they contribute nothing visible, while
their surfaces sit **coplanar** with the shape they wrap (the semiCircle ghost
is a full disc over a half-disc) — a textbook z-fighting pair.

OBJ gets the same field as `OBJ_GRADIENT_BANDS` (6) colour bands, binned by
triangle centroid, since MTL has no per-vertex colour. `seenColors` dedupes
across the scene, so it costs ~6 materials per distinct colour rather than per
mesh. Set the constant to 1 to switch banding off.

**`emissiveColor` is NOT multiplied by `opacity`** in UsdPreviewSurface, so a
textured material must emit **nothing**. A textured mesh's geometry is the
full PADDED rectangle whose real silhouette is cut out by texture alpha — any
flat emissive term paints that whole rectangle, transparent parts included,
and every open shape drags a ghostly clear plane through the piece.

An open shape's **back plane** is `skipExport` for OBJ but tagged
`exportForUsdz`, and `collectExportMeshes(true)` admits it. Without it the
shape has no colour viewed from behind — `doubleSided` draws the front
plane's backface, but that is not the same surface.

`st` is emitted as `(u, 1 - v)`: USD samples with (0,0) at the image's lower
left, a canvas is drawn from its top left. If a texture ever appears upside
down, that flip is the line to change.

**Materials are approximated, and can't not be.** On screen the piece is
unlit and emissive; Quick Look is fully lit PBR. A flat colour dropped into a
real room goes muddy, so `meshUsdSurface` carries a share of each colour as
emission (default 0.35). `metadata.usd` on a material overrides it — the
struts and black wires are `metallic: 1, emissive: 0` so they catch real room
light instead of glowing, and the base is low-emission stone or wood.

## Scramble mode

`window.setScrambleMode(on)` / `getScrambleMode()`, toggled by the dice button
(`#scramble-btn`, 3D only, left of materials). The 2D composition holds every
shape parallel to the picture plane, so orbiting to the side shows only edges;
scramble tips each Tier-1 shape **1–33° on X and then on Y**
(`SCRAMBLE_MIN_DEG`/`SCRAMBLE_MAX_DEG`, random sign each; combined tilt can
reach ~46° when both axes land high) — recognisably the same composition,
with real faces visible from the side.
Each activation re-rolls; tapping again reverts to true.

Mechanics: `rollScrambleQuat()` is stored per node as `node.scrambleQuat`
**before `buildElementTree` runs** (so placement's overlap/floor checks see
tilted extents), and composed at the orientation fallback sites in
`supportDistanceWorld` / `trueLowestReach` / `semiCircleAwareDistance` *and*
in `create3DShape`'s tilt node using the same expression
(`scrambleQuat.multiply(baseQuat)`) — so struts, wire anchors, the base drop
and the rendered meshes can never disagree about where a face points. The
toggle just calls `convertShapesTo3D()`, which rebuilds every strut against
the tilted geometry. The **base never scrambles**; lattices tilt via a
`tilt_lattice_*` TransformNode pivot at their centre. Halos stay flat (their
branch takes no tilt node — they're radial glows, a tilt is invisible).
Exports (OBJ/USDZ) pick the tilt up automatically through world matrices.

## Bottom bar

Three satellite buttons flank the 2D/3D toggle, sharing one CSS rule (they
differ only in side and mode). Two slots, mode-dependent:

| slot | 2D | 3D |
| --- | --- | --- |
| left (−74px, −78 on touch) | `#refresh-btn` — new composition | `#material-btn` — materials & light |
| right (+32px) | `#palette-btn` — change palette | `#ar-btn` — AR, *iOS only* |

Both modes read as three buttons, 8px either side of the toggle. Sizes and
offsets are coupled: the toggle is 48px, satellites 42px (46px on coarse
pointers), and `#palette-toast`'s arrow is offset to the palette button's
centre — change any one and the others need recomputing. `#refresh-btn` calls the same `window.resetComposition()` the
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
