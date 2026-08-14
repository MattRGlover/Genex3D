// Babylon.js 3D Mode Integration
// Converts P5.js 2D Kandinsky shapes to navigable 3D space

console.log('🎮 babylon3D.js loading...');

let babylonEngine = null;
let babylonScene = null;
let camera3D = null;
let is3DMode = false;

// Wait for everything to load
window.addEventListener('load', () => {
  setTimeout(initBabylon3D, 1000);
});

function initBabylon3D() {
  console.log('Initializing Babylon 3D system...');
  
  const toggleBtn = document.getElementById('mode-toggle-btn');
  const instructions = document.getElementById('instructions');
  
  if (!toggleBtn || !instructions) {
    console.error('Mode toggle button or instructions panel not found');
    return;
  }
  
  // Enable button after drawing starts
  setTimeout(() => {
    toggleBtn.disabled = false;
    console.log('3D mode button enabled');
  }, 2000);
  
  // Instructions fade in briefly, then get out of the way
  let instructionsTimer = null;
  const flashInstructions = () => {
    instructions.classList.add('show');
    clearTimeout(instructionsTimer);
    instructionsTimer = setTimeout(() => instructions.classList.remove('show'), 4000);
  };
  
  toggleBtn.addEventListener('click', () => {
    if (!is3DMode) {
      activate3DMode();
      flashInstructions();
    } else {
      deactivate3DMode();
      instructions.classList.remove('show');
    }
  });
  
  // ESC to exit 3D mode
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && is3DMode) {
      deactivate3DMode();
      instructions.classList.remove('show');
    }
  });
}

function activate3DMode() {
  console.log('Activating 3D mode...');
  
  // Get or create Babylon canvas
  let canvas = document.getElementById('babylon-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'babylon-canvas';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
  }
  
  // Show Babylon canvas, hide P5 canvas
  canvas.style.display = 'block';
  canvas.style.zIndex = '10'; // Put Babylon on top
  
  const p5Canvas = document.querySelector('canvas');
  if (p5Canvas && p5Canvas.id !== 'babylon-canvas') {
    p5Canvas.style.display = 'none';
    p5Canvas.style.pointerEvents = 'none'; // Disable P5 input
    console.log('P5 canvas hidden and input disabled');
  }
  
  // Create Babylon engine and scene
  if (!babylonEngine) {
    // Fill the viewport and render at native device resolution (capped at 2x,
    // same as the 2D sketch) - without this, phones render at CSS pixels and
    // the 3D view looks noticeably blurrier than the 2D one
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    babylonEngine = new BABYLON.Engine(canvas, true);
    babylonEngine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));
    babylonEngine.resize();
    babylonScene = createBabylonScene(canvas);
    
    // Render loop
    babylonEngine.runRenderLoop(() => {
      if (babylonScene && is3DMode) {
        babylonScene.render();
      }
    });
    
    // Resize
    window.addEventListener('resize', () => {
      if (babylonEngine) {
        babylonEngine.resize();
      }
    });
  }
  
  // Convert P5 shapes to 3D
  convertShapesTo3D();
  
  // NOTE: the p5 draw loop is intentionally left running (not noLoop()'d)
  // while in 3D. New-shape creation is blocked separately (isUiEvent() in
  // sketchdesktopreset.js bails out of handleDrag() while is3DMode is true),
  // but existing in-progress growth animations keep advancing in real time
  // so 2D doesn't "resume" a stale animation when you come back to it.
  is3DMode = true;

  // Lets the 2D-only chrome (the palette button and its hint) hide itself -
  // the palette only affects newly drawn 2D elements, so it has nothing to
  // do while the 3D view is up.
  document.body.classList.add('in-3d');

  // Update button
  const toggleBtn = document.getElementById('mode-toggle-btn');
  toggleBtn.textContent = '2D';
  
  console.log('3D mode activated!');
}

function deactivate3DMode() {
  console.log('Deactivating 3D mode...');

  // Hide Babylon canvas, show P5 canvas
  const canvas = document.getElementById('babylon-canvas');
  if (canvas) {
    canvas.style.display = 'none';
    canvas.style.zIndex = '0';
  }
  
  const p5Canvas = document.querySelector('canvas');
  if (p5Canvas && p5Canvas.id !== 'babylon-canvas') {
    p5Canvas.style.display = 'block';
    p5Canvas.style.pointerEvents = 'auto'; // Re-enable P5 input
    console.log('P5 canvas shown and input enabled');
  }
  
  is3DMode = false;
  document.body.classList.remove('in-3d');

  // Update button
  const toggleBtn = document.getElementById('mode-toggle-btn');
  toggleBtn.textContent = '3D';
  
  console.log('Returned to 2D mode');
}

function createBabylonScene(canvas) {
  const scene = new BABYLON.Scene(babylonEngine);

  // Order-independent transparency (dual depth peeling) was tried here -
  // correct in theory for this scene's deliberately overlapping translucent
  // shapes, but in practice it caused more damage than the "poking through"
  // glitch it was meant to fix: framerate dropped badly, then geometry
  // started disappearing outright - not just the lattice divider (three
  // different approaches, including a version built from geometrically
  // DISJOINT meshes that cannot possibly lose a depth-sort race, still
  // didn't render), but concentricArc's nested rings and a concentricCircle
  // halo's outline too - shapes this session never touched. That combination
  // (a disjoint mesh failing to render + unrelated shapes breaking at the
  // same time) points at the depth-peeling pipeline itself misbehaving with
  // this scene's material setup, not any individual shape's geometry - and
  // Babylon's own docs mark OIT as beta with known rough edges. Reverted;
  // the standard alpha-blend path's occasional mesh-order ambiguity from an
  // oblique angle is a much smaller problem than shapes vanishing outright.

  // Capture P5 canvas as background texture
  captureP5Background(scene);
  
  // Paper base wash color (identical to the texture borders, so any hairline
  // gap between skybox faces is invisible)
  scene.clearColor = new BABYLON.Color4(229 / 255, 214 / 255, 184 / 255, 1);
  
  // Camera - ORBITS a fixed target at the center of the sculpture, matching
  // the 2D view exactly on entry. Babylon's ArcRotateCamera gives us the
  // whole requested control scheme for free via its default pointer input:
  // drag (mouse OR one-finger touch) in any direction revolves around the
  // target at a constant radius, and mouse wheel / two-finger pinch both
  // change that radius (zoom) - no custom input plumbing needed.
  camera3D = new BABYLON.ArcRotateCamera(
    "camera", -Math.PI / 2, Math.PI / 2, 50, new BABYLON.Vector3(0, 0, 0), scene
  );
  camera3D.fov = 0.45; // Narrow FOV to avoid fisheye distortion
  camera3D.attachControl(canvas, true);
  camera3D.maxZ = 5000; // Far clip - keep shapes visible when zoomed far out (also raised dynamically per-composition, see convertShapesTo3D's camera framing)
  camera3D.minZ = 0.5; // Near clip - a WebGL depth buffer's precision is dominated by the maxZ/minZ RATIO, not either value alone; too-small a minZ (the default) spreads precision worthlessly thin near the camera and starves it everywhere farther out
  // Standard fix for z-fighting across a wide range of viewing distances -
  // a plain depth buffer allocates precision non-linearly (most of it
  // wasted very close to the camera), so two large, nearly-coplanar
  // surfaces (e.g. a concentricCircle's outer ring sitting close in front
  // of a big rect behind it - both legitimately non-overlapping, just with
  // a thin real gap) can still flicker/interleave once the camera sits
  // more than a few hundred units out, which now happens routinely since
  // upperRadiusLimit was raised to fit wide, unrearranged compositions.
  // Briefly swapped for `engine.useReverseDepthBuffer` to avoid a conflict
  // with order-independent transparency's multi-pass depth reads, but OIT
  // was reverted entirely (caused worse problems than it solved), so that
  // reasoning no longer applies - back to this, the original, proven setting.
  camera3D.useLogarithmicDepth = true;

  // Orbit-only: no panning, so drag/swipe can never drift the target off
  // the sculpture's center - it only ever revolves around it.
  camera3D.panningSensibility = 0;
  // Keep the orbit above/below the poles (prevents the view flipping
  // upside-down if a drag pushes straight over the top or bottom)
  camera3D.lowerBetaLimit = 0.05;
  camera3D.upperBetaLimit = Math.PI - 0.05;
  // Zoom range: close enough to inspect detail, far enough to see the
  // whole piece, but never so close/far the framing breaks down
  camera3D.lowerRadiusLimit = 5;
  camera3D.upperRadiusLimit = 2000;
  camera3D.wheelPrecision = 3; // mouse wheel zoom speed
  camera3D.angularSensibilityX = 2000; // drag/swipe orbit speed (lower = faster)
  camera3D.angularSensibilityY = 2000;
  camera3D.inertia = 0.9; // brief natural glide after a drag/flick, then settles

  // PINCH ZOOM: fed through Babylon's REAL movement/zoom system
  // (camera.movement.zoomAccumulatedPixels) - confirmed by reading the
  // actual loaded engine source (this CDN build is a much newer Babylon
  // than the classic inertialRadiusOffset-based API most docs/examples
  // describe): ArcRotateCamera._applyRotationAndZoomDelta does
  // `radius -= zoomDeltaCurrentFrame` every frame, where that delta is a
  // physically-based, frame-rate-independent velocity computed FROM
  // zoomAccumulatedPixels and decayed by camera.movement.zoomInertia - i.e.
  // positive zoomAccumulatedPixels = zoom IN, and it already has its own
  // real momentum system built in. Earlier attempts hand-rolled a parallel
  // velocity/decay loop on the side, which only reached the camera through
  // an inconsistent legacy compatibility shim (a getter/setter pair on
  // camera.inertialRadiusOffset that doesn't reliably route through this
  // same system) - using the real mechanism directly is both simpler and
  // actually correct.
  camera3D.movement.zoomInertia = 0.95; // longer coast than drag/orbit's camera3D.inertia (0.9) above - set AFTER it, since that setter would otherwise overwrite this to match
  function addZoomInput(pixels) {
    camera3D.movement.activeInput = true;
    camera3D.movement.zoomAccumulatedPixels += pixels;
  }

  // PER-GESTURE ZOOM CAP: the radius-proportional sensitivity below is
  // largest exactly when furthest out, and zoomInertia's momentum keeps
  // coasting after release - together a single vigorous pinch/flick
  // starting at the far limit could build up enough velocity to sail all
  // the way to the near limit in one continuous motion. Rather than
  // weakening the feel for normal gestures, clamp how far ONE gesture
  // (including its post-release coast) is allowed to move the camera,
  // relative to wherever that gesture started - startZoomGesture() is
  // called when a new pinch/wheel gesture begins, below.
  const MAX_ZOOM_FACTOR_PER_GESTURE = 8; // one gesture can change radius by up to this multiple, not the full lower/upper range
  const GESTURE_COAST_CLEAR_MS = 2000; // matches roughly how long zoomInertia's momentum takes to settle
  let gestureMinRadius = null, gestureMaxRadius = null, gestureClearTimer = null;
  function startZoomGesture() {
    clearTimeout(gestureClearTimer);
    const r = camera3D.radius;
    gestureMinRadius = Math.max(camera3D.lowerRadiusLimit, r / MAX_ZOOM_FACTOR_PER_GESTURE);
    gestureMaxRadius = Math.min(camera3D.upperRadiusLimit, r * MAX_ZOOM_FACTOR_PER_GESTURE);
  }
  function scheduleZoomGestureClear() {
    clearTimeout(gestureClearTimer);
    gestureClearTimer = setTimeout(() => {
      gestureMinRadius = null;
      gestureMaxRadius = null;
    }, GESTURE_COAST_CLEAR_MS);
  }
  scene.onBeforeRenderObservable.add(() => {
    if (gestureMinRadius === null) return;
    if (camera3D.radius < gestureMinRadius) {
      camera3D.radius = gestureMinRadius;
      camera3D.movement.resetZoomVelocity();
    } else if (camera3D.radius > gestureMaxRadius) {
      camera3D.radius = gestureMaxRadius;
      camera3D.movement.resetZoomVelocity();
    }
  });

  // TOUCH PINCH: driven ourselves instead of Babylon's built-in multi-touch
  // handling. Its default pinch divides raw finger-distance pixels by
  // (pinchPrecision * average angularSensibility / 2) - at our
  // angularSensibility of 2000 that's a huge divisor, so a real pinch barely
  // moves the radius, reading as disconnected from the gesture. Neutralize
  // its contribution and feed the real zoom system above from our own
  // pinch-distance-ratio calculation instead, scaled to feel powerful
  // ("fly" in/out), with a floor on the radius-proportional scale so it
  // doesn't go anemic once already zoomed in close.
  camera3D.pinchPrecision = 1e6;
  const PINCH_ZOOM_SENSITIVITY = 0.15;
  const pinchTouches = new Map();
  let pinchStartDist = null;
  const pinchDist = () => {
    const [a, b] = [...pinchTouches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    pinchTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchTouches.size === 2) {
      pinchStartDist = pinchDist();
      startZoomGesture();
    } else {
      pinchStartDist = null;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pinchTouches.has(e.pointerId)) return;
    pinchTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchTouches.size !== 2) return;
    const d = pinchDist();
    if (pinchStartDist) {
      // Fingers spreading (d > start) = zoom in = positive input
      const radiusScale = Math.max(camera3D.radius, 40) / 300;
      addZoomInput((d - pinchStartDist) * PINCH_ZOOM_SENSITIVITY * radiusScale);
    }
    pinchStartDist = d;
  });
  const endPinch = (e) => {
    if (!pinchTouches.delete(e.pointerId)) return;
    pinchStartDist = pinchTouches.size === 2 ? pinchDist() : null;
    if (pinchTouches.size < 2) scheduleZoomGestureClear();
  };
  canvas.addEventListener('pointerup', endPinch);
  canvas.addEventListener('pointercancel', endPinch);

  // TRACKPAD PINCH (Chrome/Firefox): these engines report a trackpad pinch
  // as a 'wheel' event with ctrlKey set (no separate pinch event exists on
  // them). Replicates Babylon's own wheel-to-zoom formula directly (now
  // confirmed from source: pixels = -deltaY / (40*wheelPrecision), positive
  // = zoom in) rather than routing through Babylon's own handler, then
  // scales it up - its natural per-tick magnitude is tuned for a mouse
  // wheel's ~100-unit clicks, small next to a trackpad pinch's finer
  // deltas. A previous version ALSO multiplied by gesture speed on top of
  // this, which double-counted it (deltaY itself already scales with
  // gesture speed) and made fast flicks overshoot - kept here as just a
  // light edge, not the dominant factor. Captured on `document` so it can
  // preventDefault before Chrome/Firefox's native page-zoom reaction to it.
  const TRACKPAD_PINCH_BOOST = 30;
  let lastTrackpadPinchTime = 0;
  document.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    // Still block the browser's native page-zoom above (matching the page-
    // wide pinch hard-block in index3D.html), but never feed the 3D camera
    // while 2D mode is showing - this listener lives on `document`, so
    // without this a trackpad pinch in 2D mode silently moved the hidden
    // camera's radius behind the user's back.
    if (!is3DMode) return;

    const scaledDeltaY = e.deltaY * (e.deltaMode === 1 ? 40 : 1); // DOM_DELTA_LINE
    const naturalPixels = -scaledDeltaY / (40 * camera3D.wheelPrecision);

    const now = performance.now();
    const rawGap = now - lastTrackpadPinchTime;
    lastTrackpadPinchTime = now;
    // A real trackpad pinch fires these every ~16-30ms; a gap bigger than
    // that means fingers lifted and this is a fresh gesture - same per-
    // gesture zoom cap as touch pinch above.
    if (gestureMinRadius === null || rawGap > 400) startZoomGesture();
    const dt = Math.max(1, rawGap);
    const speed = Math.abs(e.deltaY) / dt; // roughly px of pinch motion per ms
    const boost = TRACKPAD_PINCH_BOOST * (1 + Math.min(speed * 0.5, 1));

    addZoomInput(naturalPixels * boost);
    scheduleZoomGestureClear();
  }, { passive: false, capture: true });

  // No lights: every material is unlit/emissive for exact 2D color match.
  // Adding lights would shift colors away from the 2D original.

  console.log('Babylon scene created');
  return scene;
}

// CUBE SKYBOX: 6 inward-facing planes around the viewer. The 4 side faces are
// adjacent square slices of ONE horizontally-tileable strip texture, so every
// side seam is continuous by construction (shared pixel columns) - no seams,
// no mirroring. Top/bottom are their own watercolor textures (same style), so
// there are no sphere poles and nothing stretches.
// Slice order rightward around the cube: left [0], front [1], right [2],
// back [3]; the back-left seam is the strip's wrap edge (tileable).
const SKY_BASE_RGB = [229, 214, 184]; // paper base wash fallback
function buildSkybox(scene) {
  const bigCanvas = (window.bigBgLayer || window.finalBgLayer || {}).canvas;
  if (!bigCanvas) {
    console.warn('Background layer not found');
    return null;
  }
  const capTop = window.bgCapTop && window.bgCapTop.canvas;
  const capBottom = window.bgCapBottom && window.bgCapBottom.canvas;
  const size = 1000, D = size / 2;
  const sliceW = bigCanvas.width / 4;
  // rot = [rotation.x, rotation.y] turning each plane's front toward the origin
  const faces = [
    { name: 'front',  pos: [0, 0, D],  rot: [0, 0],                src: 'slice', slice: 1 },
    { name: 'right',  pos: [D, 0, 0],  rot: [0, Math.PI / 2],      src: 'slice', slice: 2 },
    { name: 'back',   pos: [0, 0, -D], rot: [0, Math.PI],          src: 'slice', slice: 3 },
    { name: 'left',   pos: [-D, 0, 0], rot: [0, -Math.PI / 2],     src: 'slice', slice: 0 },
    { name: 'top',    pos: [0, D, 0],  rot: [-Math.PI / 2, 0],     src: 'cap', cap: capTop },
    { name: 'bottom', pos: [0, -D, 0], rot: [Math.PI / 2, 0],      src: 'cap', cap: capBottom },
  ];
  const root = new BABYLON.TransformNode('skyboxRoot', scene);
  for (const f of faces) {
    let srcCanvas, sx, sw, sh;
    if (f.src === 'slice') {
      srcCanvas = bigCanvas; sx = f.slice * sliceW; sw = sliceW; sh = bigCanvas.height;
    } else {
      srcCanvas = f.cap; sx = 0;
      sw = srcCanvas ? srcCanvas.width : 4; sh = srcCanvas ? srcCanvas.height : 4;
    }
    const tex = new BABYLON.DynamicTexture('skyTex_' + f.name, { width: sw, height: sh }, scene, false);
    const ctx = tex.getContext();
    if (srcCanvas) {
      ctx.drawImage(srcCanvas, sx, 0, sw, sh, 0, 0, sw, sh);
    } else {
      ctx.fillStyle = `rgb(${SKY_BASE_RGB[0]},${SKY_BASE_RGB[1]},${SKY_BASE_RGB[2]})`;
      ctx.fillRect(0, 0, sw, sh);
    }
    tex.update();
    tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    tex.updateSamplingMode(BABYLON.Texture.BILINEAR_SAMPLINGMODE);
    const mat = new BABYLON.StandardMaterial('skyMat_' + f.name, scene);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex; // Self-illuminated, exact 2D colors
    mat.disableLighting = true;
    mat.specularColor = new BABYLON.Color3(0, 0, 0);
    const plane = BABYLON.MeshBuilder.CreatePlane('skyFace_' + f.name, { size: size }, scene);
    plane.position.set(f.pos[0], f.pos[1], f.pos[2]);
    plane.rotation.x = f.rot[0];
    plane.rotation.y = f.rot[1];
    plane.material = mat;
    plane.isPickable = false;
    plane.parent = root;
  }
  return root;
}

function captureP5Background(scene) {
  const skybox = buildSkybox(scene);
  if (!skybox) return;

  // Make skybox follow camera so you can never reach it
  scene.registerBeforeRender(() => {
    if (camera3D && skybox) {
      skybox.position.copyFrom(camera3D.position);
    }
  });

  console.log('World background cube skybox created');
}

// Silently render the cube skybox and screenshot it. The 2D sketch uses this
// screenshot as its background, so entering 3D shows the IDENTICAL background
// (same skybox, same textures, same camera pose: looking at the front face).
function renderSphereBackgroundTo2D(targetLayer, bigCanvas, viewW, viewH) {
  if (typeof BABYLON === 'undefined') return false;
  try {
    const glCanvas = document.createElement('canvas');
    // Render at native device resolution (capped 2x) so the 2D background is
    // as sharp on phones as on desktop
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    glCanvas.width = viewW * dpr;
    glCanvas.height = viewH * dpr;
    const engine = new BABYLON.Engine(glCanvas, true, { preserveDrawingBuffer: true });
    // Force SYNCHRONOUS shader compilation: otherwise the first render skips
    // the skybox (material not ready yet) and the screenshot comes out black
    engine.getCaps().parallelShaderCompile = undefined;
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(229 / 255, 214 / 255, 184 / 255, 1); // base wash, never black
    // Same pose as 3D mode: camera at skybox center, looking +Z, same FOV
    const cam = new BABYLON.UniversalCamera('shotCam', new BABYLON.Vector3(0, 0, 0), scene);
    cam.setTarget(new BABYLON.Vector3(0, 0, 1));
    cam.fov = 0.45;
    if (!buildSkybox(scene)) {
      engine.dispose();
      return false;
    }
    // Wait until shaders/textures are genuinely ready, THEN capture.
    // (Racing the first render captured only the clear color.)
    scene.executeWhenReady(() => {
      scene.render();
      scene.render();
      targetLayer.drawingContext.drawImage(glCanvas, 0, 0, targetLayer.width, targetLayer.height);
      engine.dispose();
      console.log('2D background updated with skybox screenshot');
    });
    return true; // caller draws a flat-crop placeholder until the capture lands
  } catch (e) {
    console.warn('Skybox background screenshot failed:', e);
    return false;
  }
}
window.renderSphereBackgroundTo2D = renderSphereBackgroundTo2D;

function convertShapesTo3D() {
  if (!babylonScene) {
    console.error('Babylon scene not ready');
    return;
  }
  
  console.log('Converting shapes to 3D...');
  console.log('Window object keys:', Object.keys(window).filter(k => k.includes('skeleton') || k.includes('ornament') || k.includes('line')));
  
  // Clear existing meshes (everything except the sky)
  const meshesToRemove = babylonScene.meshes.filter(m =>
    /^(shape_|line_|bezier_|arcline_|spiral_|lattice|open_|outline_|halo|concentric|bridge_|base_|conndot_)/.test(m.name)
  );
  // dispose(false, true): also dispose each mesh's material AND its textures.
  // Every artwork mesh gets its own unlitMat (plus big DynamicTextures for
  // open shapes/halos), and a plain dispose() leaves all of those alive in
  // the scene - so every 2D->3D toggle leaked the whole previous scene's
  // materials/textures, same accumulation class as the tilt nodes below.
  // (Shared materials - e.g. an open shape's front/back planes - are fine:
  // both meshes are in this removal set and disposing twice is a no-op.)
  meshesToRemove.forEach(mesh => mesh.dispose(false, true));
  // Contact-tilt TransformNodes (create3DShape's `tilt_${index}`) are a
  // separate scene collection from meshes - disposing their child meshes
  // above does NOT dispose the parent node, so without this they'd
  // accumulate as orphaned nodes every time this function re-runs.
  const tiltNodesToRemove = babylonScene.transformNodes.filter(n => /^tilt_/.test(n.name));
  tiltNodesToRemove.forEach(node => node.dispose());
  // The base/strut materials just went with their meshes above - drop the
  // cached handles and the live-swap registries so this build makes new ones.
  resetSculptureMaterialRegistry();
  // Lights must exist before the first render of the materials built below -
  // a lit material with no lights in the scene renders black. Both calls are
  // idempotent, so re-entering 3D mode just re-asserts them.
  if (spotlightMode) buildSpotlightRig();
  syncSpotlightEnvironment();
  
  // Get shapes from P5 sketch - try multiple ways
  let shapes = [];
  let ornaments = [];
  let lines = [];
  let lattices = [];
  
  // Direct global access
  if (typeof window.skeletons !== 'undefined') {
    shapes = window.skeletons;
    console.log('✅ Found skeletons via window.skeletons');
  }
  if (typeof window.ornaments !== 'undefined') {
    ornaments = window.ornaments;
    console.log('✅ Found ornaments via window.ornaments');
  }
  // Lines/lattices: live anim arrays get SPLICED as animations complete,
  // so use the persistent sceneReport record instead (captures every element created)
  const report = window.sceneReport || {};
  lines = report.lines || [];
  const beziers = report.beziers || [];
  const arcLines = report.arcs || [];
  const spirals = report.spirals || [];
  
  // Rebuild lattice cells from persistent report (poly points + colors per cell)
  const latticeReports = report.lattices || [];
  lattices = latticeReports.map(rep => {
    const cells = [];
    const count = rep.cellCount || 0;
    const ptsPer = count > 0 ? rep.cellPolygonData.length / count : 0;
    for (let ci = 0; ci < count; ci++) {
      cells.push({
        poly: rep.cellPolygonData.slice(ci * ptsPer, (ci + 1) * ptsPer),
        col: rep.cellColors[ci]
      });
    }
    return { x: rep.x, y: rep.y, cells };
  });
  console.log('✅ Lines/lattices sourced from persistent sceneReport');
  
  console.log(`📊 Total found: ${shapes.length} skeletons, ${ornaments.length} ornaments, ${lines.length} lines, ${beziers.length} beziers, ${arcLines.length} arcs, ${spirals.length} spirals, ${lattices.length} lattices`);
  
  // Debug: Log first few shapes to see their structure
  if (shapes.length > 0) {
    console.log('🔍 First skeleton shape:', shapes[0]);
  }
  if (ornaments.length > 0) {
    console.log('🔍 First ornament shape:', ornaments[0]);
  }
  if (lines.length > 0) {
    console.log('🔍 First line:', lines[0]);
  }
  
  let totalConverted = 0;
  let conversionStats = {
    skeletons: 0,
    ornaments: 0,
    lines: 0,
    lattices: 0,
    failed: []
  };

  // Size the front/back draw-order split to the ACTUAL Tier-1 shape count
  // (skeletons + ornaments + lattices) specifically - NOT the full element
  // count including connectors. buildElementTree's Z-bias (the thing that
  // actually decides which shapes end up front vs back) only ever runs on
  // Tier-1 nodes, and those always get the LOWEST global indices (connectors
  // are indexed afterward - see the gather loops below). Normalizing against
  // the full total (previous fix) still miscalibrated the split point for
  // Tier-1 placement specifically: with connectors often outnumbering real
  // shapes, most or all Tier-1 indices could fall on the same side of
  // SPAN/2, biasing the whole shape population toward one depth regardless
  // of actual paint order - "still front heavy" even after the last fix.
  ELEMENT_ORDER_SPAN = Math.max(shapes.length + ornaments.length + lattices.length, 10);

  // ===== TIER 1: gather every element with a real bounding volume (both
  // skeletons, filled/open circle/rect/triangle/semiCircle ornaments,
  // concentricCircle, lattices), build the connected non-overlapping tree,
  // then create their meshes from the resolved positions. globalIndex is
  // unique across EVERY element in the whole scene (not per-array) so
  // synthesizedZBias() never collides between e.g. shapes[1] and
  // ornaments[1] - see buildElementTree/computeConnectorAnchor for why.
  let globalIndex = 0;
  const skeletonNodeFor = new Array(shapes.length).fill(null);
  const ornamentNodeFor = new Array(ornaments.length).fill(null);
  const latticeNodeFor = new Array(lattices.length).fill(null);
  const tier1Nodes = [];

  shapes.forEach((shape, i) => {
    const rad = shapeVolumeRadius3D(shape);
    if (!rad) return; // defensive - skeletons are always open rect/tri/semiCircle, always volumed
    const { x, y } = projectXY3D(shape);
    const node = { key: `skeleton ${i}`, globalIndex: globalIndex++, origX: x, origY: y, r: rad.r, zOffset: rad.zOffset, ...tier1ShapeFields(shape, rad) };
    skeletonNodeFor[i] = node;
    tier1Nodes.push(node);
  });
  ornaments.forEach((shape, i) => {
    const rad = shapeVolumeRadius3D(shape);
    if (!rad) return; // halo/concentricArc/squiggle/arc - Tier 2, handled below
    const { x, y } = projectXY3D(shape);
    const node = { key: `ornament ${i}`, globalIndex: globalIndex++, origX: x, origY: y, r: rad.r, zOffset: rad.zOffset, ...tier1ShapeFields(shape, rad) };
    ornamentNodeFor[i] = node;
    tier1Nodes.push(node);
  });
  lattices.forEach((lattice, i) => {
    const rad = latticeVolumeRadius3D(lattice);
    if (!rad) return;
    const { x, y } = projectXY3D(lattice); // lattice.x/y are the same field names as shapes
    // Reclassified as a rect: a real box profile (4-corner polygon) instead
    // of the old plain-sphere stand-in, so the support-function geometry
    // agrees with what create3DLattice actually renders. zHalf uses HALF
    // the standard rect depth formula - "the entire ensemble should be
    // half as deep as a standard rect" - matching create3DLattice's own
    // per-cell extrusion depth exactly. shapeType stays 'lattice' (not
    // literally 'rect') only so computeContactTilt's fixed-aspect-ratio
    // rect formula (w=s, h=s*0.6) - dead code today since nothing tilts
    // anymore, but a latent footgun if that ever changes - never gets
    // applied to a lattice's real, independent w/h.
    const s = Math.max(rad.w, rad.h);
    const node = {
      key: `lattice ${i}`, globalIndex: globalIndex++, origX: x, origY: y, r: rad.r, zOffset: 0,
      shapeType: 'lattice', s, rotZ: rad.rotZ,
      localProfile: { kind: 'polygon', vertices: rad.corners }, // TRUE bounds relative to the anchor, not assumed-symmetric
      zHalf: Math.max(0.8, s * 0.12) / 4
    };
    latticeNodeFor[i] = node;
    tier1Nodes.push(node);
  });

  // The pedestal base is itself a Tier-1 participant now ("the base can be
  // another shape") - added AFTER every real shape/ornament/lattice is
  // gathered (so its size/position can be derived from them) but BEFORE
  // buildElementTree runs, so it goes through the exact same placement,
  // non-overlap, and contact-marking machinery as everything else.
  const baseNode = createBaseTier1Node(tier1Nodes);
  if (baseNode) tier1Nodes.push(baseNode);

  buildElementTree(tier1Nodes); // mutates every node's resolved x/y/z in place - x/y = origX/origY unchanged, only z is resolved
  console.log(`📐 Placed ${tier1Nodes.length} Tier-1 shape(s) at their exact original 2D positions, depth-only resolved`);

  // "Back the whole sculpture up" - the base's own Z lands wherever
  // buildElementTree happened to resolve it (typically ~0, since it's the
  // largest node and gets placed FIRST with nothing yet to react to), but
  // the shape cluster's real Z range (driven by the front/back draw-order
  // bias plus real occlusion-order constraints) tends to skew toward the
  // front rather than spreading symmetrically around that. The base's
  // circular footprint, centered on wherever its OWN Z landed, then only
  // covers about half the cluster's real depth - the front-most shapes
  // (lattices especially, which get their own extra forward push) stick out
  // past the front rim while the back rim goes mostly unused. Recenter the
  // base's Z on the ACTUAL resolved Z-midpoint of every other Tier-1 shape -
  // Z has no 2D equivalent at all (unlike x/y), so shifting it is never a
  // "rearrange" violation, and the base's own placement never had a real
  // constraint pinning it to Z=0 in the first place.
  if (baseNode) {
    const nonBaseForZ = tier1Nodes.filter(n => !n.isBase);
    if (nonBaseForZ.length > 0) {
      const zs = nonBaseForZ.map(n => tier1WorldCenter(n).z);
      baseNode.z = (Math.min(...zs) + Math.max(...zs)) / 2; // baseNode.zOffset is always 0, so world Z = z directly

      // Real width/depth for the marble slab's RENDERED footprint (see
      // createBaseMesh3D) - a rectangle fitted to the sculpture's actual X
      // and Z extents reads far better than a fixed square. This is purely
      // a rendering size: baseNode.r (the circular footprint every strut/
      // support calculation already reasons about) stays exactly as before,
      // so none of that logic needs to change - the rendered slab is sized
      // to comfortably CONTAIN that same circular footprint either way.
      const xs = nonBaseForZ.map(n => n.x);
      const xRange = Math.max(...xs) - Math.min(...xs);
      const zRange = Math.max(...zs) - Math.min(...zs);
      baseNode.renderW = Math.max(baseNode.r * 2, xRange + baseNode.r * 0.6);
      baseNode.renderD = Math.max(baseNode.r * 2, zRange + baseNode.r * 0.6);
    }
  }

  // Render the base at its final resolved position.
  if (baseNode) createBaseMesh3D(baseNode);

  // ===== Gravitational analysis: every element's real-world position + mass
  // (resin shapes/lattices, metal skeleton, heavy wood base), gathered as
  // meshes are created below so the entries always match what's actually
  // rendered - used after everything is placed to check whether the
  // sculpture would genuinely stand freestanding, and add a real support
  // only if it wouldn't (see the COG check after the strut block below).
  const massEntries = [];
  tier1Nodes.forEach(n => {
    const wc = tier1WorldCenter(n);
    massEntries.push({ x: wc.x, y: wc.y, z: wc.z, mass: tier1NodeMass(n) });
  });

  // Tracks which Tier-1 nodes end up with a REAL skeleton (Tier-2)
  // connector reaching them, populated below as ornaments/connectors are
  // realized - the sculpture should be "largely self-supporting given the
  // skeleton of line-based elements passing through," so a base support
  // strut is a LAST RESORT, only for a shape near the base that the
  // skeleton never reached at all, not a default for everything nearby.
  const skeletonConnectedNodes = new Set();

  // A connector's un-anchored FREE end only ever gets a Z-LEAN toward a
  // nearby Tier-1 shape (never a real x/y touch - see secondaryZTilt) -
  // fine on its own, but if several separate connectors share a similar 2D
  // origin (a common "hub" the original artwork radiates several lines
  // from) and each independently leans its own free end toward the SAME
  // nearest shape's Z, their free ends (already close in x/y from that
  // shared origin) end up sitting on top of each other too - wires visibly
  // touching EACH OTHER instead of a real shape, which must never happen.
  // Shared across every connector/ornament realized below so the 2nd (3rd,
  // 4th...) connector reaching for the same nearby shape picks the next-
  // nearest one instead (or no lean at all), the same "each claimed once"
  // pattern computeArcStringTargets already uses for its own breakpoints.
  const claimedSecondaryTargets = new Set();

  // Red dots mark every real touch point, but ONLY once the mesh they
  // belong to actually got created - marking unconditionally (as before)
  // left floating dots with nothing at them whenever create3DShape/createFn
  // failed for that particular element.
  shapes.forEach((shape, i) => {
    const node = skeletonNodeFor[i];
    const success = create3DShape(shape, i, node ? -node.z : 0, node ? node.contactDir : null,
      node ? { x: node.x, y: node.y } : null);
    if (success) {
      totalConverted++;
      conversionStats.skeletons++;
    } else {
      conversionStats.failed.push({type: 'skeleton', index: i, shapeType: shape?.type, style: shape?.style});
    }
  });

  // ===== TIER 2 ornaments (halo/concentricArc/squiggle/shape-type arc): no
  // real volume, pass-through (may freely thread through shapes per the
  // user's rule), single touch-point attachment to whichever Tier-1 member
  // they were nearest to in the original 2D layout. =====
  // Far ends of colored shape-type arcs, queued here and given a thin
  // support rod in the aux-strut block below - an arc fastened at ONE touch
  // point cantilevers its whole sweep off a single weld, which isn't
  // credible support ("colored arcs are not being supported").
  const arcEndSupports = [];

  ornaments.forEach((shape, i) => {
    const node = ornamentNodeFor[i];
    let resolvedXY = null, layerZ = 0, contactDir = null, markerPoint = null, anchorTarget = null, skeletonKind = null;
    if (node) {
      resolvedXY = { x: node.x, y: node.y };
      layerZ = -node.z;
      contactDir = node.contactDir;
    } else {
      const kind = shape.style === 'halo' ? 'halo'
        : shape.type === 'concentricArc' ? 'concentricArc'
        : shape.type === 'squiggle' ? 'squiggle'
        : shape.type === 'arc' ? 'arcShape'
        : null;
      skeletonKind = kind;
      const anchor = kind ? computeConnectorAnchor(kind, shape, globalIndex++, tier1Nodes, null, claimedSecondaryTargets) : null;
      if (anchor && anchor.mode === 'resolved') {
        resolvedXY = anchor.resolvedXY;
        layerZ = -anchor.targetWorldZ;
      }
      if (anchor && anchor.primaryAnchorWorld) markerPoint = anchor.primaryAnchorWorld;
      anchorTarget = anchor ? anchor.targetNode : null;
    }
    const success = create3DShape(shape, i + shapes.length, layerZ, contactDir, resolvedXY);
    if (success) {
      totalConverted++;
      conversionStats.ornaments++;
      if (markerPoint) markConnectionPoint(`conndot_ornament_${i}`, markerPoint);
      // A halo is "a soft radial glow, no hard edge to bound" (see
      // shapeVolumeRadius3D) - purely decorative, not a real rigid
      // connector, so it must NOT count as structural support for the shape
      // it's anchored to. Crediting it here was letting a shape with only a
      // halo touching it skip every base-strut pass below and render with
      // nothing real actually holding it up ("unsupported bullseye with
      // halo"). squiggle/arcShape ARE real wire elements and still count.
      if (anchorTarget && skeletonKind !== 'halo') skeletonConnectedNodes.add(anchorTarget);
      // Tier-1 ornaments were already weighed with tier1Nodes above (resin);
      // Tier-2 (no real volume) is "line based" per the user's framing - weigh
      // it as thin metal at its own anchor point instead.
      if (!node && skeletonKind && markerPoint) {
        massEntries.push({ x: markerPoint.x, y: markerPoint.y, z: markerPoint.z, mass: ornamentSkeletonMass(skeletonKind, shape) });
      }
      // Queue a colored arc's FAR end (whichever curve endpoint sits
      // farther from its single anchor point) for a thin support rod -
      // endpoint positions mirror create3DShape's own arc rendering
      // (arcPathLocal's y-flip, rotated by rotZ, flat at the resolved Z).
      if (skeletonKind === 'arcShape' && resolvedXY && markerPoint) {
        const rotZa = -(shape.rot || 0);
        const ra = ((shape.targetSize || 50) / K3D_SCALE) / 2;
        const aStart = shape.arcStart || 0;
        const aEnd = aStart + (shape.arcSweep || Math.PI);
        const cosA = Math.cos(rotZa), sinA = Math.sin(rotZa);
        const endWorld = (t) => {
          const lx = ra * Math.cos(t), ly = -ra * Math.sin(t);
          return { x: resolvedXY.x + lx * cosA - ly * sinA, y: resolvedXY.y + lx * sinA + ly * cosA, z: -layerZ };
        };
        const e0 = endWorld(aStart), e1 = endWorld(aEnd);
        const d0 = Math.hypot(e0.x - markerPoint.x, e0.y - markerPoint.y);
        const d1 = Math.hypot(e1.x - markerPoint.x, e1.y - markerPoint.y);
        arcEndSupports.push({ point: d0 >= d1 ? e0 : e1 });
      }
    } else {
      conversionStats.failed.push({type: 'ornament', index: i, shapeType: shape?.type, style: shape?.style});
    }
  });

  // Lattices (Tier 1 - real volume, mutual non-overlap already resolved above)
  lattices.forEach((lattice, i) => {
    const node = latticeNodeFor[i];
    const success = create3DLattice(lattice, i, node ? -node.z : 0, node ? { x: node.x, y: node.y } : null);
    if (success) {
      totalConverted++;
      conversionStats.lattices++;
    } else {
      conversionStats.failed.push({type: 'lattice', index: i});
    }
  });

  // ===== TIER 2 connectors (line/bezier/arcline/spiral): pass-through,
  // reaching through full x/y/z to genuinely connect Tier-1 shapes rather
  // than just anchoring one end. line/bezier reach BOTH ends toward two
  // different shapes whenever a second one exists (mode:'span' - a direct
  // tube between the two touch points, bowed for bezier); arcline does the
  // same span reach now too; spiral anchors one end (its coiled shape can't
  // freely reach a second arbitrary point) but still traverses its OTHER
  // end's Z toward a real second target when one exists, rather than an
  // arbitrary wiggle - CONNECTOR_FREE_END_TILT is only the fallback for the
  // rare case no second target exists at all (e.g. a single-Tier-1-shape
  // composition).
  // (CONNECTOR_FREE_END_TILT is module-scope now - computeConnectorAnchor
  // must resolve the SAME fallback before its clearance check runs, or the
  // checked tilt and the rendered tilt disagree. See the fallback below.)

  // Every connector picks its OWN nearest Tier-1 target independently, which
  // can leave a shape with nothing pointing at it at all if it never
  // happened to be closest to anything - and now that shapes don't kiss
  // each other anymore (they're the BODY, staying exactly where the 2D
  // layout put them; lines/arcs/beziers are the SKELETON that does the
  // actual connecting), a shape with no connector reaching it has no
  // visible connection to the rest of the sculpture at all - it just
  // floats at its own 2D spot, unsupported. Reserve the nearest available
  // arc for every Tier-1 shape/lattice that needs one (falling back to
  // bezier/line/spiral if there aren't enough arcs) BEFORE the normal
  // per-connector pass runs, so as many as possible are guaranteed a real
  // connection - "likely at the end of an arc." Secondary body shapes -
  // lattices and concentricCircles (with or without a halo) - go first:
  // "place the secondary body shapes and elements... [after] the first 2
  // [primary/trunk] shapes." Lattices don't kiss as convincingly as a real
  // polygon/disc profile even when they DO get a contact (see
  // latticeVolumeRadius3D's plain-sphere approximation), and a
  // concentricCircle's stacked-ring silhouette has the same issue - a
  // visible connector matters most for both. The reserve simply runs out
  // once the connector pool is smaller than the shape count, an honest
  // limit, not a bug.
  const forcedTargetFor = new Map(); // `${kind}_${idx}` -> Tier-1 node
  {
    const pools = { arcline: arcLines, bezier: beziers, line: lines, spiral: spirals };
    const cursor = { arcline: 0, bezier: 0, line: 0, spiral: 0 };
    const isSecondaryBody = t => t === 'lattice' || t === 'concentricCircle';
    const needConnector = tier1Nodes.filter(n => !n.isBase);
    needConnector.sort((a, b) => (isSecondaryBody(a.shapeType) ? 0 : 1) - (isSecondaryBody(b.shapeType) ? 0 : 1));
    needConnector.forEach(shapeNode => {
      for (const kind of ['arcline', 'bezier', 'line', 'spiral']) {
        const pool = pools[kind];
        if (cursor[kind] < pool.length) {
          forcedTargetFor.set(`${kind}_${cursor[kind]}`, shapeNode);
          cursor[kind]++;
          return;
        }
      }
      console.warn(`⚠️ ${shapeNode.key} has no spare connector element to guarantee a Tier-2 link - it stays at its exact 2D position with no connector reaching it`);
    });
  }

  function realizeConnector(kind, el, i, createFn, namePrefix) {
    const forced = forcedTargetFor.get(`${kind}_${i}`) || null;
    const anchor = computeConnectorAnchor(kind, el, globalIndex++, tier1Nodes, forced, claimedSecondaryTargets);

    // No independent base leg here (removed) - a connector's anchor is a
    // point on a Tier-1 shape's surface, and that shape either already has
    // its own leg or reaches one through the connected tree; a separate leg
    // straight down from the connector's own anchor had no guarantee of
    // landing anywhere near the base ring's footprint.

    const layerZ = anchor ? -anchor.targetWorldZ : 0;
    const zTilt = anchor && anchor.zTilt != null ? anchor.zTilt : synthesizedZBias(globalIndex) * CONNECTOR_FREE_END_TILT;
    const anchorT = anchor ? anchor.anchorT : 0.5;
    const deltaPixel = anchor ? anchor.deltaPixel : null;
    const success = createFn(el, i, layerZ, zTilt, anchorT, deltaPixel);
    if (success && anchor && anchor.primaryAnchorWorld) markConnectionPoint(`conndot_${namePrefix}_${i}`, anchor.primaryAnchorWorld);
    if (success && anchor && anchor.targetNode) skeletonConnectedNodes.add(anchor.targetNode);
    // A long arc strung through several shapes (computeArcStringTargets)
    // genuinely touches each of them too, not just the primary target -
    // mark those contact points and count them as real connections, same as
    // the primary anchor.
    if (success && anchor && anchor.stringAnchors) {
      anchor.stringAnchors.forEach((p, si) => markConnectionPoint(`conndot_${namePrefix}_${i}_string${si}`, p));
    }
    if (success && anchor && anchor.stringTargetNodes) {
      anchor.stringTargetNodes.forEach(n => skeletonConnectedNodes.add(n));
    }
    if (success) {
      const pos = anchor && anchor.primaryAnchorWorld ? anchor.primaryAnchorWorld : { x: 0, y: 0, z: -layerZ };
      massEntries.push({ x: pos.x, y: pos.y, z: pos.z, mass: connectorMass(kind, el) });
    }
    return success;
  }

  lines.forEach((line, i) => {
    const success = realizeConnector('line', line, i, create3DLine, 'line');
    if (success) { totalConverted++; conversionStats.lines++; }
    else conversionStats.failed.push({type: 'line', index: i});
  });
  beziers.forEach((bz, i) => {
    const success = realizeConnector('bezier', bz, i, create3DBezier, 'bezier');
    if (success) { totalConverted++; conversionStats.lines++; }
    else conversionStats.failed.push({type: 'bezier', index: i});
  });
  arcLines.forEach((arcEl, i) => {
    const success = realizeConnector('arcline', arcEl, i, create3DArcLine, 'arcline');
    if (success) { totalConverted++; conversionStats.lines++; }
    else conversionStats.failed.push({type: 'arcLine', index: i});
  });
  spirals.forEach((sp, i) => {
    const success = realizeConnector('spiral', sp, i, create3DSpiral, 'spiral');
    if (success) { totalConverted++; conversionStats.lines++; }
    else conversionStats.failed.push({type: 'spiral', index: i});
  });

  // Dotted support struts (real, visible cylinders) - a LAST RESORT, not a
  // default: the sculpture should be largely self-supporting through the
  // skeleton of line/arc/bezier elements passing through it. This used to
  // stop at "does every shape near the base have a connector or a strut" -
  // which left large/heavy shapes anywhere ELSE in the piece (nowhere near
  // the base, and never picked as any connector's nearest target) with
  // literally nothing touching them at all: not a connector, not a strut,
  // just floating in isolated space - "in the back one of the larger shapes
  // is just floating." A real object can't have a chunk of itself connected
  // to nothing, so this now runs a full connectivity closure: EVERY Tier-1
  // shape/lattice must end up physically linked (skeleton connector, or a
  // drawn strut) into the one structure that's rooted at the base, however
  // many extra struts that takes. Struts are still only drawn where a real
  // connector didn't already do the job, so a well-connected composition
  // still gets few or none.
  // Does the straight segment pA-pB pass within `other`'s own bounding
  // radius of its center, for any Tier-1 shape other than the ones this
  // particular strut is legitimately connecting? Closest-point-on-segment
  // test, not just endpoint distance - a path can clip straight through a
  // shape's middle without either endpoint being anywhere near it. Defined
  // at function scope (not inside the `if (baseNode)` strut block below) so
  // the separate gravitational-stability outrigger can also route through
  // drawClearStrut - "any aux support" means every strut-drawing site, not
  // just the ones in the main pass.
  const segmentClearOfShapes = (pA, pB, ...exclude) => tier1Nodes.every(other => {
    if (other.isBase || exclude.includes(other)) return true;
    const oc = tier1WorldCenter(other);
    const abx = pB.x - pA.x, aby = pB.y - pA.y, abz = pB.z - pA.z;
    const abLenSq = abx * abx + aby * aby + abz * abz || 1;
    let t = ((oc.x - pA.x) * abx + (oc.y - pA.y) * aby + (oc.z - pA.z) * abz) / abLenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = pA.x + abx * t, cy = pA.y + aby * t, cz = pA.z + abz * t;
    return Math.hypot(cx - oc.x, cy - oc.y, cz - oc.z) >= other.r;
  });
  // "These are all solid objects... they can't [pass through each other]...
  // they must be fastened to each other on the surface." EVERY aux support
  // in this file routes through this one function now, not just one pass -
  // tries the direct line first, and if that would clip through some OTHER
  // Tier-1 shape's volume along the way, bends through a waypoint pushed
  // further back (away from the denser front of the piece) until both
  // segments are clear, escalating over a bounded search. Falls back to
  // the direct line only if nothing clear turns up at all (still real
  // bracing, just not guaranteed obstruction-free in that rare case) -
  // draws whichever path it settles on as 1-2 real tube segments.
  // `grounded`: does this strut actually land on the BASE? Only the ones
  // that do are the piece's real metalwork and take the chosen strut
  // material - "only struts coming up from the base should be metallic or
  // clear". Everything else is a shape-to-shape brace and is always black,
  // whatever the material picker says. Passed down per STRUT rather than per
  // segment, so a strut that has to bend around an obstruction still draws
  // both of its segments as one consistent rod.
  const drawClearStrut = (name, pA, pB, width, radiusCap, grounded, ...exclude) => {
    let path = [pA, pB];
    if (!segmentClearOfShapes(pA, pB, ...exclude)) {
      const pushStep = Math.max(baseNode ? baseNode.zHalf : 1, 1);
      for (let k = 1; k <= 12; k++) {
        const waypoint = { x: pA.x, y: pA.y, z: Math.max(pA.z, pB.z) + pushStep * k };
        if (segmentClearOfShapes(pA, waypoint, ...exclude) && segmentClearOfShapes(waypoint, pB, ...exclude)) {
          path = [pA, waypoint, pB];
          break;
        }
      }
    }
    for (let seg = 0; seg < path.length - 1; seg++) {
      createSolidTube3D(`${name}_${seg}`, path[seg], path[seg + 1], width, radiusCap, grounded);
    }
  };

  if (baseNode) {
    const DOWN = { x: 0, y: -1, z: 0 };
    const baseTopY = baseNode.y + baseNode.zHalf;
    const baseCenterXZ = tier1WorldCenter(baseNode);
    const connected = new Set(skeletonConnectedNodes); // seeded with every node a real skeleton connector already reached (may include the base itself)
    const groundedNodes = new Set(); // nodes with a strut reaching the BASE directly (not just connected to some other shape - see Pass 6)
    let strutCount = 0;

    // A shape's OWN x/z is only a valid base attachment point if that x/z
    // actually lands within the base's real ALLOWED anchor region - not the
    // beveled edge, and not the 1" boundary just inside the flat surface's
    // own edge either ("do not anchor any struts to the beveled edge...
    // create a 1 inch boundary on the outside of the flat surface and do
    // not anchor aux struts to that either"). Clamp to that safe rectangle
    // (baseAnchorHalfExtents) in the true direction toward the shape, so the
    // strut always ends somewhere genuinely safe to touch - a diagonal
    // brace for anything cantilevered out past it, a normal vertical leg
    // for anything already within it.
    const baseAnchor = baseAnchorHalfExtents(baseNode);
    const baseAttachPoint = (x, z) => {
      const localX = Math.max(-baseAnchor.halfW, Math.min(baseAnchor.halfW, x - baseCenterXZ.x));
      const localZ = Math.max(-baseAnchor.halfD, Math.min(baseAnchor.halfD, z - baseCenterXZ.z));
      return { x: baseCenterXZ.x + localX, y: baseTopY, z: baseCenterXZ.z + localZ };
    };

    const drawBaseStrut = (n, name, width = 2) => {
      // Lattices never get a direct-to-base connection, from ANY pass that
      // shares this helper - "lattices are only supported by horizontal
      // braces from other shapes behind them... the idea is that they
      // appear to be floating." See the dedicated lattice-brace pass below
      // for what they get instead.
      if (n.shapeType === 'lattice') return;
      const wz = tier1WorldCenter(n).z;
      const lowestY = n.y - semiCircleAwareDistance(n, DOWN);
      const shapePoint = { x: n.x, y: lowestY, z: wz };
      const basePoint = baseAttachPoint(n.x, wz);
      drawClearStrut(`base_strutsupport_${name}`, shapePoint, basePoint, width, strutRadiusCap(n), true, n);
      markConnectionPoint(`conndot_basesupport_shape_${name}`, shapePoint, AUX_SUPPORT_HEAD_RADIUS);
      markConnectionPoint(`conndot_basesupport_base_${name}`, basePoint, AUX_SUPPORT_HEAD_RADIUS);
      connected.add(n);
      groundedNodes.add(n);
      strutCount++;
    };
    // Approximate real-world gap between two Tier-1 shapes' surfaces (center
    // distance minus both radii) - only used to RANK candidates for the
    // closure pass below, not to place anything, so the isotropic
    // approximation is fine even for polygon profiles.
    const tier1SurfaceGap = (a, b) => {
      const ca = tier1WorldCenter(a), cb = tier1WorldCenter(b);
      return Math.hypot(ca.x - cb.x, ca.y - cb.y, ca.z - cb.z) - a.r - b.r;
    };
    // Shape-to-shape strut: real oriented touch points on each shape's own
    // surface, facing each other - the same supportDistanceWorld machinery
    // buildElementTree itself uses, so the strut always starts/ends exactly
    // on each shape's true boundary, not its bounding sphere.
    const drawShapeStrut = (a, b, name, width = 3) => {
      const ca = tier1WorldCenter(a), cb = tier1WorldCenter(b);
      const dx = cb.x - ca.x, dy = cb.y - ca.y, dz = cb.z - ca.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const dir = { x: dx / len, y: dy / len, z: dz / len };
      const distA = semiCircleAwareDistance(a, dir);
      const distB = semiCircleAwareDistance(b, { x: -dir.x, y: -dir.y, z: -dir.z });
      const pA = { x: ca.x + dir.x * distA, y: ca.y + dir.y * distA, z: ca.z + dir.z * distA };
      const pB = { x: cb.x - dir.x * distB, y: cb.y - dir.y * distB, z: cb.z - dir.z * distB };
      drawClearStrut(`base_strutsupport_${name}`, pA, pB, width, Math.min(strutRadiusCap(a), strutRadiusCap(b)), false, a, b);
      markConnectionPoint(`conndot_basesupport_a_${name}`, pA, AUX_SUPPORT_HEAD_RADIUS);
      markConnectionPoint(`conndot_basesupport_b_${name}`, pB, AUX_SUPPORT_HEAD_RADIUS);
      connected.add(a); connected.add(b);
      strutCount++;
    };

    // Large/elevated shapes get their OWN dedicated tripod+diagonal bracing
    // in Pass 5 below, unconditionally - computed here (before every earlier
    // pass runs) so those passes can skip these shapes entirely instead of
    // ALSO landing a redundant extra leg on top of Pass 5's own 4, which was
    // stacking up to 5 struts on a single large shape ("we only need 3 or
    // 4... 2 or 3 straight ones at the bottom and a 3rd diagonal one").
    const nonBaseNodes = tier1Nodes.filter(n => !n.isBase);
    const avgR2 = nonBaseNodes.length ? nonBaseNodes.reduce((s, n) => s + n.r, 0) / nonBaseNodes.length : 0;
    const maxYAbove = Math.max(1, ...nonBaseNodes.map(n => n.y - baseTopY));
    const LARGE_R_THRESHOLD = avgR2 * 1.3;
    const HIGH_Y_THRESHOLD = maxYAbove * 0.4;
    const isReinforcedTarget = n => n.shapeType !== 'lattice' && n.r >= LARGE_R_THRESHOLD && (n.y - baseTopY) >= HIGH_Y_THRESHOLD;
    // Shared heavy/light split for the passes below - this is a MINIATURE
    // ("nobody will be in danger"), so light shapes lean on the skeleton and
    // closure network alone, and only genuinely heavy masses earn extra
    // dedicated struts. Keeps the strut count down so the stand doesn't
    // crowd the actual composition.
    const avgNodeMass = nonBaseNodes.length
      ? nonBaseNodes.reduce((s, n) => s + tier1NodeMass(n), 0) / nonBaseNodes.length
      : 0;

    // Pass 0 (trunk): "the first two large shapes that are drawn must
    // connect directly to the base." skeletonNodeFor[0]/[1] are the
    // composition's two primary body shapes (window.skeletons - always
    // drawn first, always exactly two) - the trunk everything else roots
    // through, per the user's own tree model (base -> trunk -> connector
    // "branches" -> secondary body shapes, with a direct-to-base strut only
    // as the fallback for anything that doesn't reach the tree). Forced
    // unconditionally, same as the cantilever/reinforced passes - not
    // gated on whether a skeleton connector already reaches them. Skipped
    // for a trunk shape that also qualifies as an isReinforcedTarget (a
    // skeleton is often the single largest shape in the piece) - Pass 5's
    // own tripod+diagonal already grounds it more thoroughly than this
    // single leg would, so adding this one too was pure stacking.
    skeletonNodeFor.slice(0, 2).forEach((n, i) => {
      if (!n || isReinforcedTarget(n)) return;
      drawBaseStrut(n, `trunk_${i}`, 5);
    });

    // Pass 1 (opportunistic): shapes with no skeleton connector at all that
    // are already close enough to the base for a strut to read as genuine
    // contact, not a reach across empty space.
    tier1Nodes.forEach((n, ni) => {
      if (n.isBase || connected.has(n) || isReinforcedTarget(n)) return;
      const proximityMargin = Math.max(n.r * 0.5, baseNode.zHalf);
      const lowestY = n.y - semiCircleAwareDistance(n, DOWN);
      if (lowestY - baseTopY <= proximityMargin) drawBaseStrut(n, `near_${ni}`, 2);
    });

    // Pass 2: guarantee the BASE ITSELF has at least one real connection - a
    // single hair-thin thread to whatever happened to be physically nearest
    // reads as an accident, not a support, so if nothing above already
    // reached it (no opportunistic strut, no connector/ornament that
    // targeted it directly), plant a proper multi-leg foot: up to 3 of the
    // closest Tier-1 shapes (never just one - real stands don't balance on
    // a single point), each with a visibly THICKER leg, ignoring whether
    // they already have other skeleton connections elsewhere.
    if (!connected.has(baseNode)) {
      const ranked = tier1Nodes
        .filter(n => !n.isBase && n.shapeType !== 'lattice' && !isReinforcedTarget(n)) // lattices never anchor the base either - see drawBaseStrut's own guard; reinforced targets get Pass 5's own bracing instead
        .map(n => ({ n, gap: (n.y - semiCircleAwareDistance(n, DOWN)) - baseTopY }))
        .sort((a, b) => a.gap - b.gap);
      if (ranked.length > 0) {
        const nearGapBand = ranked[0].gap + Math.max(ranked[0].n.r, 4) * 2;
        // 2 legs, not the old 3 - still never one point of balance, but a
        // miniature's guaranteed foot doesn't need a third
        const legs = ranked.filter(c => c.gap <= nearGapBand).slice(0, 2);
        legs.forEach((c, idx) => drawBaseStrut(c.n, `guaranteed_${idx}`, 5));
      }
      connected.add(baseNode);
    }

    // Pass 3 (connectivity closure): repeatedly bridge whichever
    // (unconnected shape, connected shape) pair is physically closest, until
    // every Tier-1 element is part of the same rigid structure as the base -
    // fixes shapes ANYWHERE in the piece (not just near the base) that never
    // got a skeleton connector and weren't close enough to the base for pass
    // 1 either, which used to leave them rendered with nothing touching them
    // at all. Only falls back to a direct (possibly long) leg straight to
    // the base if no connected shape remains as a nearer option.
    let guard = 0;
    while (guard++ < tier1Nodes.length + 5) {
      let best = null, bestGap = Infinity;
      tier1Nodes.forEach(o => {
        if (o.isBase || connected.has(o) || isReinforcedTarget(o)) return;
        connected.forEach(c => {
          if (c.isBase) return;
          const gap = tier1SurfaceGap(o, c);
          if (gap < bestGap) { bestGap = gap; best = { o, c }; }
        });
      });
      if (best) { drawShapeStrut(best.o, best.c, `closure_${guard}`, 3); continue; }
      const orphan = tier1Nodes.find(o => !o.isBase && !connected.has(o) && !isReinforcedTarget(o));
      if (!orphan) break;
      drawBaseStrut(orphan, `closure_base_${guard}`, 3);
    }

    // Pass 4 (cantilever anchoring): a thin skeleton connector is enough to
    // count as "touched" (Pass 1-3 above), but it's not credible physical
    // support for something hanging entirely outside the base's own
    // footprint - gravity puts a real tipping/cantilever moment on anything
    // out there, and a single flexible wire reaching it doesn't change that.
    // Brace every such shape to the base too (drawBaseStrut's baseAttachPoint
    // clamps to the base's real rim for anything this far out, a genuine
    // diagonal brace rather than a vertical drop into empty air), regardless
    // of whatever else already reaches it - a cantilever needs bracing
    // against solid ground, not just a wire back to the rest of the structure.
    let cantileverCount = 0;
    tier1Nodes.forEach((o, oi) => {
      if (o.isBase || o.shapeType === 'lattice' || isReinforcedTarget(o)) return; // lattices only ever get the horizontal brace pass below, even when cantilevered; reinforced targets get Pass 5's own bracing (its legs already clamp into the base's safe anchor rect, becoming a diagonal brace on their own when cantilevered)
      // Miniature-scale judgment call: a LIGHT shape that's already fastened
      // into the structure doesn't tip anything even hanging outside the
      // footprint - bracing every such shape was a big part of the strut
      // forest crowding the composition. Only heavy cantilevered masses
      // (or ones with no connection at all) still get the brace.
      if (tier1NodeMass(o) < avgNodeMass && connected.has(o)) return;
      const oc = tier1WorldCenter(o);
      const horizDist = Math.hypot(oc.x - baseCenterXZ.x, oc.z - baseCenterXZ.z);
      if (horizDist <= baseNode.r) return; // within the footprint - no cantilever risk
      drawBaseStrut(o, `cantilever_${oi}`, 3);
      cantileverCount++;
    });
    if (cantileverCount > 0) console.log(`🦯 ${cantileverCount} cantilever brace(s) - heavy or unconnected shape(s) outside the base's footprint, given real support to the ground`);

    // Pass 5 (reinforced bracing): "large shapes should have 3 structural
    // supports at the bottom of the shape, and 1 diagonal support from
    // behind to back face." A single leg is fine for most shapes, but a
    // big, elevated mass balanced on ONE point is a real tipping risk in a
    // way a small or low shape isn't. Large (above-average radius) AND
    // meaningfully elevated shapes get a real tripod foot (3 legs, fanned
    // out under the shape, not one centered leg) plus a diagonal brace
    // running from the shape's own BACK face to the base's rim in the
    // shape's own direction - real triangulated bracing, the same technique
    // a museum mount would use for a top-heavy piece, not just another
    // vertical leg.
    const TRIPOD_LEG_COUNT = 2; // + 1 diagonal below = 3 struts total per shape - "we only need 3 or 4... 2 or 3 straight ones at the bottom and a 3rd diagonal one"; on a miniature, 2 straight + 1 diagonal is a sound tripod (three contact points, triangulated)
    let reinforcedCount = 0;
    nonBaseNodes.forEach((n, ni) => {
      if (!isReinforcedTarget(n)) return;
      const wz = tier1WorldCenter(n).z;
      // Tripod: fan 3 rays out from the shape's TRUE CENTER toward 3
      // landing points on the base, but only draw each strut from where its
      // ray actually EXITS the shape's real boundary onward - the center
      // itself is buried inside solid material, so the segment from center
      // to that exit point is deleted, never rendered. These are the
      // "straight" supports ("3 structural supports at the bottom of the
      // shape") - the ONE diagonal support is the separate back-face brace
      // below, so the horizontal spread here is kept to a modest fraction
      // of how far each leg actually drops to the base, keeping the angle
      // off vertical shallow (still 3 visibly distinct feet, just not a
      // second set of diagonal braces).
      const shapeCenter = { x: n.x, y: n.y, z: wz };
      const heightAbove = n.y - baseTopY;
      const legSpread = Math.min(Math.max(n.r * 0.5, 2), Math.max(heightAbove * 0.35, 1.5));
      for (let li = 0; li < TRIPOD_LEG_COUNT; li++) {
        const azimuth = (li / TRIPOD_LEG_COUNT) * Math.PI * 2;
        const aimX = n.x + Math.cos(azimuth) * legSpread;
        const aimZ = wz + Math.sin(azimuth) * legSpread;
        const legBasePoint = baseAttachPoint(aimX, aimZ);
        const dx = legBasePoint.x - shapeCenter.x, dy = legBasePoint.y - shapeCenter.y, dz = legBasePoint.z - shapeCenter.z;
        const dlen = Math.hypot(dx, dy, dz) || 1;
        const dir = { x: dx / dlen, y: dy / dlen, z: dz / dlen };
        const exitDist = semiCircleAwareDistance(n, dir);
        const legTopPoint = { x: shapeCenter.x + dir.x * exitDist, y: shapeCenter.y + dir.y * exitDist, z: shapeCenter.z + dir.z * exitDist };
        drawClearStrut(`base_reinforced_leg_${ni}_${li}`, legTopPoint, legBasePoint, 3, strutRadiusCap(n), true, n);
        markConnectionPoint(`conndot_reinforced_leg_shape_${ni}_${li}`, legTopPoint, AUX_SUPPORT_HEAD_RADIUS);
        markConnectionPoint(`conndot_reinforced_leg_base_${ni}_${li}`, legBasePoint, AUX_SUPPORT_HEAD_RADIUS);
      }
      const toShapeX = n.x - baseCenterXZ.x, toShapeZ = wz - baseCenterXZ.z;
      const toShapeLen = Math.hypot(toShapeX, toShapeZ) || 1;
      // baseAttachPoint already clamps into the safe anchor rectangle (never
      // the bevel, never its 1" margin) - aim toward the shape and let it
      // clamp, rather than hand-rolling a separate (unsafe) radius here.
      const diagBasePoint = baseAttachPoint(
        baseCenterXZ.x + (toShapeX / toShapeLen) * baseNode.r,
        baseCenterXZ.z + (toShapeZ / toShapeLen) * baseNode.r
      );
      // Diagonal face brace: rotates ONLY about the X axis - X stays locked
      // at 0 (never sways to a side face, which read as "pointless" since a
      // side attachment does nothing to resist front/back tipping), while Y
      // and Z vary freely so the brace can angle up or down toward wherever
      // the base attachment actually sits instead of a fixed flat 90-degree
      // offset. Z is floored just above 0 so it always stays on the BACK
      // face, never swinging to the front.
      const rawY = diagBasePoint.y - n.y, rawZ = Math.max(0.05, diagBasePoint.z - wz);
      const rawLen = Math.hypot(rawY, rawZ) || 1;
      const faceDir = { x: 0, y: rawY / rawLen, z: rawZ / rawLen };
      const faceDist = semiCircleAwareDistance(n, faceDir);
      const facePoint = { x: n.x, y: n.y + faceDir.y * faceDist, z: wz + faceDir.z * faceDist };
      // A straight line from the back face to the base can still cut through
      // some OTHER shape sitting behind/beside this one - "supports from the
      // back diagonally, and doesn't go through any other shape behind it."
      // Doesn't need to be a fixed angle - drawClearStrut bends it through an
      // intermediate waypoint if the direct path isn't clear.
      drawClearStrut(`base_reinforced_diag_${ni}`, facePoint, diagBasePoint, 3, strutRadiusCap(n), true, n);
      markConnectionPoint(`conndot_reinforced_diag_shape_${ni}`, facePoint, AUX_SUPPORT_HEAD_RADIUS);
      markConnectionPoint(`conndot_reinforced_diag_base_${ni}`, diagBasePoint, AUX_SUPPORT_HEAD_RADIUS);
      connected.add(n);
      groundedNodes.add(n);
      reinforcedCount++;
    });
    if (reinforcedCount > 0) console.log(`🦯 ${reinforcedCount} large/elevated shape(s) given a 3-leg tripod foot plus a diagonal back brace`);

    // Pass 6 (ground the HEAVY shapes): the passes above guarantee GRAPH
    // connectivity to the base - a chain of skeleton wires and/or
    // shape-to-shape struts - but a heavy shape hanging three hops down a
    // chain of thin wires doesn't credibly read as "supported" even though
    // it's technically connected. This used to ground EVERY body shape,
    // which en masse drew a forest of near-vertical legs under the whole
    // piece - scaffolding, not sculpture, and exactly against the "largely
    // self-supporting through the skeleton, struts as a LAST RESORT" rule.
    // Only shapes with above-average REAL mass (the ones whose weight
    // genuinely demands their own load path) get a dedicated leg now; light
    // shapes stay held by the skeleton/closure network they're already
    // connected through. Skipped as before for anything already grounded,
    // resting flush on a grounded shape, or a lattice (float rule).
    let groundedCount = 0, bridgedCount = 0;
    nonBaseNodes.forEach((n, ni) => {
      if (n.shapeType === 'lattice' || groundedNodes.has(n)) return; // lattices only ever get the horizontal brace pass below
      if (tier1NodeMass(n) < avgNodeMass) return; // light enough for the skeleton/closure network alone
      const restingOnGrounded = nonBaseNodes.some(other =>
        other !== n && groundedNodes.has(other) && tier1SurfaceGap(n, other) < Math.max(n.r, other.r) * 0.08
      );
      if (restingOnGrounded) return;
      // Prefer a SHORT strut into an already-grounded shape over a long leg
      // all the way down to the base. Both are real load paths, but the
      // short one is the structurally better choice (a brief, triangulated
      // transfer into standing structure instead of a long slender column)
      // AND the visually better one - the long near-vertical legs are
      // exactly what was "getting in the way of the actual composition,"
      // since they run the full height of the piece straight through it.
      const dropLen = (n.y - semiCircleAwareDistance(n, DOWN)) - baseTopY;
      let bridge = null, bridgeGap = Infinity;
      nonBaseNodes.forEach(other => {
        if (other === n || !groundedNodes.has(other) || other.shapeType === 'lattice') return;
        const gap = tier1SurfaceGap(n, other);
        if (gap < bridgeGap) { bridgeGap = gap; bridge = other; }
      });
      if (bridge && bridgeGap < dropLen * 0.6) {
        drawShapeStrut(n, bridge, `ground_bridge_${ni}`, 3);
        groundedNodes.add(n); // now riding a grounded shape's own load path
        bridgedCount++;
      } else {
        drawBaseStrut(n, `ground_${ni}`, 3);
        groundedCount++;
      }
    });
    if (groundedCount + bridgedCount > 0) console.log(`🦯 ${groundedCount} heavy shape(s) given a direct leg to the base, ${bridgedCount} bridged into nearer standing structure instead (shorter load path, less crossing the composition) - lighter shapes ride the skeleton/closure network`);

    // Pass 7 (lattice float): lattices never connect to the base directly
    // (drawBaseStrut's own guard, plus the explicit skips in passes 2/4/5/6
    // above) - "lattices are only supported by horizontal braces from other
    // shapes behind them... the idea is that they appear to be floating."
    // Every lattice gets a level (Y unchanged - no vertical component at
    // all) brace to the nearest OTHER Tier-1 shape genuinely BEHIND it
    // (larger world Z, further from camera), reading as a bracket reaching
    // back into the piece rather than a leg down to the ground. Falls back
    // to whatever's nearest in any direction only if nothing at all sits
    // behind it - better than leaving a lattice completely unbraced.
    let latticeBraceCount = 0;
    nonBaseNodes.filter(n => n.shapeType === 'lattice').forEach((n, ni) => {
      const nWc = tier1WorldCenter(n);
      // A LEVEL brace at the lattice's own height can only fasten to a shape
      // whose volume actually SPANS that height. The old pick ranked
      // candidates by horizontal distance alone and then pinned the brace's
      // far endpoint at the lattice's Y anyway - with the contact offset
      // measured from the target's CENTER (a different height entirely), so
      // a nearest-behind shape sitting higher or lower got its "contact"
      // point hanging in empty air beside it: a strut fastened to nothing,
      // the lattice visibly (and physically) unsupported.
      const spansHeight = other => {
        const oWc = tier1WorldCenter(other);
        return pointInsideTier1Volume({ x: oWc.x, y: nWc.y, z: oWc.z }, other);
      };
      let behind = null, behindDist = Infinity, level = null, levelDist = Infinity;
      let anyBehind = null, anyBehindDist = Infinity, any = null, anyDist = Infinity;
      nonBaseNodes.forEach(other => {
        // Never anchor a lattice to ANOTHER lattice - lattices float, so a
        // lattice-to-lattice brace just chains two unsupported masses
        // together with still nothing underneath either of them.
        if (other === n || other.shapeType === 'lattice') return;
        const oWc = tier1WorldCenter(other);
        const d = Math.hypot(nWc.x - oWc.x, oWc.z - nWc.z);
        const isBehind = oWc.z > nWc.z;
        if (d < anyDist) { anyDist = d; any = other; }
        if (isBehind && d < anyBehindDist) { anyBehindDist = d; anyBehind = other; }
        if (!spansHeight(other)) return;
        if (d < levelDist) { levelDist = d; level = other; }
        if (isBehind && d < behindDist) { behindDist = d; behind = other; }
      });
      const target = behind || level; // prefer behind ("braces from shapes behind them"), else any direction that can truly take a level brace
      if (target) {
        const tWc = tier1WorldCenter(target);
        const dx = tWc.x - nWc.x, dz = tWc.z - nWc.z;
        const dLen = Math.hypot(dx, dz) || 1;
        const dir = { x: dx / dLen, y: 0, z: dz / dLen }; // level - no Y component
        const distA = semiCircleAwareDistance(n, dir);
        const pA = { x: nWc.x + dir.x * distA, y: nWc.y, z: nWc.z + dir.z * distA };
        // Ray-march the level line to where it truly ENTERS the target's
        // volume - the target's support distance from its own center is
        // measured at the wrong height for this brace, so probe the real
        // boundary along the actual brace line instead. The march always
        // terminates inside (spansHeight verified the endpoint is interior).
        const end = { x: tWc.x, y: nWc.y, z: tWc.z };
        let pB = end;
        for (let s = 0; s <= 60; s++) {
          const t = s / 60;
          const p = { x: pA.x + (end.x - pA.x) * t, y: nWc.y, z: pA.z + (end.z - pA.z) * t };
          if (pointInsideTier1Volume(p, target)) { pB = p; break; }
        }
        drawClearStrut(`base_strutsupport_latticebrace_${ni}`, pA, pB, 3, Math.min(strutRadiusCap(n), strutRadiusCap(target)), false, n, target);
        markConnectionPoint(`conndot_latticebrace_a_${ni}`, pA, AUX_SUPPORT_HEAD_RADIUS);
        markConnectionPoint(`conndot_latticebrace_b_${ni}`, pB, AUX_SUPPORT_HEAD_RADIUS);
        connected.add(n); connected.add(target);
        // The brace transfers the lattice's REAL weight (lattices are among
        // the heaviest bodies in the piece) onto its anchor shape - plus a
        // lever moment when the lattice hangs far out front. That load has
        // to continue DOWN: if the anchor doesn't already have its own
        // route to the base, give it one now regardless of its own mass -
        // a light anchor carrying a heavy lattice is load-bearing whether
        // or not Pass 6's own-mass threshold would have picked it.
        if (!groundedNodes.has(target)) drawBaseStrut(target, `latticeanchor_${ni}`, 3);
        latticeBraceCount++;
      } else if (anyBehind || any) {
        // NOTHING in the piece spans this lattice's height, so a level brace
        // cannot reach real material anywhere - fall back to a genuine
        // surface-to-surface strut to the nearest shape behind it (or
        // nearest anywhere as a last resort). Angled rather than level, but
        // fastened to real material at BOTH ends - and still never the
        // base, preserving the floating look as far as physics allows.
        const fallbackTarget = anyBehind || any;
        drawShapeStrut(n, fallbackTarget, `latticebrace_fallback_${ni}`, 3);
        // Same load-path rule as the level-brace case above: the fallback
        // anchor is carrying this lattice now, so it must reach the ground.
        if (!groundedNodes.has(fallbackTarget)) drawBaseStrut(fallbackTarget, `latticeanchor_${ni}`, 3);
        latticeBraceCount++;
      }
    });
    if (latticeBraceCount > 0) console.log(`🦯 ${latticeBraceCount} horizontal lattice brace(s) - lattices float, held only by a level brace to a shape behind them, never a direct base connection`);

    // Pass 8 (colored-arc far ends): each shape-type arc ornament is
    // fastened to a shape at exactly ONE point - give its queued far end
    // (see arcEndSupports) a THIN rod to the nearest real material: the
    // closest shape surface, or straight down to the base when that's
    // nearer. Skipped when the far end already rests against something.
    let arcEndCount = 0;
    arcEndSupports.forEach((sup, si) => {
      const p = sup.point;
      let best = null, bestGap = Infinity, bestTouch = null;
      tier1Nodes.forEach(nd => {
        if (nd.isBase) return;
        const wc = tier1WorldCenter(nd);
        const dx = p.x - wc.x, dy = p.y - wc.y, dz = p.z - wc.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        const dir = { x: dx / len, y: dy / len, z: dz / len };
        const sd = semiCircleAwareDistance(nd, dir);
        const gap = len - sd;
        if (gap < bestGap) {
          bestGap = gap;
          best = nd;
          bestTouch = { x: wc.x + dir.x * sd, y: wc.y + dir.y * sd, z: wc.z + dir.z * sd };
        }
      });
      if (bestGap < 0.5) return; // already effectively resting on real material
      const basePoint = baseAttachPoint(p.x, p.z);
      const dropLen = Math.hypot(p.x - basePoint.x, p.y - basePoint.y, p.z - basePoint.z);
      // ALWAYS connect. An earlier version only drew this rod when it could
      // be short (to stop struts crossing the composition) and skipped it
      // otherwise - but "otherwise" is exactly the case of an arc sweeping
      // far out from the cluster, which is precisely the one that reads as
      // floating with nothing holding it. A long sweeping arc welded at a
      // single point is the LEAST self-supporting element in the piece, not
      // the most. Length now governs only how the rod is drawn, never
      // whether it exists: the shorter of (nearest shape surface, base) is
      // chosen, drawClearStrut bends it around anything in the way, and the
      // rod stays hair-thin (0.15 cap) so even a long one reads as a fine
      // wire rather than scaffolding.
      const useShape = best && bestGap <= dropLen;
      if (useShape) {
        drawClearStrut(`base_strutsupport_arcend_${si}`, p, bestTouch, 1.5, 0.15, false, best);
        markConnectionPoint(`conndot_arcend_${si}`, bestTouch, AUX_SUPPORT_HEAD_RADIUS * 0.6);
      } else {
        drawClearStrut(`base_strutsupport_arcend_${si}`, p, basePoint, 1.5, 0.15, true);
        markConnectionPoint(`conndot_arcend_${si}`, basePoint, AUX_SUPPORT_HEAD_RADIUS * 0.6);
      }
      arcEndCount++;
    });
    if (arcEndCount > 0) console.log(`🦯 ${arcEndCount} colored-arc far end(s) given a thin support rod - a single-point weld can't credibly hold a full sweep`);

    console.log(`🦯 ${strutCount} support strut(s) drawn - ${connected.size}/${tier1Nodes.length} Tier-1 elements now physically connected into one structure rooted at the base`);
  }

  // ===== Gravitational stability check: this is meant to stand as a real
  // freestanding miniature, so its mass-weighted center of gravity (every
  // resin shape/lattice, metal skeleton connector, and the heavy wood base
  // itself, gathered into massEntries above as each was created) needs to
  // fall within the base's own footprint - a tall composition leaning hard
  // to one side would physically tip over otherwise. Runs AFTER the regular
  // last-resort struts (which fix "this shape has no skeleton contact," a
  // different problem) since this checks the WHOLE assembly's balance, not
  // any one shape's support. Only draws anything if the piece would actually
  // tip - never a default addition, same "last resort" spirit as the struts.
  if (baseNode && massEntries.length > 0) {
    const totalMass = massEntries.reduce((s, m) => s + m.mass, 0);
    const cog = massEntries.reduce((acc, m) => ({
      x: acc.x + m.x * m.mass, y: acc.y + m.y * m.mass, z: acc.z + m.z * m.mass
    }), { x: 0, y: 0, z: 0 });
    cog.x /= totalMass; cog.y /= totalMass; cog.z /= totalMass;

    const baseCenter = tier1WorldCenter(baseNode);
    const offX = cog.x - baseCenter.x, offZ = cog.z - baseCenter.z;
    const horizOffset = Math.hypot(offX, offZ);
    // Tipping is judged against the slab's REAL rectangular bottom face (the
    // full-size sharp rectangle actually resting on the desk - see
    // createBaseMesh3D), not the abstract circular placement footprint
    // baseNode.r - per-axis, since a slab tips over an edge, not a rim. For
    // a wide composition renderW comfortably exceeds 2r, so the circular
    // check both flagged genuinely stable pieces as tippy in X (drawing
    // outriggers they didn't need) and judged Z against the wrong number.
    // STABILITY_FOOTPRINT_FACTOR still keeps the safe region well inside
    // the physical edge on each axis.
    const foot = baseTopCapHalfExtents(baseNode);
    const stableHalfW = foot.hw * STABILITY_FOOTPRINT_FACTOR;
    const stableHalfD = foot.hd * STABILITY_FOOTPRINT_FACTOR;
    const stable = Math.abs(offX) <= stableHalfW && Math.abs(offZ) <= stableHalfD;
    // Desk-scale sanity: the base is assumed 12" wide in the real world (the
    // exact assumption baseAnchorHalfExtents' 1" strut margin already makes)
    // - scale world units to cm from that and report the piece's estimated
    // real weight (resin shapes, thin metal wires, wood base), which should
    // land in the comfortably-desk-plausible range.
    const cmPerWorld = 30.48 / foot.w;
    const estKg = totalMass * Math.pow(cmPerWorld, 3) / 1000;
    console.log(`⚖️ Center of gravity (${cog.x.toFixed(1)}, ${cog.y.toFixed(1)}, ${cog.z.toFixed(1)}), offset from base center=(${offX.toFixed(1)}, ${offZ.toFixed(1)}) vs stable half-extents (${stableHalfW.toFixed(1)}, ${stableHalfD.toFixed(1)}), est. real weight ~${estKg.toFixed(2)} kg at a 12" base - ${stable ? 'STABLE, no extra support needed' : 'UNSTABLE, adding an outrigger brace'}`);

    if (!stable) {
      // A diagonal buttress from the base's rim, in the direction the COG
      // overhangs, to the real overhanging shape nearest that COG - the
      // real physical fix for a top-heavy/off-center piece (a wider foot
      // under the overhanging mass), rendered the same dotted-strut way as
      // the base and its last-resort legs so it visually reads as "part of
      // the stand," not a shape. The COG itself is just a mass-weighted
      // average position, not a real surface - a structural element must
      // never terminate at a point with no shape actually there, so this
      // targets the nearest ACTUAL Tier-1 shape's real boundary instead of
      // the raw (empty-air) COG point.
      const dirX = offX / horizOffset, dirZ = offZ / horizOffset;
      const baseTopY = baseNode.y + baseNode.zHalf;
      // Clamped into the same safe anchor rectangle as every other base
      // touch point - never the bevel, never its 1" margin.
      const rimAnchor = baseAnchorHalfExtents(baseNode);
      const rimLocalX = Math.max(-rimAnchor.halfW, Math.min(rimAnchor.halfW, dirX * baseNode.r));
      const rimLocalZ = Math.max(-rimAnchor.halfD, Math.min(rimAnchor.halfD, dirZ * baseNode.r));
      const rimPoint = { x: baseCenter.x + rimLocalX, y: baseTopY, z: baseCenter.z + rimLocalZ };
      const nonBaseForCog = tier1Nodes.filter(n => !n.isBase);
      let overhangNode = null, overhangDist = Infinity;
      nonBaseForCog.forEach(n => {
        const wc = tier1WorldCenter(n);
        const d = Math.hypot(wc.x - cog.x, wc.y - cog.y, wc.z - cog.z);
        if (d < overhangDist) { overhangDist = d; overhangNode = n; }
      });
      if (overhangNode) {
        const oc = tier1WorldCenter(overhangNode);
        const rdx = rimPoint.x - oc.x, rdy = rimPoint.y - oc.y, rdz = rimPoint.z - oc.z;
        const rlen = Math.hypot(rdx, rdy, rdz) || 1;
        const towardRim = { x: rdx / rlen, y: rdy / rlen, z: rdz / rlen };
        const surfaceDist = semiCircleAwareDistance(overhangNode, towardRim);
        const cogPoint = { x: oc.x + towardRim.x * surfaceDist, y: oc.y + towardRim.y * surfaceDist, z: oc.z + towardRim.z * surfaceDist };
        drawClearStrut('base_outrigger', rimPoint, cogPoint, 3, strutRadiusCap(overhangNode), true, overhangNode);
        markConnectionPoint('conndot_outrigger_base', rimPoint, AUX_SUPPORT_HEAD_RADIUS);
        markConnectionPoint('conndot_outrigger_cog', cogPoint, AUX_SUPPORT_HEAD_RADIUS);
      }
    }
  }

  // Frame camera around the ACTUAL resolved structure - re-targets the orbit
  // at its true center and picks a distance that guarantees everything fits
  // the FOV, then resets to that standard distance/angle (alpha/beta/radius
  // are what a drag or pinch then moves, so this is also what "reset"
  // returns them to). This replaced an older formula that assumed the
  // sculpture's x/y stayed centered at world (0,0) - not necessarily true
  // for a real 2D composition, and the base can extend well below the
  // lowest shape - a fixed target/distance left real chunks of the
  // structure (in particular, large shapes whose own radius pushed them
  // outside the old fixed frame) outside the visible frustum entirely.
  if (camera3D) {
    const fov = 0.45; // Natural lens

    // Bounding SPHERE (not just a box) of every real point in the scene -
    // each Tier-1 node's center+radius, computed around their own centroid
    // as the camera target. The base is already one of tier1Nodes (see the
    // gather loops above), so it's automatically included here too.
    // tier1WorldCenter IS the world-space truth here - this used to inline
    // `-(n.z - n.zOffset)`, negating the whole depth distribution (the same
    // stale "world Z = -node.z" leftover tier1WorldCenter/overlapsAnyPlaced/
    // touchPointFacing each had to shed), which mirrored the orbit target's
    // Z whenever the composition wasn't depth-symmetric.
    const boundedPoints = tier1Nodes.map(n => { const wc = tier1WorldCenter(n); return { x: wc.x, y: wc.y, z: wc.z, r: n.r }; });
    if (boundedPoints.length === 0) boundedPoints.push({ x: 0, y: 0, z: 0, r: 5 });

    const targetX = boundedPoints.reduce((s, p) => s + p.x, 0) / boundedPoints.length;
    const targetY = boundedPoints.reduce((s, p) => s + p.y, 0) / boundedPoints.length;
    const targetZ = boundedPoints.reduce((s, p) => s + p.z, 0) / boundedPoints.length;

    // Distance needed so a sphere of `boundingRadius` centered at the
    // target fits entirely inside the FOV cone from the camera - the
    // standard "fit a sphere in a cone" relation (sin, not tan, since this
    // bounds points at ANY distance from the camera, not just ones exactly
    // at the target's own depth).
    let boundingRadius = 1;
    boundedPoints.forEach(p => {
      const d = Math.hypot(p.x - targetX, p.y - targetY, p.z - targetZ) + p.r;
      boundingRadius = Math.max(boundingRadius, d);
    });
    const dist = (boundingRadius / Math.sin(fov / 2)) * 1.08; // small margin so nothing touches the frame edge

    // upperRadiusLimit is a HARD ceiling on how far ANY zoom - the auto-fit
    // below, or the user's own manual scroll/pinch - is allowed to push the
    // camera. It used to be a fixed 2000, which was fine back when shapes
    // always got compacted into a tight cluster; now that shapes keep their
    // exact 2D positions (no more rearranging), a real composition's
    // footprint can legitimately need more than that, which was silently
    // clamping the auto-fit distance short AND capping how far the user
    // could manually back away to compensate - "can't zoom out enough to
    // see what's going on." Give it real headroom over whatever THIS
    // composition actually needs, not a one-size-fits-all guess.
    camera3D.upperRadiusLimit = Math.max(2000, dist * 3);
    // The far clip plane must comfortably exceed how far the camera can
    // now actually zoom out to, or the camera could end up sitting beyond
    // its own visible range at the new upperRadiusLimit.
    camera3D.maxZ = Math.max(5000, camera3D.upperRadiusLimit * 1.5);

    camera3D.fov = fov;
    camera3D.target = new BABYLON.Vector3(targetX, targetY, targetZ);
    camera3D.alpha = -Math.PI / 2;
    camera3D.beta = Math.PI / 2;

    // Split the difference between the two extremes tried so far: matched to
    // the 2D canvas's own zoom (continuous-feeling transition, but often cut
    // off real chunks of the piece - especially the base) and the full
    // bounding-sphere fit (guarantees everything's visible, but starts
    // further out than the 2D view ever was). The midpoint still shows
    // nearly everything on entry while feeling closer to a continuation of
    // the 2D view than a hard zoom-out.
    const canvasMatchDist = window.innerHeight / (2 * K3D_SCALE * Math.tan(fov / 2));
    const startDist = (canvasMatchDist + dist) / 2;
    camera3D.radius = Math.min(Math.max(startDist, camera3D.lowerRadiusLimit || 5), camera3D.upperRadiusLimit);
    console.log(`📷 Camera: radius=${camera3D.radius.toFixed(1)} (2D-matching=${canvasMatchDist.toFixed(1)}, full-fit=${dist.toFixed(1)}), FOV=${fov}, target=(${targetX.toFixed(1)}, ${targetY.toFixed(1)}, ${targetZ.toFixed(1)}), boundingRadius=${boundingRadius.toFixed(1)}, upperRadiusLimit=${camera3D.upperRadiusLimit.toFixed(1)}`);
  }
  
  console.log(`✅ Converted ${totalConverted} elements to 3D!`);
  console.log('📈 Conversion breakdown:', {
    skeletons: `${conversionStats.skeletons}/${shapes.length}`,
    ornaments: `${conversionStats.ornaments}/${ornaments.length}`,
    // conversionStats.lines counts ALL four connector types (line/bezier/
    // arcline/spiral - see the realizeConnector call sites), so the
    // denominator must too, or this prints impossible ratios like "12/3"
    connectors: `${conversionStats.lines}/${lines.length + beziers.length + arcLines.length + spirals.length}`,
    lattices: `${conversionStats.lattices}/${lattices.length}`
  });
  
  if (conversionStats.failed.length > 0) {
    console.warn(`⚠️ Failed to convert ${conversionStats.failed.length} elements:`);
    console.table(conversionStats.failed);
  }
  
  if (totalConverted === 0) {
    console.warn('⚠️ No shapes were converted. The shapes might not be in the expected format.');
    console.log('Trying to inspect first shape:', shapes[0] || ornaments[0]);
  } else {
    console.log(`🎉 Successfully created ${totalConverted} 3D objects! Drag/swipe to orbit, scroll/pinch to zoom.`);
  }
  
  // Sky renders in group 0, artwork in group 1: the background can never
  // occlude the artwork, no matter how far the camera flies (group 0 always
  // renders - and is depth-tested - before group 1, regardless of actual
  // world-space distance)
  babylonScene.meshes.forEach(m => {
    m.renderingGroupId = m.name.startsWith('skyFace_') ? 0 : 1;
  });
}

// ===== Helpers for exact 2D -> 3D conversion =====
const K3D_SCALE = 8;
const K3D_BLACK = { r: 0, g: 0, b: 0, a: 1 };
// Global 3D translucency: multiplier on every colored BODY's own 2D alpha
// (shape fills, concentric rings, halo rings, lattice cells, open-shape
// textures). 3D reads more opaque than the 2D original at the same alpha -
// a real volume stacks its front face, side walls, and back face into the
// same pixel, where the 2D only ever painted one translucent layer - so
// the bodies get a uniform extra dose of translucency here. Deliberately
// NOT applied to black outlines/wires, the marble base, resin struts, or
// the red contact dots - the crisp opaque strokes are part of the 2D look.
const BODY_ALPHA_3D = 0.6; // was 0.75 - still read heavier than the 2D wash (front face + walls + back face all stack into one pixel)
// "Bring a little more color into 3D": alpha-blending a 0.6-alpha body over
// the pale paper wash dilutes every hue toward pastel, so the translucency
// fix washed the palette out. Compensate with SATURATION, not alpha - push
// each body color away from its own gray (luminance-preserving), so the
// pigment reads stronger while the watercolor translucency stays.
const BODY_SATURATION_3D = 1.35;
function saturate3D(rgba) {
  const lum = 0.2126 * rgba.r + 0.7152 * rgba.g + 0.0722 * rgba.b;
  const push = v => Math.max(0, Math.min(1, lum + (v - lum) * BODY_SATURATION_3D));
  return { r: push(rgba.r), g: push(rgba.g), b: push(rgba.b), a: rgba.a };
}
// The one-stop body color treatment: saturation compensation + the global
// translucency multiplier. Every colored BODY site uses this (or, where
// alpha is handled separately - open-shape textures - saturate3D directly).
function bodyColor3D(rgba) {
  const c = saturate3D(rgba);
  c.a = rgba.a * BODY_ALPHA_3D;
  return c;
}
// Nearly-invisible "cast resin" glass look - used for concentricArc's solid
// wedge (see createConcentricArc3D), a real physical body the nested
// stroke-only rings visually sit embedded inside, instead of bare open wire.
// Kept at 95% transparent with no outline (see createConcentricArc3D) - just
// enough presence to read as "there's clear material holding this together"
// without visually competing with the rings it's supporting.
const CLEAR_RESIN_COLOR = { r: 0.93, g: 0.96, b: 0.99, a: 0.05 };

function p5ColToRGBA(c) {
  // Handle p5.Color object
  if (c && c.levels) {
    return {
      r: c.levels[0] / 255,
      g: c.levels[1] / 255,
      b: c.levels[2] / 255,
      a: (c.levels[3] !== undefined ? c.levels[3] : 255) / 255
    };
  }
  // Handle hex string '#rrggbb' or '#rrggbbaa' (sceneReport format)
  if (typeof c === 'string' && c[0] === '#') {
    const hex = c.slice(1);
    return {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255,
      a: hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
    };
  }
  // Handle already-converted {r,g,b,a} object
  if (c && c.r !== undefined && c.g !== undefined && c.b !== undefined) {
    return { r: c.r, g: c.g, b: c.b, a: c.a !== undefined ? c.a : 1 };
  }
  // Handle number (0 = black in p5)
  if (typeof c === 'number') {
    const v = c / 255;
    return { r: v, g: v, b: v, a: 1 };
  }
  // Default gray
  return { r: 0.5, g: 0.5, b: 0.5, a: 1 };
}

// Unlit material = EXACT color match with 2D (no light darkening)
function unlitMat(name, rgba) {
  const m = new BABYLON.StandardMaterial(name, babylonScene);
  m.emissiveColor = new BABYLON.Color3(rgba.r, rgba.g, rgba.b);
  m.diffuseColor = new BABYLON.Color3(0, 0, 0);
  m.specularColor = new BABYLON.Color3(0, 0, 0);
  m.disableLighting = true;
  m.alpha = rgba.a;
  m.backFaceCulling = false;
  // Exact flat color for OBJ export, so the exporter never has to guess a
  // material's true color from lighting-affected properties
  m.metadata = { exportColor: { r: rgba.r, g: rgba.g, b: rgba.b, a: rgba.a } };
  return m;
}

// Tube stroke (2D strokeWeight analog). Path points are LOCAL coords around origin.
// `parent` (optional): a TransformNode carrying a contact-tilt orientation -
// when given, x/y/rotZ should already be the shape-local values (0/0/0) since
// the node itself supplies the world position/rotation.
function makeStrokeTube(name, localPts, radius, rgba, x, y, z, rotZ = 0, parent = null) {
  if (!localPts || localPts.length < 2) return null;
  const tube = BABYLON.MeshBuilder.CreateTube(name, {
    path: localPts,
    radius: Math.max(radius, 0.08),
    tessellation: 16, // was 8: visibly faceted/blocky on large or close-up curves
    cap: BABYLON.Mesh.CAP_ALL
  }, babylonScene);
  tube.position = new BABYLON.Vector3(x, y, z);
  tube.rotation.z = rotZ;
  tube.material = unlitMat(name + '_mat', rgba);
  if (parent) tube.parent = parent;
  return tube;
}

// Outlines a prism from all sides: matching perimeter tubes on the front and
// back faces, plus a vertical tube at each corner connecting them (the
// Z-axis edges) - without those, the depth walls between corners show as
// bare, unbordered seams from oblique angles. `loopPts` is the front-face
// outline path (local XY, z=0) exactly as passed to makeStrokeTube today.
// `edgeCorners` lists which points get a vertical edge - pass a subset (or
// none) for smooth/curved perimeters that have no true corners. Skip the
// back tube on finely-tessellated curves (circle/arc paths): viewed near
// edge-on, two close, near-parallel many-segment tubes interleave into a
// herringbone/hatch pattern - a straight-edged loop (few points) doesn't
// have enough segments for that to happen, so it's safe to double there.
function addPrismOutline(prefix, loopPts, depth, swr, x, y, z, rotZ, edgeCorners = [], addBack = true, parent = null) {
  // Snapshot the corner coordinates BEFORE building the front/back loop
  // tubes below - edgeCorners is commonly a handful of elements taken
  // straight out of loopPts (e.g. rp.slice(0,4)), so it shares the same
  // Vector3 instances. CreateTube's Path3D can end up normalizing/reusing
  // those instances internally; reading x/y off them afterward risked
  // picking up whatever it left behind instead of the real corner.
  const corners = edgeCorners.map(v => ({ x: v.x, y: v.y }));
  const frontZ = -(depth / 2 + 0.1);
  const backZ = depth / 2 + 0.1;
  makeStrokeTube(`${prefix}_front`, loopPts, swr, K3D_BLACK, x, y, z + frontZ, rotZ, parent);
  if (addBack) makeStrokeTube(`${prefix}_back`, loopPts, swr, K3D_BLACK, x, y, z + backZ, rotZ, parent);
  corners.forEach((v, i) => {
    makeStrokeTube(`${prefix}_edgeZ${i}`, [
      new BABYLON.Vector3(v.x, v.y, frontZ),
      new BABYLON.Vector3(v.x, v.y, backZ)
    ], swr, K3D_BLACK, x, y, z, rotZ, parent);
  });
}

// P5 arc angles (y-down) -> Babylon local points (Y flipped)
function arcPathLocal(r, a0, a1, segments = 48) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = a0 + (a1 - a0) * (i / segments);
    pts.push(new BABYLON.Vector3(r * Math.cos(t), -r * Math.sin(t), 0));
  }
  return pts;
}

// Extrude a closed XY profile into a prism along Z (deterministic orientation,
// unlike cylinder arc/tessellation whose start angle is ambiguous)
function extrudePrism(name, profileXY, depth, rgba, x, y, z, rotZ = 0, parent = null) {
  const closed = profileXY.slice();
  const first = closed[0], last = closed[closed.length - 1];
  if (first.x !== last.x || first.y !== last.y) closed.push(first.clone());
  const mesh = BABYLON.MeshBuilder.ExtrudeShape(name, {
    shape: closed,
    path: [new BABYLON.Vector3(0, 0, -depth / 2), new BABYLON.Vector3(0, 0, depth / 2)],
    cap: BABYLON.Mesh.CAP_ALL,
    sideOrientation: BABYLON.Mesh.DOUBLESIDE
  }, babylonScene);
  mesh.position = new BABYLON.Vector3(x, y, z);
  mesh.rotation.z = rotZ;
  mesh.material = unlitMat(name + '_mat', rgba);
  if (parent) mesh.parent = parent;
  return mesh;
}

// ===== Body + skeleton layout: shapes stay exactly where the 2D put them =====
// "Do not rearrange at all, this 2D is beautiful" - shapes (both skeleton
// "primary" shapes and every solid ornament/lattice) are the BODY: they keep
// their EXACT original 2D x/y (and rotation) with zero search or drift, only
// gaining a Z position (see buildElementTree()) so real 3D volumes don't
// interpenetrate - the one thing the 2D composition never had to resolve.
// Lines/beziers/arcs/spirals are the SKELETON: they're what actually does
// the connecting between shapes (see computeConnectorAnchor() and the
// connector pass below), reaching genuinely from one shape's surface to
// another's rather than the shapes needing to touch each other directly.
// Two tiers:
//   Tier 1 - anything with a real bounding volume (both skeletons, filled/open
//   circle/rect/triangle/semiCircle, concentricCircle, concentricArc (a clear
//   resin wedge behind its nested rings, since they're stroke-only on their
//   own), lattices): mutual non-overlap is a HARD constraint, resolved via
//   buildElementTree() below - by depth (Z) alone, since X/Y is frozen.
//   Tier 2 - pass-through elements with no real volume (halo, squiggle,
//   shape-type arc, and the 4 connector types): no overlap-avoidance
//   needed (matches the user's original "arcs/lines/beziers/spirals may pass
//   through shapes" exemption) - just a real touch point (or two, for a span)
//   via computeConnectorAnchor(), defined near the connector mesh functions
//   below.
//
// IMPORTANT: window.skeletons/window.ornaments are the SAME live objects the
// running 2D p5 draw loop reads every frame (it keeps running while 3D mode is
// active), and window.sceneReport (lines/beziers/arcs/spirals/lattices) is not
// reset between 3D-mode toggles and is what gets saved for gallery/Firebase.
// NOTHING here may write back onto shape.x/y or report point data - every
// resolved position lives in fresh, function-local Maps/objects for the
// duration of a single convertShapesTo3D() call.
const SOLID_CONTACT_PAD = 0.15; // 3D units - small clearance so "touching" doesn't z-fight

function pixelToWorld(px, py) {
  return { x: (px - window.innerWidth / 2) / K3D_SCALE, y: -(py - window.innerHeight / 2) / K3D_SCALE };
}
function worldToPixel(wx, wy) {
  return { x: wx * K3D_SCALE + window.innerWidth / 2, y: -wy * K3D_SCALE + window.innerHeight / 2 };
}
// Same x/y projection create3DShape uses below - factored out so the two can
// never drift apart.
function projectXY3D(shape) {
  return pixelToWorld(shape.x, shape.y);
}

// Bounding-sphere radius for a lattice - no per-type formula exists yet since
// lattices don't have a targetSize like shapes; cells' poly points are
// already offsets from (lattice.x, lattice.y) (see create3DLattice), so the
// farthest point across every cell IS the bounding radius directly. Ignores
// the per-cell perspective tilt create3DLattice infers later - a documented
// approximation, fine for a bounding sphere.
// Reclassified as a rect: bounding box of every cell's polygon (not just a
// max-distance-from-center scalar) so the lattice gets a REAL rectangular
// profile - see the tier1Nodes gather loop in convertShapesTo3D, which
// turns {w,h} here into the same polygon localProfile every rect uses.
// Derives a lattice's TRUE local geometry for the Tier-1 PLACEMENT profile -
// its own rotation angle (from the grid's actual row direction, not
// assumed axis-aligned) and the width/height of its REAL rotated
// footprint. A naive axis-aligned min/max bounding box around a ROTATED
// grid bounds to an oversized axis-aligned box that doesn't match its true
// silhouette; rotating every cell point into the lattice's OWN local
// (unrotated) frame first, THEN bounding that, gives the true w/h. Used by
// latticeVolumeRadius3D for placement, and by create3DLattice only to size
// its overall depth (create3DLattice renders each cell from its own RAW
// points directly instead, which needs no separate rotation at all - see
// its own comment for why).
function latticeLocalGeometry(lattice) {
  const cells = lattice && lattice.cells || [];
  const refCell = cells.find(c => (c.poly || c.points) && (c.poly || c.points).length >= 4);
  if (!refCell) return null;
  const refPoly = refCell.poly || refCell.points;
  // Grid row-direction (a cell's first edge) defines the lattice's own
  // rotation, in p5 pixel space (y-down).
  const angle = Math.atan2(refPoly[1].y - refPoly[0].y, refPoly[1].x - refPoly[0].x);
  const cosA = Math.cos(-angle), sinA = Math.sin(-angle);
  const toLocal = p => ({ x: p.x * cosA - p.y * sinA, y: p.x * sinA + p.y * cosA });

  let minPx = Infinity, maxPx = -Infinity, minPy = Infinity, maxPy = -Infinity;
  cells.forEach(cell => {
    const poly = cell.poly || cell.points;
    if (!poly || poly.length < 4) return;
    poly.map(toLocal).forEach(p => {
      minPx = Math.min(minPx, p.x); maxPx = Math.max(maxPx, p.x);
      minPy = Math.min(minPy, p.y); maxPy = Math.max(maxPy, p.y);
    });
  });
  if (!isFinite(minPx) || maxPx <= minPx || maxPy <= minPy) return null;

  return {
    rotZ: -angle, // matches every other shape's `rotZ = -(p5 rotation)` convention
    w: (maxPx - minPx) / K3D_SCALE, h: (maxPy - minPy) / K3D_SCALE,
    // The cell grid's own points are offsets from the lattice's anchor
    // (lattice.x, lattice.y - see create3DLattice), NOT necessarily
    // centered on it. minX/maxX/minY/maxY (world units, in the lattice's own
    // rotated local frame) are the TRUE bounds relative to that anchor -
    // used instead of assuming a symmetric +-w/2 box, which understated the
    // shape's real reach on whichever side the anchor sits off-center
    // toward (support struts landing short of the actual rendered cells).
    minX: minPx / K3D_SCALE, maxX: maxPx / K3D_SCALE,
    minY: minPy / K3D_SCALE, maxY: maxPy / K3D_SCALE
  };
}

function latticeVolumeRadius3D(lattice) {
  const geo = latticeLocalGeometry(lattice);
  if (!geo) return null;
  const corners = [
    { x: geo.minX, y: geo.minY }, { x: geo.maxX, y: geo.minY },
    { x: geo.maxX, y: geo.maxY }, { x: geo.minX, y: geo.maxY }
  ];
  // Real bounding radius from the ANCHOR (local origin) - the farthest of
  // the box's 4 true corners from (0,0), not half the diagonal of a box
  // wrongly assumed to be centered there.
  const r = Math.max(...corners.map(c => Math.hypot(c.x, c.y)));
  return { r, zOffset: 0, w: geo.w, h: geo.h, rotZ: geo.rotZ, corners };
}

// Deterministic (no RNG), evenly-distributed unit vectors on a sphere - used
// to search for a clear attachment direction around a target when the
// "preferred" direction is blocked by some other already-placed element.
// Z bias derived from an element's position in the 2D DRAW ORDER, not an
// arbitrary shuffled hash - "keep elements in their layered order as they
// appear in 2D." globalIndex is assigned in exactly the 2D paint sequence
// (skeletons, then ornaments, then lattices - see the gather loops in
// convertShapesTo3D, matching draw()'s own `skeletons.forEach` then
// `ornaments.forEach`), so a MONOTONIC function of it - later index =
// smaller (more negative) bias - means whatever was drawn later (sitting
// visually "on top" in the 2D composition) is consistently biased toward
// the camera-facing side in 3D, and whatever was drawn earlier toward the
// back, instead of a pseudo-random spread with no relationship to the
// original layering. A node's real world Z is its resolved node.z directly
// (see tier1WorldCenter) and the camera looks toward +Z (confirmed via its
// alpha/beta setup), so SMALLER world Z is nearer the camera - hence
// "later drawn" needs a bias toward NEGATIVE, not positive. Also still
// gives every element a genuinely different Z lean, so the tree keeps
// gaining real depth instead of collapsing into a flat XY-only card (2D
// data has no Z at all to begin with). ELEMENT_ORDER_SPAN sets where the
// back/front split falls (>=0 back-biased, <0 front-biased at index
// ELEMENT_ORDER_SPAN/2) - used to be a fixed 50 "bigger than any real
// composition gets," but real compositions routinely exceed that now (this
// session's own stress-testing reached 50+ elements on its own), and once
// globalIndex runs past a fixed span, EVERY later element - the whole back
// half of a bigger composition - piles into the same front-biased bucket
// while only the first ~25 stay back-biased, a systemic "front heavy, why
// isn't the back of the base used" skew that gets WORSE the more elements
// there are, exactly backwards from what a fixed normalizer was supposed to
// give. convertShapesTo3D now sets this to the actual element count for
// THIS composition before assigning any globalIndex, so the back/front
// split always falls at the true midpoint regardless of size - still a
// module-level constant (not a parameter) so every call site stays a pure
// function of globalIndex alone.
let ELEMENT_ORDER_SPAN = 50;
function synthesizedZBias(globalIndex) {
  return 0.5 - (Math.max(0, globalIndex) / ELEMENT_ORDER_SPAN);
}

// Real 3D overlap check between a candidate placement for `cur` and every
// already-placed Tier-1 node - checked against the FULL placed set, not
// just whichever node prompted the check, so non-overlap is a global
// invariant, not just a local one. Uses each side's REAL oriented support
// distance (see supportDistanceWorld) toward the other's actual direction,
// not a flat sphere radius - a rect/triangle reaches its full `r` only at
// its corners, so a sphere-based check was both too permissive along the
// diagonals it never fully covered and unnecessarily conservative along
// its flatter sides. `cur`/each `placed` entry needs the full Tier-1 node
// shape (x,y,z,zOffset,r,shapeType,s,rotZ,localProfile,zHalf,contactDir) -
// `contactDir` on `cur` is the TENTATIVE direction being tested (may not
// be committed yet), giving an accurate prediction of the tilt it would
// actually receive if this candidate is chosen.
function overlapsAnyPlaced(cur, placed, pad = SOLID_CONTACT_PAD) {
  // Must match tier1WorldCenter's sign (node.z - node.zOffset) - this was
  // `+ zOffset`, invisible for every shape type except concentricCircle/
  // concentricArc (the only nonzero-zOffset ones). Since BOTH curCenterZ and
  // pCenterZ used the same wrong sign, it silently canceled out whenever
  // neither or both sides had a zOffset - but for a pair where only ONE side
  // does, the resulting ddz (and everything downstream: direction, real
  // touch distance) was off by 2x that shape's zOffset, which is exactly
  // the kind of thing that shows up as "not quite touching" or subtly wrong
  // relative positioning around a concentricCircle/concentricArc.
  const curCenterZ = cur.z - cur.zOffset;
  return placed.some(p => {
    const pCenterZ = p.z - p.zOffset;
    const ddx = p.x - cur.x, ddy = p.y - cur.y, ddz = pCenterZ - curCenterZ;
    const centerDist = Math.hypot(ddx, ddy, ddz);
    if (centerDist < 1e-9) return true; // coincident centers - definitely overlapping
    // dirToP points FROM cur TOWARD p - that's the direction CUR must reach
    // OUT along to face p, so it's cur's own query direction; p's query
    // direction is the opposite (FROM p back TOWARD cur). Swapping these
    // (each shape queried in the direction pointing AWAY from the other)
    // silently gives the same answer for every symmetric profile here
    // (isotropic discs, and rect - centrally symmetric) but a WRONG one for
    // triangle (not centrally symmetric), so keep them paired correctly.
    const dirToP = { x: ddx / centerDist, y: ddy / centerDist, z: ddz / centerDist };
    const dirToCur = { x: -dirToP.x, y: -dirToP.y, z: -dirToP.z };
    const reachP = supportDistanceWorld(p, p.contactDir, dirToCur);
    const reachCur = supportDistanceWorld(cur, cur.contactDir, dirToP);
    // The gap enforced between two shapes needs to SCALE with how big they
    // are, not stay a fixed tiny constant - a technically-real gap of
    // `pad` (0.15 world units) is a fine amount of separation between two
    // small shapes but visually disappears against two large ones (e.g. a
    // big concentricCircle sitting just behind a big triangle can still
    // read as "inside" it, especially through anything semi-transparent),
    // even though nothing is actually overlapping.
    const minGap = Math.max(pad, (cur.r + p.r) * 0.06);
    return centerDist < reachP + reachCur + minGap - 1e-6;
  });
}

// Hard floor: the base is the literal ground of this structure - "nothing
// should live in or below it," not just "nothing should overlap it." Looks
// up the base node fresh from `nodeList` each call (cheap - the list is
// small) rather than threading an extra parameter through every placement
// function; `testNode` needs {y, contactDir, ...profile fields} exactly
// like any supportDistanceWorld caller. The base itself is always seeded
// first (guaranteed largest), so by the time anything else is being
// placed its resolved y/zHalf are already final. The threshold is the
// base's own TOP (y + zHalf), not just its bottom - the base must be
// lower than the lowest shape, so nothing may share ANY of the base's own
// vertical span (attaching to its side/top face is still fine, that's a
// real kissing contact - it's just that the point of contact itself, and
// everything beyond it, has to clear the base's top).
function violatesFloor(testNode, nodeList) {
  if (testNode.isBase) return false;
  const base = nodeList.find(n => n.isBase);
  if (!base || base.y === undefined) return false;
  const floorY = base.y + base.zHalf;
  const lowestY = testNode.y - trueLowestReach(testNode, testNode.contactDir);
  return lowestY < floorY - 1e-6;
}

// REAL occlusion analysis, not just a soft depth-bias preference: for every
// already-placed node whose 2D silhouette actually overlaps `node`'s
// (bounding-circle test on their ORIGINAL 2D positions/radii - if they
// don't overlap in 2D, nothing about their front/back order was ever
// visually decided, so no constraint applies), painter's-algorithm draw
// order (globalIndex - see synthesizedZBias's own comment for why this IS
// the 2D paint sequence) tells us exactly which one occluded the other in
// the 2D composition: whichever was drawn LATER sat on top. Enforces that
// same relationship in 3D - the later-drawn one must end up at a smaller
// (nearer-camera) world Z. A global total order (globalIndex) can never
// produce a contradiction between pairs, so this always has a consistent
// solution to search for.
function violatesOcclusionOrder(node, testZ, placed) {
  return placed.some(p => {
    if (p.isBase) return false;
    // Lattices are a real, unconditional exception to "only shapes that
    // visually overlap in 2D have an enforced order": in the actual 2D
    // sketch every lattice is baked into a foreground layer composited on
    // top, every frame, regardless of creation order or silhouette overlap
    // with anything else - not a soft "usually in front" preference but a
    // hard architectural fact. Enforce it directly rather than relying on
    // the 2D-silhouette-overlap check below to happen to catch every such
    // pair (a lattice reported as ending up BEHIND an ornament it should
    // always be in front of was exactly this gap - the overlap check missed
    // the pair, so nothing forced the correct order).
    const nodeIsLattice = node.shapeType === 'lattice', pIsLattice = p.shapeType === 'lattice';
    if (nodeIsLattice !== pIsLattice) return nodeIsLattice ? testZ >= p.z : testZ <= p.z;
    const d2D = Math.hypot(node.origX - p.origX, node.origY - p.origY);
    if (d2D >= node.r + p.r) return false; // silhouettes don't overlap in 2D - no occlusion relationship to preserve
    const nodeIsFront = node.globalIndex > p.globalIndex; // drawn later = painted on top
    return nodeIsFront ? testZ >= p.z : testZ <= p.z;
  });
}

// How much farther than the bare-minimum clearing offset a node's Z gets
// pushed, once a clear spot is found - "spread the sculpture out a little
// on Z." 1.0 would leave every node packed as tightly as physically
// possible; re-verified against a full clearance check before use, so this
// never introduces a real overlap even when it can't find the extra room.
// Kept deliberately modest - violatesOcclusionOrder already forces real,
// often substantial separation between any pair that actually overlapped
// in the 2D composition, so this only needs to add a LITTLE more on top of
// that for pairs with no such constraint, not compound into a deep stack.
const SPREAD_FACTOR = 1.15;
// Guaranteed minimum forward (step-count) push for lattices specifically -
// "lattices are usually out front in the composition" - see buildElementTree.
const LATTICE_FRONT_STEPS = 3;

// Places every Tier-1 node - X/Y are NEVER searched or moved: "do not
// rearrange at all, this 2D is beautiful." Each shape stays at exactly its
// own original 2D-derived position and rotation (contactDir stays null
// forever, so create3DShape's tilt never activates - no reorienting toward
// a contact partner either, since there IS no contact partner anymore).
// Shapes are the BODY here, not the connective structure; lines/arcs/
// beziers (Tier 2, see the connector pass in convertShapesTo3D) are the
// SKELETON that does the actual connecting between them. So Tier-1 shapes
// no longer need to touch each other at all - the only rules left are
// real physical non-overlap (resolved along Z, the one axis the 2D
// composition never had to begin with), staying above the base ("the base
// must be lower than the lowest shape" - violatesFloor), AND matching real
// 2D occlusion order wherever two shapes' silhouettes actually overlapped
// in the original composition (violatesOcclusionOrder) - not just a global
// "later-drawn things lean toward the camera" bias (synthesizedZBias,
// still used to pick which direction to search FIRST, and to keep non-
// overlapping shapes spread through real depth), but an authoritative,
// pairwise front/back constraint for every pair that actually occluded
// each other in 2D. Mutates every node with x=origX, y=origY, a resolved
// z, contactDir=null, and returns the array sorted biggest-first
// (placement/search order only - position doesn't depend on it beyond who
// gets first pick of a given Z).
function buildElementTree(nodes) {
  if (nodes.length === 0) return [];
  const sorted = nodes.slice().sort((a, b) => b.r - a.r);
  const placed = [];

  sorted.forEach(node => {
    node.x = node.origX;
    node.y = node.origY;
    node.contactDir = null;
    node.contactPointWorld = null;
    node.componentId = 0;

    // Search outward from z=0 in small steps, trying whichever side the
    // element's own draw-order bias prefers first (synthesizedZBias -
    // "keep elements in their layered order as they appear in 2D"), for
    // the smallest |z offset| that clears every already-placed node and
    // stays above the base. X/Y never change, so this is a 1D search, not
    // a directional one - depth is the only freedom left to resolve
    // overlap, which is exactly the point.
    // Lattices are a special case: "lattices are usually out front in the
    // composition" - always bias them toward the camera (more negative world
    // Z, see tier1WorldCenter) rather than leaving it to synthesizedZBias's
    // generic index-based guess, and give them extra guaranteed forward
    // clearance below (LATTICE_FRONT_STEPS) - real separation from whatever
    // ends up behind them, not just the bare minimum offset that clears
    // overlap. That minimum-clearance gap is what was reading as "the
    // lattice and the shape behind it look like they're intersecting from
    // certain angles" - a real but tiny gap is exactly what makes ordinary
    // alpha-blend mesh sorting ambiguous from an oblique angle.
    const isLattice = node.shapeType === 'lattice';
    const zSign = isLattice ? -1 : (synthesizedZBias(node.globalIndex) >= 0 ? 1 : -1);
    const step = Math.max(node.r * 0.6, 0.5);

    // Escalating search across a bounded budget - WITH real occlusion-order
    // enforcement first (the common case), then, only if that finds
    // nothing at all, WITHOUT it. A dense composition where a shape 2D-
    // overlaps several others with conflicting front/back requirements
    // relative to different already-placed neighbors can occasionally have
    // no small-magnitude Z that satisfies every pairwise requirement at
    // once (each pair alone is always resolvable - see
    // violatesOcclusionOrder - but not necessarily all of them together for
    // one shape). Guaranteed non-overlap/above-floor placement always
    // outranks perfect occlusion order for that one shape - this used to
    // fall straight through to an extreme, search-budget-sized safety net
    // instead, which is exactly what was pushing occasional shapes to the
    // far back of the scene and blowing out the camera's framing/zoom range.
    const SEARCH_BUDGET = 200;
    function searchZ(requireOcclusionOrder) {
      for (let n = 0; n <= SEARCH_BUDGET; n++) {
        const offsets = n === 0 ? [0] : [n * step * zSign, -n * step * zSign];
        for (const zOff of offsets) {
          const testZ = zOff - node.zOffset;
          const test = { ...node, z: testZ, contactDir: null };
          if (violatesFloor(test, placed)) continue;
          if (overlapsAnyPlaced(test, placed)) continue;
          if (requireOcclusionOrder && violatesOcclusionOrder(node, testZ, placed)) continue;
          return { z: testZ, n, sign: zOff >= 0 ? 1 : -1 };
        }
      }
      return null;
    }
    const result = searchZ(true) || searchZ(false);

    if (!result) {
      // Should be unreachable (running the SAME search again with no
      // occlusion-order requirement at all still found nothing within a
      // generous budget) - final safety net, bounded modestly rather than
      // at the full search budget, so this can never leave a shape at an
      // absurd distance even in the worst case.
      node.z = 20 * step * zSign - node.zOffset;
    } else {
      // "Spread the sculpture out a little on Z" - the search above finds
      // the bare MINIMUM offset that clears everything, which packs the
      // whole structure into as little depth as possible. Try pushing this
      // node further out along the SAME direction it already resolved
      // (still re-verified, not just assumed clear) for a bit more real
      // depth between elements, falling back to the minimal offset if the
      // wider spot turns out to be blocked by something else. Lattices get
      // a small guaranteed ADDITIVE bonus on top of the normal spread, so
      // they always end up genuinely out front instead of merely on the
      // correct side by a hair even when result.n is 0 (nothing was in the
      // way at all). This used to be `result.n * SPREAD_FACTOR * 2` - a
      // MULTIPLIER on result.n, not an addition - which for a lattice that
      // needed many search steps to clear a crowded/heavily-occluded spot
      // (a large result.n on its own) doubled an already-large value into
      // an extreme Z, flung far off to the side once perspective projected
      // it ("that lattice is wayyy out front").
      const spreadN = isLattice
        ? result.n * SPREAD_FACTOR + LATTICE_FRONT_STEPS
        : result.n * SPREAD_FACTOR;
      const spreadZOff = spreadN * step * result.sign;
      const spreadTestZ = spreadZOff - node.zOffset;
      const spreadTest = { ...node, z: spreadTestZ, contactDir: null };
      node.z = (!violatesFloor(spreadTest, placed) && !overlapsAnyPlaced(spreadTest, placed) && !violatesOcclusionOrder(node, spreadTestZ, placed))
        ? spreadTestZ
        : result.z;
    }
    placed.push(node);
  });

  return placed;
}

// True world-space center of a resolved Tier-1 node. create3DShape/
// create3DLattice are called with `layerZ = -node.z`, then internally set
// `zPos = -layerZ` - the double negation CANCELS, so a node's real world Z
// is simply node.z (confirmed against create3DShape's own trueCenterZ =
// zPos - zOffset formula for concentricCircle's true center - this used to
// read `-(node.z + zOffset)` here, the opposite sign on both terms, a
// stale leftover from before the call sites gained their own `-node.z`;
// nothing that reasoned about front/back ordering from this function -
// camera framing, the base's Y/Z, "keep elements in their layered order" -
// was using the right sign).
function tier1WorldCenter(node) {
  return { x: node.x, y: node.y, z: node.z - node.zOffset };
}

// Clear resin, same material language as CLEAR_RESIN_COLOR (concentricArc's
// wedge). This was the only strut look there was; it's now the 'resin' entry
// in STRUT_MATERIAL_OPTIONS below, kept because it's the one non-solid
// choice. A slightly more visible alpha than the resin wedge's 0.05, since
// struts are real structural load-bearing members meant to be seen - just
// not as a heavy black mass.
const BASE_COLOR = { r: 0.93, g: 0.96, b: 0.99, a: 0.14 };
const BASE_HEIGHT = 6; // real vertical extent (top rim to bottom rim) - a flat single ring read as 2D/edge-on from most angles
// World units of clear air between the base's top and the lowest shape's
// real reach. Was 1.5 - a technically-real gap, but the base is now an
// OPAQUE marble slab (used to be translucent clear resin, which stayed
// visible even through a near-tangent shape), so a shape sitting right at
// that thin margin - especially a thin, tall OPEN shape whose gradient
// already fades toward transparent near its own open edge - can visually
// read as sinking into/getting swallowed by the now-solid surface even
// though it never actually violates the floor. More headroom makes that
// gap unambiguous from any angle.
const BASE_MARGIN = 4;

// ===== Selectable pedestal + strut materials =====
// The base and the support struts are the only parts of the piece whose look
// ISN'T dictated by the 2D composition's own palette, so they're the two
// things worth offering as a real material choice. Nothing in this scene is
// lit (there are no lights in it at all - see unlitMat), so material identity
// has to come from the surface itself, two different ways:
//
// - Stone and wood get a procedurally drawn DynamicTexture (veining, grain,
//   knots). A slab is big and flat-on, so a pattern is what sells it.
// - The metals get an emissive FRESNEL ramp instead of a texture: bright
//   where a rod's surface faces the camera, dark at its silhouette, which is
//   exactly a cylinder's shading and reads correctly from every angle. That
//   avoids depending on CreateTube's UV orientation, and costs no texture
//   memory across the 50+ struts a dense composition generates. The ramp
//   MULTIPLIES the material's own emissive tone, so if a Babylon build ever
//   skips the Fresnel block the strut still renders its correct flat metal
//   colour - just without the sheen.
const SCULPTURE_MATERIAL_STORAGE_KEY = 'kandinsky3d.materials';

const BASE_MATERIAL_OPTIONS = [
  {
    id: 'whiteMarble', label: 'White marble', kind: 'marble',
    swatch: 'linear-gradient(135deg,#f3efe9,#e5ded3 55%,#faf7f2)',
    body: { r: 0.93, g: 0.90, b: 0.86 },      // the original BASE_MARBLE_COLOR - this option is the unchanged look
    vein: 'rgba(112,114,126,0.34)',
    mottle: 'rgba(158,150,138,0.20)',
    spec: 0.32, specPower: 48,   // polished stone (spotlight mode only)
    outline: K3D_BLACK
  },
  {
    id: 'blackMarble', label: 'Black marble', kind: 'marble',
    swatch: 'linear-gradient(135deg,#26262b,#131316 55%,#2f2f37)',
    body: { r: 0.105, g: 0.105, b: 0.12 },    // near-black, not black: pure black loses the bevel entirely
    vein: 'rgba(232,234,242,0.42)',
    mottle: 'rgba(126,130,146,0.16)',
    spec: 0.42, specPower: 64,   // black marble takes the highest polish of the three
    // Black-on-black would erase the slab's silhouette AND its bevel - the
    // one place the file's otherwise-universal black outline has to give way.
    outline: { r: 0.78, g: 0.79, b: 0.83, a: 1 }
  },
  {
    id: 'wood', label: 'Wood', kind: 'wood',
    swatch: 'repeating-linear-gradient(100deg,#8b5a2f 0 3px,#7a4d27 3px 5px,#97643b 5px 9px)',
    body: { r: 0.55, g: 0.355, b: 0.185 },
    spec: 0.10, specPower: 16,   // satin, not lacquered
    outline: K3D_BLACK
  }
];

// `tone` is the rod's own emissive colour; `hi`/`lo` are per-channel
// MULTIPLIERS on it at facing/grazing angles. Highlights run warmer and
// paler than a flat scale of the base tone would (real brass peaks toward
// pale yellow-white, steel toward blue-white), which is why these are
// three-channel rather than a single brightness factor.
const STRUT_MATERIAL_OPTIONS = [
  {
    id: 'black', label: 'Black',
    swatch: 'linear-gradient(180deg,#3c3c42,#151517 55%,#0c0c0e)',
    tone: { r: 0.135, g: 0.135, b: 0.145 },
    hi: { r: 2.30, g: 2.30, b: 2.40 }, lo: { r: 0.30, g: 0.30, b: 0.32 }
  },
  {
    id: 'brass', label: 'Brass',
    swatch: 'linear-gradient(180deg,#eccd72,#b0842f 45%,#6b4a13)',
    tone: { r: 0.615, g: 0.465, b: 0.19 },
    hi: { r: 1.58, g: 1.50, b: 1.32 }, lo: { r: 0.42, g: 0.38, b: 0.30 }
  },
  {
    id: 'steel', label: 'Steel',
    swatch: 'linear-gradient(180deg,#e4e9ee,#98a0a8 45%,#585f67)',
    tone: { r: 0.545, g: 0.565, b: 0.60 },
    hi: { r: 1.55, g: 1.56, b: 1.58 }, lo: { r: 0.40, g: 0.41, b: 0.43 }
  },
  {
    // The look every strut had before this menu existed - kept as a real
    // choice rather than dropped, since it's the only non-solid option and
    // reads very differently (the black core inside each rod, invisible
    // through an opaque metal shell, is what you actually see through this).
    id: 'resin', label: 'Clear resin', kind: 'resin',
    swatch: 'linear-gradient(180deg,rgba(236,246,255,0.9),rgba(186,212,234,0.35))',
    tone: BASE_COLOR
  }
];

let sculptureMaterials = { base: 'whiteMarble', strut: 'black' };

function baseMaterialOption() {
  return BASE_MATERIAL_OPTIONS.find(o => o.id === sculptureMaterials.base) || BASE_MATERIAL_OPTIONS[0];
}
function strutMaterialOption() {
  return STRUT_MATERIAL_OPTIONS.find(o => o.id === sculptureMaterials.strut) || STRUT_MATERIAL_OPTIONS[0];
}

// One shared material per surface class, not one per mesh: a dense
// composition draws 50+ strut segments, and the base is 3 meshes, so sharing
// is both cheaper and better for OBJ export (the exporter dedupes by colour,
// and one material means one `newmtl` entry). The registries below let a
// material swap re-point every existing mesh without rebuilding the scene.
let sculptureMatCache = { base: null, baseTex: null, strut: null, strutBlack: null };
let baseSurfaceMeshes = [];
let baseOutlineMeshes = [];
let strutShellMeshes = [];      // grounded: the chosen strut material
let strutBlackMeshes = [];      // shape-to-shape braces: always black

// Called from convertShapesTo3D's teardown. The meshes themselves are
// disposed there with dispose(false, true), which takes their shared
// material and its texture down with them - this just drops the now-dangling
// references so the next build makes fresh ones.
function resetSculptureMaterialRegistry() {
  sculptureMatCache = { base: null, baseTex: null, strut: null, strutBlack: null };
  baseSurfaceMeshes = [];
  baseOutlineMeshes = [];
  strutShellMeshes = [];
  strutBlackMeshes = [];
  blackWireMats = new Map();
  blackWireMeshes = [];
}

// Procedural stone/wood surface for the pedestal. Deterministic per material
// (a seeded LCG, not Math.random) so the slab looks like the SAME physical
// object every time the scene rebuilds - re-veining itself on every 2D->3D
// toggle would read as swapping the base out for a different one.
function sculptureBaseTexture(opt) {
  const S = 512;
  const tex = new BABYLON.DynamicTexture(`baseTex_${opt.id}`, { width: S, height: S }, babylonScene, true);
  tex.hasAlpha = false;
  const ctx = tex.getContext();

  let seed = 0;
  for (let i = 0; i < opt.id.length; i++) seed = (seed * 31 + opt.id.charCodeAt(i)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  const css = (c, a = 1) =>
    `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
  // Base tone scaled by `k` and clamped - grain lines go both darker (k<1)
  // and lighter (k>1) than the body colour, and 255*1.2 would otherwise wrap
  // into a nonsense channel value.
  const shade = (k, a) => css({
    r: Math.min(1, opt.body.r * k), g: Math.min(1, opt.body.g * k), b: Math.min(1, opt.body.b * k)
  }, a);

  ctx.fillStyle = css(opt.body);
  ctx.fillRect(0, 0, S, S);

  if (opt.kind === 'marble') {
    // Soft tonal clouding first, so the veins sit ON TOP of it the way they
    // do in real stone rather than being washed out by it.
    for (let i = 0; i < 24; i++) {
      const x = rnd() * S, y = rnd() * S, r = S * (0.08 + rnd() * 0.24);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, opt.mottle);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Veins as random walks that occasionally spawn a thinner branch. The
    // branches go into the same queue rather than being drawn recursively -
    // a nested beginPath/stroke mid-walk would break the parent's own path.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = opt.vein;
    const veins = [];
    for (let i = 0; i < 7; i++) {
      veins.push({ x: rnd() * S, y: rnd() * S, a: rnd() * Math.PI * 2, len: 40 + rnd() * 40, w: 1.1 + rnd() * 2, gen: 0 });
    }
    for (let vi = 0; vi < veins.length && vi < 60; vi++) {
      const v = veins[vi];
      let x = v.x, y = v.y, a = v.a;
      ctx.lineWidth = v.w;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < v.len; s++) {
        a += (rnd() - 0.5) * 0.5;
        x += Math.cos(a) * 9;
        y += Math.sin(a) * 9;
        ctx.lineTo(x, y);
        if (v.gen < 2 && rnd() < 0.05) {
          veins.push({
            x, y, a: a + (rnd() < 0.5 ? -1 : 1) * (0.7 + rnd() * 0.5),
            len: v.len * 0.4, w: Math.max(0.5, v.w * 0.5), gen: v.gen + 1
          });
        }
      }
      ctx.stroke();
    }
  } else {
    // Wood: near-parallel wavy grain lines, each with its own wavelength and
    // phase so they drift together and apart the way real grain does, plus a
    // couple of knots for the eye to land on.
    ctx.lineCap = 'round';
    for (let y = -30; y < S + 30; y += 2 + rnd() * 6) {
      const amp = 5 + rnd() * 14, ph = rnd() * Math.PI * 2;
      const freq = (0.7 + rnd() * 1.5) * Math.PI * 2 / S;
      ctx.strokeStyle = shade(rnd() < 0.55 ? 0.6 + rnd() * 0.24 : 1.1 + rnd() * 0.22, 0.55);
      ctx.lineWidth = 0.7 + rnd() * 2.4;
      ctx.beginPath();
      for (let x = 0; x <= S; x += 8) {
        const yy = y + Math.sin(x * freq + ph) * amp;
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    for (let k = 0; k < 2; k++) {
      const kx = S * (0.2 + rnd() * 0.6), ky = S * (0.2 + rnd() * 0.6), tilt = rnd() * Math.PI;
      for (let r = 2; r < 26; r += 2.5) {
        ctx.strokeStyle = shade(0.52 + rnd() * 0.16, 0.6);
        ctx.lineWidth = 1 + rnd();
        ctx.beginPath();
        ctx.ellipse(kx, ky, r, r * 0.55, tilt, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  tex.update();
  return tex;
}

function baseSurfaceMaterial() {
  if (sculptureMatCache.base) return sculptureMatCache.base;
  const opt = baseMaterialOption();
  const tex = sculptureBaseTexture(opt);
  const m = new BABYLON.StandardMaterial(`base_solid_mat_${opt.id}`, babylonScene);
  m.diffuseTexture = tex;
  m.backFaceCulling = false;
  m.alpha = 1;
  if (spotlightMode) {
    // LIT. The emissive slot has to be given up here: leaving the texture in
    // it would add the slab's full brightness back on top of the shading and
    // flatten the very modelling the rig exists to produce. A small flat
    // emissiveColor stands in as an ambient floor so the shadow side reads
    // as dark stone rather than a hole.
    m.disableLighting = false;
    m.emissiveColor = new BABYLON.Color3(0.13, 0.13, 0.135);
    m.specularColor = new BABYLON.Color3(opt.spec, opt.spec, opt.spec);
    m.specularPower = opt.specPower;
    // The slab's sides are a DOUBLESIDE ribbon, so which way its normals
    // face depends on the ring winding - without this, the most visible
    // surface on the whole pedestal could light as if it faced inward.
    // Flips the normal per back-face instead of trusting the winding.
    m.twoSidedLighting = true;
  } else {
    // Same unlit-with-a-texture shape as createOpenShape3D's material: both
    // texture slots set, lighting off, so the drawn pixels come through
    // exactly as painted.
    m.emissiveTexture = tex;
    m.specularColor = new BABYLON.Color3(0, 0, 0);
    m.disableLighting = true;
  }
  // Flat stand-in colour for OBJ export - plain MTL can't carry the veining.
  m.metadata = { exportColor: { r: opt.body.r, g: opt.body.g, b: opt.body.b, a: 1 } };
  sculptureMatCache.base = m;
  sculptureMatCache.baseTex = tex;
  return m;
}

// `grounded` struts (the ones actually standing on the base) get the chosen
// material; every shape-to-shape brace is hard-wired to black. Two separate
// material instances even when the choice IS black - sharing one would mean a
// single dispose during a refresh invalidated both registries at once.
function strutSurfaceMaterial(grounded) {
  const key = grounded ? 'strut' : 'strutBlack';
  if (sculptureMatCache[key]) return sculptureMatCache[key];
  const opt = grounded ? strutMaterialOption() : STRUT_MATERIAL_OPTIONS.find(o => o.id === 'black');
  const m = unlitMat(`strut_mat_${key}_${opt.id}`, opt.kind === 'resin' ? opt.tone : { ...opt.tone, a: 1 });
  if (opt.kind !== 'resin') applyMetalFinish(m, opt);
  sculptureMatCache[key] = m;
  return m;
}

// The metal look, shared by every metal thing in the piece so they read as
// one family: the struts, and the black skeleton wires below.
//  - Fresnel ramp: leftColor where the surface faces the camera, rightColor
//    at grazing angles (the shader mixes on abs(dot(view, normal)), so
//    backFaceCulling being off elsewhere in this file doesn't invert it).
//  - In spotlight mode, real light replaces the faked cylinder shading with
//    the genuine article, and adds what the fake never could: a specular
//    hotspot that travels along the rod as you orbit. The ramp stays on, but
//    now only modulates the dimmed emissive FLOOR - keeping the silhouette
//    dark and the facing side lifted UNDERNEATH the real lighting rather
//    than competing with it.
function applyMetalFinish(m, spec) {
  const fr = new BABYLON.FresnelParameters();
  fr.bias = 0.06;
  fr.power = 1.35;
  fr.leftColor = new BABYLON.Color3(spec.hi.r, spec.hi.g, spec.hi.b);
  fr.rightColor = new BABYLON.Color3(spec.lo.r, spec.lo.g, spec.lo.b);
  m.emissiveFresnelParameters = fr;
  if (spotlightMode) {
    m.disableLighting = false;
    m.diffuseColor = new BABYLON.Color3(spec.tone.r, spec.tone.g, spec.tone.b);
    m.emissiveColor = new BABYLON.Color3(spec.tone.r * 0.22, spec.tone.g * 0.22, spec.tone.b * 0.22);
    m.specularColor = new BABYLON.Color3(spec.hi.r * 0.55, spec.hi.g * 0.55, spec.hi.b * 0.55);
    m.specularPower = 64; // tight hotspot - polished metal, not satin
    m.twoSidedLighting = true; // same insurance as the base - unlitMat leaves culling off
  }
  return m;
}

// ===== Black skeleton wires as blackened metal =====
// The sketch draws most connectors (lines/beziers/arcs/spirals) in a neutral
// near-black - HSL(0, 0, 15) at 0.6-0.8 alpha - and until now those rendered
// as flat unlit colour, the only structural-looking thing in the piece with
// no material identity at all. They're blackened steel now, matching the
// black struts and braces.
//
// The ramp is deliberately GENTLER than the struts' black. A thin wire shows
// the camera almost nothing but facing normals - the grazing silhouette that
// keeps a fat rod dark is only a pixel or two wide - so the strut's own
// hi of 2.30 would light the full visible width and turn every black line
// mid-grey, washing out the drawing. 1.70 keeps them reading black with a
// sheen along them.
const BLACK_WIRE_METAL = {
  tone: { r: 0.135, g: 0.135, b: 0.145 },
  hi: { r: 1.70, g: 1.70, b: 1.78 },
  lo: { r: 0.30, g: 0.30, b: 0.32 }
};
// Neutral AND dark: catches the sketch's default connector colour without
// touching a dark but saturated palette colour (a deep navy line is a drawn
// colour, not metalwork). Channel spread guards the neutrality.
function isBlackWireColor(rgba) {
  const mx = Math.max(rgba.r, rgba.g, rgba.b);
  const mn = Math.min(rgba.r, rgba.g, rgba.b);
  return mx <= 0.30 && (mx - mn) <= 0.06;
}
// Cached per ALPHA - the sketch uses 0.8 for most connectors and 0.6 for
// others, and that translucency is part of the drawing's weight, so it's
// preserved rather than forced opaque. In practice this Map holds 1-2 entries.
let blackWireMats = new Map();
let blackWireMeshes = [];   // { mesh, alpha } - alpha needed to rebuild on a lighting change
function blackWireMaterial(alpha) {
  const key = alpha.toFixed(2);
  if (blackWireMats.has(key)) return blackWireMats.get(key);
  const m = unlitMat(`blackwire_mat_${key}`, { ...BLACK_WIRE_METAL.tone, a: alpha });
  applyMetalFinish(m, BLACK_WIRE_METAL);
  blackWireMats.set(key, m);
  return m;
}
function refreshBlackWires() {
  if (!blackWireMats.size) return;
  blackWireMats.forEach(m => m.dispose());
  blackWireMats = new Map();
  blackWireMeshes.forEach(e => {
    if (e.mesh && !e.mesh.isDisposed()) e.mesh.material = blackWireMaterial(e.alpha);
  });
}

// ===== Spotlight mode =====
// "A spotlight mode that brings the sculpture out from the background and
// increases contrast a little." Four things happen together, and it's the
// combination that produces the separation - no one of them does it alone:
//
//  1. A real three-point gallery rig (key/fill/rim) is added to the scene.
//  2. The base and struts become LIT materials, so they're the only things
//     that rig touches. Every artwork mesh already sets disableLighting on
//     its own material, so the shapes ignore the lights entirely and their
//     exact 2D colours survive untouched - that existing flag is what makes
//     a real light rig safe to drop into this scene at all.
//  3. The skybox is dimmed. This is the single biggest lever: the piece is
//     translucent mid-tone against a bright paper wash, and dropping the
//     background is what actually makes it step forward.
//  4. A global contrast lift plus a vignette, via the scene's own image
//     processing - the "little more contrast", and the vignette pulls the
//     eye to the centre the way a real spotlight's falloff does.
//
// Everything here is reversible in place; nothing rebuilds the scene.
//
// TUNING NOTE: three separate things darken the background and they COMPOUND,
// which is how the first pass ended up far too dark. For a sky pixel:
//   paper wash (0.90, 0.84, 0.72)  ->  x SKY_DIM  ->  x EXPOSURE
//   ->  contrast, which pivots around 0.5: (v - 0.5) * CONTRAST + 0.5
//   ->  x vignette (multiplicative, strongest in the corners)
// The contrast pivot is the trap - once SKY_DIM pushes the background under
// 0.5, the contrast lift starts driving it DOWN as well, so lowering the dim
// darkens the frame roughly twice as fast as the number suggests. Keeping the
// background above ~0.5 after dim+exposure means contrast lifts it instead,
// and the separation then comes from the lit base and the shapes' own
// emissive colour rather than from crushing everything around them.
const SPOTLIGHT_SKY_DIM = 0.60;      // multiplier on the skybox texture level (was 0.34 - far too dark)
const SPOTLIGHT_CONTRAST = 1.35;     // 1.0 = untouched
const SPOTLIGHT_EXPOSURE = 1.06;
const SPOTLIGHT_VIGNETTE_WEIGHT = 1.1; // was 2.4 - a gentle corner falloff, not a black frame

let spotlightMode = false;
let spotlightLights = [];

// One restore for every stored preference - deliberately down here rather
// than beside `sculptureMaterials`, since it has to run after BOTH `let`s
// are initialised (a `let` read before its declaration throws).
(function restoreSculpturePreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(SCULPTURE_MATERIAL_STORAGE_KEY) || 'null');
    if (!saved) return;
    if (BASE_MATERIAL_OPTIONS.some(o => o.id === saved.base)) sculptureMaterials.base = saved.base;
    if (STRUT_MATERIAL_OPTIONS.some(o => o.id === saved.strut)) sculptureMaterials.strut = saved.strut;
    if (typeof saved.spotlight === 'boolean') spotlightMode = saved.spotlight;
  } catch (e) { /* storage disabled/private mode - the defaults are fine */ }
})();

function buildSpotlightRig() {
  if (!babylonScene || spotlightLights.length) return;
  // Directions point FROM the light INTO the scene. The rig is fixed in
  // world space, not welded to the camera, so orbiting genuinely walks you
  // around a lit object - the highlight travels, the shadow side turns
  // toward you. That's the whole point of lighting a sculpture.
  const key = new BABYLON.DirectionalLight('spot_key', new BABYLON.Vector3(0.75, -1, 0.85), babylonScene);
  key.diffuse = new BABYLON.Color3(1, 0.965, 0.9);   // warm gallery key, high and front-left
  key.specular = new BABYLON.Color3(1, 0.98, 0.94);
  key.intensity = 1.25;

  // Ambient wrap so nothing ever goes to pure black as you orbit past the
  // key - sky-cool from above, warm bounce off the floor below.
  const fill = new BABYLON.HemisphericLight('spot_fill', new BABYLON.Vector3(0, 1, 0), babylonScene);
  fill.diffuse = new BABYLON.Color3(0.74, 0.79, 0.9);
  fill.groundColor = new BABYLON.Color3(0.3, 0.27, 0.24);
  fill.specular = new BABYLON.Color3(0.25, 0.26, 0.28);
  fill.intensity = 0.5;

  // Cool rim from behind (+Z is behind the sculpture at the default camera
  // angle) - this is what actually separates a dark base from a dark
  // background, by drawing a bright edge along its silhouette.
  const rim = new BABYLON.DirectionalLight('spot_rim', new BABYLON.Vector3(-0.35, -0.25, -1), babylonScene);
  rim.diffuse = new BABYLON.Color3(0.72, 0.82, 1);
  rim.specular = new BABYLON.Color3(0.8, 0.88, 1);
  rim.intensity = 0.85;

  spotlightLights = [key, fill, rim];
}

function disposeSpotlightRig() {
  spotlightLights.forEach(l => l.dispose());
  spotlightLights = [];
}

// Skybox dimming + global grade. Idempotent, and safe to call whenever -
// re-applied after each rebuild so a future skybox refresh can't come back
// at full brightness while spotlight mode is on.
function syncSpotlightEnvironment() {
  if (!babylonScene) return;
  const dim = spotlightMode ? SPOTLIGHT_SKY_DIM : 1;
  babylonScene.meshes.forEach(m => {
    if (!m.name.startsWith('skyFace_') || !m.material) return;
    // diffuseTexture and emissiveTexture are the SAME texture object on a
    // sky face, so one `level` covers both slots.
    const tex = m.material.diffuseTexture;
    if (tex) tex.level = dim;
  });
  // The clear colour shows through any hairline gap between faces and past
  // the box entirely - it has to travel with them or the seams light up.
  const wash = [229 / 255, 214 / 255, 184 / 255];
  babylonScene.clearColor = new BABYLON.Color4(wash[0] * dim, wash[1] * dim, wash[2] * dim, 1);

  const ip = babylonScene.imageProcessingConfiguration;
  if (spotlightMode) {
    ip.contrast = SPOTLIGHT_CONTRAST;
    ip.exposure = SPOTLIGHT_EXPOSURE;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = SPOTLIGHT_VIGNETTE_WEIGHT;
    ip.vignetteColor = new BABYLON.Color4(0, 0, 0, 0);
    ip.vignetteBlendMode = BABYLON.ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
    ip.isEnabled = true;
  } else {
    ip.contrast = 1;
    ip.exposure = 1;
    ip.vignetteEnabled = false;
    ip.isEnabled = false;
  }
}

// Rebuilds the base and/or strut material and re-points every mesh already
// using it. Shared by the material picker and the spotlight toggle, since
// both change what those two materials should be without changing a single
// vertex - see setSculptureMaterials for why nothing has to rebuild.
function refreshSculptureSurfaces(doBase, doStrut, doStrutBlack) {
  if (!babylonScene) return;
  if (doBase && sculptureMatCache.base) {
    const oldMat = sculptureMatCache.base, oldTex = sculptureMatCache.baseTex;
    sculptureMatCache.base = null;
    sculptureMatCache.baseTex = null;
    const next = baseSurfaceMaterial();
    baseSurfaceMeshes.forEach(mesh => { if (mesh && !mesh.isDisposed()) mesh.material = next; });
    const oc = baseMaterialOption().outline;
    baseOutlineMeshes.forEach(mesh => {
      if (!mesh || mesh.isDisposed() || !mesh.material) return;
      mesh.material.emissiveColor = new BABYLON.Color3(oc.r, oc.g, oc.b);
      mesh.material.metadata = { exportColor: { r: oc.r, g: oc.g, b: oc.b, a: 1 } };
    });
    if (oldTex) oldTex.dispose();
    if (oldMat) oldMat.dispose();
  }
  // The black braces only ever need rebuilding when LIGHTING changes - a
  // strut-material pick can't alter them, which is the whole point of them.
  const swapStruts = (key, meshes, grounded) => {
    const oldMat = sculptureMatCache[key];
    if (!oldMat) return;
    sculptureMatCache[key] = null;
    const next = strutSurfaceMaterial(grounded);
    meshes.forEach(mesh => { if (mesh && !mesh.isDisposed()) mesh.material = next; });
    oldMat.dispose();
  };
  if (doStrut) swapStruts('strut', strutShellMeshes, true);
  if (doStrutBlack) {
    swapStruts('strutBlack', strutBlackMeshes, false);
    refreshBlackWires(); // same black metalwork family, same lighting response
  }
}

window.getSpotlightMode = function () { return spotlightMode; };
window.setSpotlightMode = function (on) {
  const next = !!on;
  if (next === spotlightMode) return;
  spotlightMode = next;
  try {
    localStorage.setItem(SCULPTURE_MATERIAL_STORAGE_KEY,
      JSON.stringify({ ...sculptureMaterials, spotlight: spotlightMode }));
  } catch (e) { /* storage disabled - the mode still applies this session */ }
  if (!babylonScene) return;
  if (spotlightMode) buildSpotlightRig(); else disposeSpotlightRig();
  syncSpotlightEnvironment();
  refreshSculptureSurfaces(true, true, true); // lighting changes every surface, black braces included
};

// ——— public API for the materials picker in index3D.html ———
window.getMaterialOptions = function () {
  const pub = o => ({ id: o.id, label: o.label, swatch: o.swatch });
  return { base: BASE_MATERIAL_OPTIONS.map(pub), strut: STRUT_MATERIAL_OPTIONS.map(pub) };
};
window.getSculptureMaterials = function () {
  return { base: sculptureMaterials.base, strut: sculptureMaterials.strut };
};
// Swaps materials LIVE - no scene rebuild. Only material assignments change;
// every strut and base mesh keeps the geometry it already has, so picking a
// material while the 3D view is open updates it on the spot. Unknown ids are
// ignored rather than throwing, so a stale saved value can't break startup.
window.setSculptureMaterials = function (opts = {}) {
  const wantBase = BASE_MATERIAL_OPTIONS.some(o => o.id === opts.base) ? opts.base : null;
  const wantStrut = STRUT_MATERIAL_OPTIONS.some(o => o.id === opts.strut) ? opts.strut : null;
  const baseChanged = !!wantBase && wantBase !== sculptureMaterials.base;
  const strutChanged = !!wantStrut && wantStrut !== sculptureMaterials.strut;
  if (wantBase) sculptureMaterials.base = wantBase;
  if (wantStrut) sculptureMaterials.strut = wantStrut;
  try {
    localStorage.setItem(SCULPTURE_MATERIAL_STORAGE_KEY,
      JSON.stringify({ ...sculptureMaterials, spotlight: spotlightMode }));
  } catch (e) { /* storage disabled - the choice still applies this session */ }
  refreshSculptureSurfaces(baseChanged, strutChanged, false);
};

// ===== Gravitational analysis: every element gets a REAL material density,
// used to compute the sculpture's true center of gravity (mass-weighted, not
// just a geometric centroid) so it reads as a plausible standing physical
// object - "give each shape and element a weight as if they were made of
// resin, line based elements (skeleton) are made of metal, base is a heavy
// wood base." Relative magnitudes matter more than real-world accuracy here:
// metal is much denser than resin, but the skeleton's thin wire cross-section
// still nets a tiny mass next to a solid resin shape; the base is bigger AND
// denser than everything else combined, which is what should normally keep
// the COG low and inside its footprint without any extra support at all.
const DENSITY_RESIN = 1.15;  // g/cm^3-ish, applied to every Tier-1 shape/lattice's solid volume
const DENSITY_METAL = 8.0;   // steel/bronze-ish, applied to every thin skeleton connector's volume
const DENSITY_WOOD = 1.3;    // "heavy" hardwood, applied to the base's solid cylinder volume
const STABILITY_FOOTPRINT_FACTOR = 0.8; // COG must land within this fraction of the base radius, not just barely inside it, to count as genuinely freestanding

// Shoelace formula - signed polygon area from a `localProfile.vertices` ring
// (any Tier-1 polygon profile: rect/triangle/lattice), used to turn a 2D
// cross-section into a real volume (area * full depth) for mass purposes.
function polygonArea(vertices) {
  let sum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

// Real solid volume (world units^3) of a Tier-1 node from its own support-
// function profile - polygon cross-section * full depth, or a cylinder for
// isotropic profiles (semiCircle gets half the disc's cross-section, matching
// its own half-disc silhouette).
function tier1NodeVolume(n) {
  const depth = n.zHalf * 2;
  // The base RENDERS as a rectangular slab (renderW x renderD - see
  // createBaseMesh3D), not the circular-footprint stand-in its placement
  // profile uses - weigh the real slab, since the base is the heaviest
  // single element and understating it (pi*r^2 vs w*d can differ by a lot
  // for a wide composition) skews the whole COG/stability analysis.
  // renderW/renderD are set before massEntries is gathered; the r*2 square
  // fallback covers the degenerate single-shape case.
  if (n.isBase) return (n.renderW || n.r * 2) * (n.renderD || n.r * 2) * depth;
  if (n.localProfile.kind === 'polygon') return polygonArea(n.localProfile.vertices) * depth;
  const areaFrac = (n.shapeType === 'semiCircle' || n.shapeType === 'concentricArc') ? 0.5 : 1;
  return Math.PI * n.localProfile.R * n.localProfile.R * areaFrac * depth;
}

function tier1NodeMass(n) {
  return tier1NodeVolume(n) * (n.isBase ? DENSITY_WOOD : DENSITY_RESIN);
}

// Approximate world-space length of a Tier-2 connector's own curve, straight
// from its generating parameters (mirrors each create3D*'s own point
// generation, but only enough of it to get a length - no need to duplicate
// the full sampled path here). Used for the thin metal skeleton's mass -
// length * cross-section area, not a volume from a profile (these have none).
function connectorLengthPixel(kind, el) {
  switch (kind) {
    case 'line': {
      const p0 = el.points ? el.points[0] : { x: el.x0 || 0, y: el.y0 || 0 };
      const p1 = el.points ? el.points[1] : { x: el.x1 || 0, y: el.y1 || 0 };
      return Math.hypot(p1.x - p0.x, p1.y - p0.y);
    }
    case 'bezier': {
      const cps = el.points || el.pts;
      if (!cps || cps.length < 4) return 0;
      let len = 0, prev = cps[0];
      for (let i = 1; i <= 16; i++) {
        const t = i / 16, mt = 1 - t;
        const p = {
          x: mt*mt*mt*cps[0].x + 3*mt*mt*t*cps[1].x + 3*mt*t*t*cps[2].x + t*t*t*cps[3].x,
          y: mt*mt*mt*cps[0].y + 3*mt*mt*t*cps[1].y + 3*mt*t*t*cps[2].y + t*t*t*cps[3].y
        };
        len += Math.hypot(p.x - prev.x, p.y - prev.y);
        prev = p;
      }
      return len;
    }
    case 'arcline':
      return Math.abs(el.sweep || Math.PI) * (el.r || 0);
    case 'spiral': {
      if (el.sv && el.sv.length >= 2) {
        let len = 0;
        for (let i = 1; i < el.sv.length; i++) len += Math.hypot(el.sv[i].x - el.sv[i-1].x, el.sv[i].y - el.sv[i-1].y);
        return len;
      }
      const coils = el.coils || 3;
      return coils * 2 * Math.PI * ((el.maxRadius || 0) / 2);
    }
    default:
      return 0;
  }
}

function connectorMass(kind, el) {
  const lengthWorld = connectorLengthPixel(kind, el) / K3D_SCALE;
  const strokeWeight = el.strokeWeight || el.w || el.sw || 2;
  const crossSectionArea = Math.PI * Math.pow(strokeWeight / K3D_SCALE / 2, 2);
  return lengthWorld * crossSectionArea * DENSITY_METAL;
}

// Tier-2 ornaments (halo/concentricArc/squiggle/shape-type arc) have no real
// volume, but they ARE stroke-drawn "line based" elements per the user's own
// framing, so they get the same metal density as the true skeleton connectors
// - just estimated from their own generating parameters (mirrors the exact
// radius/sweep formulas computeConnectorAnchor already uses for these kinds)
// rather than a sampled path, since only a rough length is needed for mass.
function ornamentSkeletonMass(kind, shape) {
  const strokeWeight = shape.strokeWeight || shape.sw || 2;
  const crossSectionArea = Math.PI * Math.pow(strokeWeight / K3D_SCALE / 2, 2);
  let lengthWorld = 0;
  if (kind === 'halo') {
    const r = (shape.targetSize || 50) / K3D_SCALE / 2;
    lengthWorld = 2 * Math.PI * r;
  } else if (kind === 'concentricArc' || kind === 'arcShape') {
    const s = (shape.targetSize || 50) / K3D_SCALE;
    const r = kind === 'arcShape' ? s / 2 : (shape.rings || 4) * ((shape.diff || 10) / K3D_SCALE);
    lengthWorld = Math.abs(shape.arcSweep || Math.PI) * r;
  } else if (kind === 'squiggle' && shape.sv && shape.sv.length >= 2) {
    let len = 0;
    for (let i = 1; i < shape.sv.length; i++) len += Math.hypot(shape.sv[i].x - shape.sv[i-1].x, shape.sv[i].y - shape.sv[i-1].y);
    lengthWorld = len / K3D_SCALE;
  }
  return lengthWorld * crossSectionArea * DENSITY_METAL;
}

// The base is a real Tier-1 participant, not a post-hoc ring computed AFTER
// everything else is placed - it's inserted into tier1Nodes and goes
// through buildElementTree exactly like any shape, seeded FIRST (it's
// deliberately the largest node, and buildElementTree always seeds
// biggest-first). Since shapes no longer move at all in X/Y and Y can only
// be resolved by the base's OWN position (not searched per-shape - see
// buildElementTree/violatesFloor), the base's Y here MUST guarantee its own
// top clears the lowest real shape's frozen Y by construction, not just by
// a heuristic margin - there is no search left that could fix a violation
// afterward.
//
// It never gets a contactDir (nothing attaches IT to a neighbor anymore -
// there's no more attaching at all), so it's permanently untitled - render
// orientation and support-function geometry both need a FIXED custom frame
// instead of the usual "untitled = identity" default, since a disc lying
// flat (thin top-to-bottom, wide sideways) is the opposite of this app's
// normal camera-facing shape convention (thin front-to-back).
// `fixedOrientation` carries that one-time 90 degree swap; supportDistance
// World and createBaseMesh3D both honor it.
function baseFixedOrientation() {
  const q = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, Math.PI / 2);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

// Sized and positioned from the REAL Tier-1 shapes already gathered (before
// buildElementTree runs) - wide enough to span under the composition's
// original 2D footprint, and its Y set from BASE_HEIGHT/BASE_MARGIN
// directly (not the shapes' own radii) so "base top < lowest shape" holds
// unconditionally regardless of how small or large the shapes are.
function createBaseTier1Node(realTier1Nodes) {
  if (realTier1Nodes.length === 0) return null;
  // Mass-weighted, not a plain geometric average - "if there's a balance
  // issue, you can move the base to the best location." A heavy resin shape
  // should pull the base's center toward it more than a small one would, the
  // same way a real pedestal gets centered under a sculpture's actual weight
  // rather than the midpoint of its outline. Every shape's mass (from its own
  // zHalf/localProfile - real volume x density) is already known here,
  // before buildElementTree runs, so this needs no second pass - it's a
  // strictly better upfront position, not a reaction after the fact. The
  // gravitational stability check (COG vs footprint) and its outrigger brace
  // still run afterward as a backstop for whatever this can't fully correct
  // (metal skeleton connector mass isn't known yet at this point).
  const totalMassForCenter = realTier1Nodes.reduce((s, n) => s + tier1NodeMass(n), 0);
  const avgOrigX = totalMassForCenter > 0
    ? realTier1Nodes.reduce((s, n) => s + n.origX * tier1NodeMass(n), 0) / totalMassForCenter
    : realTier1Nodes.reduce((s, n) => s + n.origX, 0) / realTier1Nodes.length;
  // The REAL lowest point of the lowest shape - center Y minus that shape's
  // OWN downward reach (its radius, roughly), not just center Y. Shapes
  // never tilt anymore (contactDir is always null), so every shape's
  // downward reach is fixed/exact here, not a search-dependent estimate -
  // getting this wrong (a previous version used bare center Y with a small
  // fixed margin) meant the floor check below could fail for EVERY shape
  // whose own radius exceeded that margin, with no Z offset able to fix a
  // Y-only violation - every shape got shoved to an extreme fallback Z and
  // vanished from view.
  // trueLowestReach, not a plain straight-down ray-cast - a rotated rect's
  // true lowest point is a CORNER that the exact-vertical ray from center
  // usually misses entirely (it hits an edge instead, underestimating the
  // real drop), which was letting a rotated shape's actual lowest corner
  // clip through the base even though this check looked satisfied.
  const minLowestY = Math.min(...realTier1Nodes.map(n => n.origY - trueLowestReach(n, null)));
  const maxR = Math.max(...realTier1Nodes.map(n => n.r));
  const avgR = realTier1Nodes.reduce((s, n) => s + n.r, 0) / realTier1Nodes.length;
  const baseR = Math.max(maxR * 1.1, avgR * 1.75, 3); // skinnier base - reverted the earlier 1.5x footprint boost (was maxR*1.65, avgR*2.625, 4.5)
  return {
    key: 'base', globalIndex: -1,
    origX: avgOrigX, origY: minLowestY - BASE_HEIGHT / 2 - BASE_MARGIN,
    r: baseR, zOffset: 0,
    shapeType: 'base', s: baseR * 2, rotZ: 0,
    localProfile: { kind: 'isotropic', R: baseR },
    zHalf: BASE_HEIGHT / 2,
    fixedOrientation: baseFixedOrientation(),
    isBase: true
  };
}

// Renders the base at its final resolved position as a real solid marble
// slab - a rectangular extrude (fitted to the sculpture's actual footprint,
// see renderW/renderD) with a beveled TOP edge only (bottom stays a sharp,
// flat edge), not the earlier circular resin drum. Built entirely from
// EXPLICIT world-space point rings (no path-tangent-derived auto-orientation
// involved anywhere) to avoid a real bug hit here once already:
// ExtrudeShapeCustom's Frenet frame is ambiguous along a perfectly straight
// path, and it rendered the whole slab as a tall vertical wall instead of a
// flat horizontal one. A CreateRibbon connecting 3 explicit height-rings
// (sharp bottom -> top shoulder, both full-size, then tapering to the
// smaller top cap) gives the chamfered top with no orientation guessing,
// plus two flat CreateGround caps for the true top/bottom faces.
// The flat top cap's own half-extents (excluding the beveled band entirely)
// - shared by createBaseMesh3D (what actually gets rendered) and
// baseAnchorHalfExtents below (what aux struts are allowed to touch), so the
// two can never drift apart.
function baseTopCapHalfExtents(node) {
  const w = node.renderW || node.r * 2;
  const d = node.renderD || node.r * 2;
  const h = node.zHalf * 2;
  const hw = w / 2, hd = d / 2;
  // A true 45-degree bevel needs the horizontal inset to exactly match the
  // vertical drop (rise = run) - clamped well under half the slab's
  // shortest side/height so the inset can never invert into a negative
  // width, however small the slab ends up.
  const bevel = Math.min(h * 0.4, 3, hw * 0.45, hd * 0.45); // longer bevel - starts further in, finishes lower (was h*0.22/1)
  return { w, d, hw, hd, bevel, bw: hw - bevel, bd: hd - bevel };
}

// The real allowed anchor region for aux struts on the base - "do not
// anchor any struts to the beveled edge... create a 1 inch boundary on the
// outside of the flat surface and do not anchor aux struts to that either."
// Excludes the bevel band entirely (only the flat top cap counts at all),
// then insets another 1" past that. Assuming the base is 12"x12" real-world
// size, 1" is w/12 (or d/12) of the base's own actual rendered footprint -
// scales correctly regardless of how big any particular base ends up.
function baseAnchorHalfExtents(node) {
  const { w, d, bw, bd } = baseTopCapHalfExtents(node);
  const marginX = w / 12, marginZ = d / 12;
  return { halfW: Math.max(bw - marginX, 0.1), halfD: Math.max(bd - marginZ, 0.1) };
}

function createBaseMesh3D(node) {
  const wc = tier1WorldCenter(node);
  const { w, d, hw, hd, bevel, bw, bd } = baseTopCapHalfExtents(node);
  const topY = node.y + node.zHalf, botY = node.y - node.zHalf;

  const ring = (y, rw, rd) => [
    new BABYLON.Vector3(wc.x - rw, y, wc.z - rd), new BABYLON.Vector3(wc.x + rw, y, wc.z - rd),
    new BABYLON.Vector3(wc.x + rw, y, wc.z + rd), new BABYLON.Vector3(wc.x - rw, y, wc.z + rd),
    new BABYLON.Vector3(wc.x - rw, y, wc.z - rd)
  ];
  // Bottom is sharp (full size, no taper) - only the top edge bevels.
  const rings = [
    ring(botY, hw, hd),
    ring(topY - bevel, hw, hd),
    ring(topY, bw, bd)
  ];
  // One shared material across all three slab meshes - see baseSurfaceMaterial.
  const slabMat = baseSurfaceMaterial();
  const sides = BABYLON.MeshBuilder.CreateRibbon('base_solid_sides', {
    pathArray: rings, sideOrientation: BABYLON.Mesh.DOUBLESIDE
  }, babylonScene);
  sides.material = slabMat;
  const topCap = BABYLON.MeshBuilder.CreateGround('base_solid_capTop', { width: bw * 2, height: bd * 2 }, babylonScene);
  topCap.position = new BABYLON.Vector3(wc.x, topY, wc.z);
  topCap.material = slabMat;
  const botCap = BABYLON.MeshBuilder.CreateGround('base_solid_capBot', { width: w, height: d }, babylonScene);
  botCap.position = new BABYLON.Vector3(wc.x, botY, wc.z);
  botCap.material = slabMat;
  baseSurfaceMeshes.push(sides, topCap, botCap);

  // Black outline on EVERY real edge, not just the outermost ones - each
  // ring's own rectangle (sharp bottom, top shoulder, top cap) plus every
  // connecting edge between consecutive rings (the straight vertical sides
  // AND the diagonal bevel faces), matching how every other solid shape in
  // this file gets its full boundary wrapped, not just a couple of rims.
  // Black on every base except the black-marble one, which would swallow it
  // whole (see the option's own `outline`).
  const outlineCol = baseMaterialOption().outline;
  rings.forEach((r, ri) => {
    baseOutlineMeshes.push(makeStrokeTube(`base_outline_ring_${ri}`, r, 0.1, outlineCol, 0, 0, 0));
  });
  for (let ri = 0; ri < rings.length - 1; ri++) {
    for (let i = 0; i < 4; i++) {
      baseOutlineMeshes.push(
        makeStrokeTube(`base_outline_edge_${ri}_${i}`, [rings[ri][i], rings[ri + 1][i]], 0.1, outlineCol, 0, 0, 0)
      );
    }
  }
  console.log(`🏛️ Base placed at (${wc.x.toFixed(1)}, ${node.y.toFixed(1)}, ${wc.z.toFixed(1)}), w=${w.toFixed(1)}, d=${d.toFixed(1)}`);
}

// A real, continuous solid tube (single mesh, no dashing) - used for every
// support/aux strut (base legs, the connectivity-closure struts, the
// stability outrigger). Used to be dashed ("conceptual stand, not a real
// connecting element"), but the base itself is now a real solid pedestal
// too, so a strut genuinely bearing load on it should read as a real solid
// support member, not a schematic hint. A thin black CORE runs inside the
// clear resin shell (not a bigger black tube wrapped around it - an opaque
// tube larger than the resin one would just fully hide the resin tube
// inside it, not outline it) - same "cast inside clear resin" look as
// concentricArc's rings, visible through the resin shell's own translucency.
// A support rod's thickness should be proportional to what it actually
// holds - a tiny bullseye propped up by the same fat standard rod as a
// giant rect read as "a little ridiculous." Cap at ~8% of the supported
// shape's own bounding radius, within [0.1, 0.35]: the standard rod stays
// the ceiling for normal/large shapes, and nothing goes thinner than
// sturdy wire.
function strutRadiusCap(node) {
  return Math.max(0.1, Math.min(0.35, (node && node.r ? node.r : 4.5) * 0.08));
}

function createSolidTube3D(name, pA, pB, w2D, radiusCap = null, grounded = true) {
  const dist = Math.hypot(pB.x - pA.x, pB.y - pA.y, pB.z - pA.z);
  if (dist < 1e-6) return null;
  // Aux supports read as real cylindrical rods, not thin wire - "imagine the
  // piece is sitting on a desk and the skeletal structures are rigid wires
  // perhaps 1/24" in diameter" (matching lineTubeAbsolute's own thin 0.1
  // minimum for actual connectors) - aux supports are a structurally
  // heavier, distinctly thicker class of object than that, never this
  // minimum's old 0.08 (thinner than even the wires). `radiusCap` (see
  // strutRadiusCap) scales that down for small supported shapes.
  let radius = Math.max((w2D || 2) / K3D_SCALE / 2, 0.35);
  if (radiusCap) radius = Math.min(radius, radiusCap);
  const path = [new BABYLON.Vector3(pA.x, pA.y, pA.z), new BABYLON.Vector3(pB.x, pB.y, pB.z)];
  const core = BABYLON.MeshBuilder.CreateTube(`${name}_core`, {
    path, radius: Math.max(radius * 0.4, 0.05), tessellation: 12, cap: BABYLON.Mesh.CAP_ALL
  }, babylonScene);
  core.material = unlitMat(`${name}_core_mat`, K3D_BLACK);
  const tube = BABYLON.MeshBuilder.CreateTube(name, {
    path, radius, tessellation: 16, cap: BABYLON.Mesh.CAP_ALL
  }, babylonScene);
  // Shared material - the chosen one if this strut stands on the base, plain
  // black if it's a shape-to-shape brace. See strutSurfaceMaterial. The black
  // core above stays black in every case: it's what you see through the
  // translucent resin option, and it's simply hidden inside the rod under
  // every opaque one.
  tube.material = strutSurfaceMaterial(grounded);
  (grounded ? strutShellMeshes : strutBlackMeshes).push(tube);
  return tube;
}

// Small red sphere marking a real connection/contact point in world space -
// every Tier-2 connector/ornament's anchor point, where the "skeleton"
// (lines/arcs/beziers) actually touches a shape's real surface. Visual
// verification of the connectivity system, per the user's explicit request.
const CONNECTION_DOT_COLOR = { r: 1, g: 0, b: 0, a: 1 };
// A real "lollipop head" for aux-support endpoints specifically - bigger
// than the default dot (used for thin skeletal connector touch points),
// matching a substantial cylindrical rod rather than a thin wire.
const AUX_SUPPORT_HEAD_RADIUS = 0.6;
// Debug toggle for the red dots - they served their purpose (verifying every
// anchor lands on real material) but 40+ of them add a red speckle the 2D
// composition never had. Flip to true in the console
// (window.SHOW_CONNECTION_DOTS = true) and re-enter 3D mode to re-verify.
window.SHOW_CONNECTION_DOTS = false;
function markConnectionPoint(name, pointWorld, radius = 0.35) {
  if (!window.SHOW_CONNECTION_DOTS) return null;
  const dot = BABYLON.MeshBuilder.CreateSphere(name, { diameter: radius * 2, segments: 8 }, babylonScene);
  dot.position = new BABYLON.Vector3(pointWorld.x, pointWorld.y, pointWorld.z);
  dot.material = unlitMat(name + '_mat', CONNECTION_DOT_COLOR);
  return dot;
}

// Bounding-sphere radius (+ z offset from the anchor point to the mesh's true
// geometric center) for any shape type that has a real, hard-edged volume -
// matching create3DShape's/createOpenShape3D's/createConcentricCircle3D's real
// mesh math exactly. Returns null for types with no real volume to bound
// (squiggle/arc-shape/halo - all stroke-only or soft glow; concentricArc now
// DOES have real volume - a clear resin wedge behind its rings, see
// createConcentricArc3D - and is a full Tier-1 participant too).
// Deliberately NOT gated on style==='filled': open-style rect/triangle/
// semiCircle (openRect/openTriangle/openSemiCircle - this is what BOTH
// skeleton shapes always are, per createShapeElement) use the exact same
// size/depth math as their filled counterparts (createOpenShape3D's Z VOLUME
// section builds a real front/back-separated volume, not a flat sprite) - the
// user's rule only exempts arcs/lines/beziers/spirals, not translucent
// gradient-edged shapes, so these are full Tier-1 tree participants too (see
// buildElementTree), not just fixed obstacles - open-style shapes get moved
// and touch-tested exactly like their filled counterparts.
function shapeVolumeRadius3D(shape) {
  if (!shape) return null;
  const s = (shape.targetSize || 50) / K3D_SCALE;
  if (shape.type === 'concentricCircle') {
    // createConcentricCircle3D stacks `rings` thin discs at z-(rings-i)*0.6 -
    // the stack is asymmetric around the anchor z, so zOffset centers it (see
    // sign derivation below). r is the OUTER RING RADIUS ONLY, deliberately
    // NOT padded by the stack's small Z half-span (was `+ (rings-1)*0.3 +
    // 0.25`) - see the circle/rect/triangle comment below for why: that
    // extra padding is exactly the gap computeContactTilt can never actually
    // close, since its tilt only ever aligns the in-plane rim, never a Z pad
    // on top of it.
    const rings = shape.rings || 4;
    const diff3 = (shape.diff || 10) / K3D_SCALE;
    const outerR = rings * diff3;
    // Sign check: createConcentricCircle3D places ring i at world Z =
    // zPos - (rings-i)*0.6 (zPos = -layerZ). The true center (midpoint of the
    // front face at zPos+0.25 and the back face at zPos-(rings-1)*0.6-0.25) is
    // zPos-(rings-1)*0.3 in world space, which converts back to
    // layerZ-space (anchorZ + zOffset, since world = -layerZ-space) as
    // anchorZ + (rings-1)*0.3 - i.e. zOffset is POSITIVE here, not negative.
    return { r: outerR, zOffset: (rings - 1) * 0.3 };
  }
  if (shape.type === 'concentricArc') {
    // Reclassified as Tier-1 (real volume) - the nested stroke-only rings
    // now get a solid clear-resin wedge behind them (see createConcentricArc3D)
    // so they read as a real physical object instead of bare floating wire.
    // r is the outer ring radius, same formula as concentricCircle above.
    const rings = shape.rings || 4;
    const diff3 = (shape.diff || 10) / K3D_SCALE;
    return { r: rings * diff3, zOffset: 0 };
  }
  if (shape.style === 'halo') return null; // soft radial glow, no hard edge to bound
  // Deliberately just the in-plane corner/rim distance, NOT padded by the
  // shape's Z-thickness (was `+ depth/2` here) - that padding was a real bug,
  // not just extra safety margin: computeContactTilt reorients a tilted
  // shape so this exact in-plane point faces its contact partner, so the
  // partner's center gets placed `r_A + r_B + pad` away assuming this point
  // is what's touching. Any extra padding beyond it is a gap the tilt can
  // never close (a tilt only ever aligns direction, not magnitude) - it
  // showed up as every tilted contact visibly NOT quite kissing. The
  // Z-thickness itself is small relative to the in-plane dimension (depth
  // maxes out around 12% of size) and is still covered by SOLID_CONTACT_PAD
  // for the rare untilted/other-direction overlap check.
  switch (shape.type) {
    case 'circle':
    case 'semiCircle':
      // Farthest arc/edge point is exactly s/2 from local origin (both types)
      return { r: s / 2, zOffset: 0 };
    case 'rect':
      // Box's in-plane corner distance (w=s, h=s*0.6) - rotation-invariant
      return { r: (s / 2) * Math.sqrt(1 + 0.6 * 0.6), zOffset: 0 };
    case 'triangle':
      // Circumradius of the equilateral profile used in create3DShape
      return { r: s / Math.sqrt(3), zOffset: 0 };
    default:
      return null; // squiggle, arc (shape-type), halo - stroke-only/glow, still Tier-2 pass-through
  }
}

// Real per-shape 2D profile + Z half-thickness, used by supportDistanceWorld
// (below) to find the shape's ACTUAL boundary point in an arbitrary
// direction - as opposed to shapeVolumeRadius3D's single scalar `r`, which
// is only ever exact in the ONE direction a shape gets tilted to face (see
// computeContactTilt). A shape touched from any OTHER direction (a "hub"
// with more than one thing attached) needs its real silhouette, not the
// bounding sphere, or the touch point lands past the real edge in empty
// air. `rad` is the already-computed shapeVolumeRadius3D(shape) result,
// passed in so the two never compute a different `r` for the same shape.
// Mirrors create3DShape's exact geometry (w/h/vertex formulas, `depth`)
// so a support query always matches what's actually rendered.
function computeShapeProfile3D(shape, rad) {
  if (!shape || !rad) return null;
  const s = (shape.targetSize || 50) / K3D_SCALE;
  if (shape.type === 'concentricCircle') {
    const rings = shape.rings || 4;
    return { localProfile: { kind: 'isotropic', R: rad.r }, zHalf: 0.25 + (rings - 1) * 0.3 };
  }
  if (shape.type === 'concentricArc') {
    // rad.r (outer ring radius) drives the resin wedge's size, NOT `s`
    // (targetSize-based - unrelated to a concentricArc's real footprint) -
    // matches the depth createConcentricArc3D's resin wedge actually uses.
    const resinDepth = Math.max(0.8, rad.r * 2 * 0.12);
    return { localProfile: { kind: 'isotropic', R: rad.r }, zHalf: resinDepth / 2 };
  }
  const zHalf = Math.max(0.8, s * 0.12) / 2; // matches create3DShape's `depth` / 2
  switch (shape.type) {
    case 'circle':
      return { localProfile: { kind: 'isotropic', R: s / 2 }, zHalf };
    case 'semiCircle':
      // Really should be a true rotation-aware half-disc boundary instead of
      // this full-circle isotropic approximation (a rotated open semiCircle's
      // real reach depends heavily on direction, which isotropic ignores -
      // struts can land short of the true edge). Two attempts at a real
      // polygon profile here (25 vertices, then 8) each broke 3D mode
      // outright - first a page hang, then a blank canvas as soon as any
      // open semiCircle was in the composition - so this is reverted back to
      // the simple, proven isotropic version until the actual cause is
      // isolated with proper diagnostics rather than guessed at again.
      return { localProfile: { kind: 'isotropic', R: s / 2 }, zHalf };
    case 'rect': {
      const w = s, h = s * 0.6;
      return {
        localProfile: { kind: 'polygon', vertices: [
          { x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }
        ] },
        zHalf
      };
    }
    case 'triangle': {
      const h = s * Math.sqrt(3) / 2;
      return {
        localProfile: { kind: 'polygon', vertices: [
          { x: -s / 2, y: -h / 3 }, { x: s / 2, y: -h / 3 }, { x: 0, y: 2 * h / 3 }
        ] },
        zHalf
      };
    }
    default:
      return null;
  }
}

// Bundles a shape's static geometry fields (never change once the shape's
// size/rotation are known, independent of where it ends up placed) onto a
// Tier-1 node - shared by the shapes/ornaments gather loops below so a
// skeleton and an ornament of the same type/size get identical support
// behavior. Falls back to a plain sphere (localProfile: null) for types
// computeShapeProfile3D doesn't recognize (shouldn't happen for anything
// shapeVolumeRadius3D already accepted, kept only as a safety net).
function tier1ShapeFields(shape, rad) {
  const profile = computeShapeProfile3D(shape, rad);
  return {
    shapeType: shape.type,
    s: (shape.targetSize || 50) / K3D_SCALE,
    rotZ: -(shape.rot || 0),
    localProfile: profile ? profile.localProfile : null,
    zHalf: profile ? profile.zHalf : rad.r
  };
}

// Corner/rim-aware tilt: buildElementTree's contact math assumes each
// solid can reach its FULL bounding radius in the exact direction of its
// contact partner - true for a sphere, but these shapes are thin extruded
// discs/prisms whose real reach is anisotropic (full radius sideways within
// their own profile, only half their thin depth straight through their
// face). Without ever actually turning to face the contact direction, two
// flat, camera-facing shapes stacked mostly along Z would be reported as
// "touching" while their real thin faces left a visible gap. This computes
// the extra tilt (on top of the shape's existing 2D-derived rotZ) that turns
// the profile's nearest corner/rim point to face `dirWorld` exactly, so the
// bounding-sphere assumption becomes geometrically true instead of merely
// optimistic - corner-to-corner, corner-to-side, or corner-to-face contact,
// whichever the geometry naturally produces.
function computeContactTilt(type, s, rotZ, dirWorld) {
  let localCandidates;
  switch (type) {
    case 'circle':
    case 'semiCircle':
    case 'concentricCircle':
      // Isotropic in-plane profile (disc/wedge/ring) - any in-plane direction
      // sits exactly at the bounding radius, so a single arbitrary reference
      // is enough; the tilt below still correctly aims it at dirWorld.
      localCandidates = [new BABYLON.Vector3(1, 0, 0)];
      break;
    case 'rect': {
      const w = s, h = s * 0.6;
      localCandidates = [
        new BABYLON.Vector3(w / 2, h / 2, 0), new BABYLON.Vector3(-w / 2, h / 2, 0),
        new BABYLON.Vector3(w / 2, -h / 2, 0), new BABYLON.Vector3(-w / 2, -h / 2, 0)
      ];
      break;
    }
    case 'triangle': {
      const h = s * Math.sqrt(3) / 2;
      localCandidates = [
        new BABYLON.Vector3(-s / 2, -h / 3, 0), new BABYLON.Vector3(s / 2, -h / 3, 0),
        new BABYLON.Vector3(0, 2 * h / 3, 0)
      ];
      break;
    }
    default:
      return null;
  }

  const dir = new BABYLON.Vector3(dirWorld.x, dirWorld.y, dirWorld.z).normalize();

  // Rotate each local candidate by the shape's existing rotZ first (matching
  // its current on-screen orientation), then pick whichever ends up closest
  // to dirWorld already - so the tilt computed below is the SMALLEST extra
  // rotation needed on top of the shape's original 2D-derived look, not a
  // full from-scratch reorientation.
  const cosZ = Math.cos(rotZ), sinZ = Math.sin(rotZ);
  let best = null, bestDot = -Infinity;
  for (const c of localCandidates) {
    const rotated = new BABYLON.Vector3(c.x * cosZ - c.y * sinZ, c.x * sinZ + c.y * cosZ, c.z).normalize();
    const dot = BABYLON.Vector3.Dot(rotated, dir);
    if (dot > bestDot) { bestDot = dot; best = rotated; }
  }

  // Minimal rotation mapping `best` (the shape's current nearest reach point,
  // post-rotZ) onto `dir`.
  const axis = BABYLON.Vector3.Cross(best, dir);
  const axisLen = axis.length();
  const dotClamped = Math.max(-1, Math.min(1, BABYLON.Vector3.Dot(best, dir)));
  const angle = Math.acos(dotClamped);
  let qTilt;
  if (axisLen < 1e-6) {
    // best and dir are already (anti)parallel - cross product gives no usable
    // axis. Angle ~0: no tilt needed. Angle ~PI (contact is exactly opposite
    // the nearest reach point, rare): pick any perpendicular axis to flip it.
    qTilt = angle < 1e-3
      ? BABYLON.Quaternion.Identity()
      : BABYLON.Quaternion.RotationAxis(Math.abs(best.x) < 0.9 ? BABYLON.Axis.X : BABYLON.Axis.Y, Math.PI);
  } else {
    qTilt = BABYLON.Quaternion.RotationAxis(axis.normalize(), angle);
  }

  // Compose: apply the shape's existing rotZ first, then the extra tilt on top.
  const qRotZ = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Z, rotZ);
  return qTilt.multiply(qRotZ);
}

// ===== Real-geometry support distance =====
// A shape only ever gets ONE tilt (toward whichever direction determined
// its own placement, see computeContactTilt) - anything ELSE that touches
// the same shape from a different direction (a "hub") was, until now,
// still assumed to reach the shape's full scalar radius `r` in that new
// direction too. For a sphere that's true; for a flat plate, box, or
// triangle it's usually false - between two corners a polygon's real edge
// sits closer to center than `r`, so the old assumption placed those
// touch points (and the red dots marking them) past the real mesh, in
// empty air. These functions instead ray-cast the shape's REAL, correctly
// oriented silhouette (an extruded 2D profile capped by `zHalf`) to find
// exactly where its boundary is in ANY given world direction.

// Rotates vector `v` by quaternion `q` (v' = q*v*q^-1, optimized form) -
// plain math on {x,y,z}/{x,y,z,w} objects, no BABYLON Vector3 instance
// dependency, so it works the same whether the caller built its objects
// via `new BABYLON.Vector3(...)` or plain literals.
function rotateVecByQuat(v, q) {
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx)
  };
}
// World -> local direction: rotate by the CONJUGATE (= inverse, for a unit
// quaternion) of the shape's orientation.
function worldToLocalDir(worldDir, quat) {
  return rotateVecByQuat(worldDir, { x: -quat.x, y: -quat.y, z: -quat.z, w: quat.w });
}

// Ray-from-origin vs. convex-polygon-boundary intersection (standard 2D
// cross-product form): returns the smallest positive `t` such that
// `t*(dx,dy)` lies exactly on the polygon's boundary, or Infinity if the
// ray direction is ~zero (pure-Z case, handled by the caller). `vertices`
// must wind around the origin (true for every profile in
// computeShapeProfile3D - all centered on the shape's own anchor).
function polygonRayExitT(dx, dy, vertices) {
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return Infinity;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const A = vertices[i], B = vertices[(i + 1) % n];
    const ex = B.x - A.x, ey = B.y - A.y;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-9) continue;
    const t = (A.x * ey - A.y * ex) / denom;
    const s = (A.x * dy - A.y * dx) / denom;
    if (t > 1e-9 && s >= -1e-6 && s <= 1 + 1e-6) return t;
  }
  return Infinity; // unreachable for a convex polygon that contains the origin
}

// Distance from center to the extruded profile's real boundary along a
// LOCAL-space direction - the profile's in-plane silhouette (isotropic
// disc or polygon) capped by the extrusion's flat top/bottom face at
// `zHalf`, whichever the ray hits first (exactly how a real thin
// disc/box/prism behaves: reach the full in-plane edge sideways, only
// `zHalf` straight through the face).
function profileSupportDistance(profile, localDir, zHalf) {
  const inPlaneLen = Math.hypot(localDir.x, localDir.y);
  const tZ = Math.abs(localDir.z) > 1e-9 ? zHalf / Math.abs(localDir.z) : Infinity;
  const tXY = inPlaneLen > 1e-9
    ? (profile.kind === 'isotropic' ? profile.R / inPlaneLen : polygonRayExitT(localDir.x, localDir.y, profile.vertices))
    : Infinity;
  return Math.min(tXY, tZ);
}

// The real, orientation-aware version of "how far does this shape reach in
// world direction `worldDir`". `nodeInfo` needs {shapeType, s, rotZ,
// localProfile, zHalf, r} (every Tier-1 node carries these once built -
// see the tier1Nodes gather loops in convertShapesTo3D). `tiltDir` is
// always null now (shapes never tilt/rearrange - see buildElementTree),
// which renders as plain Rz(rotZ) - matching create3DShape's own
// `contactQuat = contactDir ? ... : null` fallback exactly, so this always
// agrees with what actually gets drawn. Shapes with no real profile
// (lattices) fall back to the old sphere approximation - create3DLattice
// never tilts them anyway.
function supportDistanceWorld(nodeInfo, tiltDir, worldDir) {
  const profile = nodeInfo.localProfile || { kind: 'isotropic', R: nodeInfo.r };
  const zHalf = nodeInfo.zHalf != null ? nodeInfo.zHalf : nodeInfo.r;
  const quat = (tiltDir && nodeInfo.localProfile)
    ? computeContactTilt(nodeInfo.shapeType, nodeInfo.s, nodeInfo.rotZ, tiltDir)
    : null;
  const q = quat || nodeInfo.fixedOrientation || BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Z, nodeInfo.rotZ || 0);
  const localDir = worldToLocalDir(worldDir, q);
  return profileSupportDistance(profile, localDir, zHalf);
}

// supportDistanceWorld(..., DOWN) is a single ray-cast from center - exactly
// right for an isotropic (circular) profile, since a circle's lowest point
// is always straight down. For a rotated POLYGON profile that ray usually
// hits an EDGE, not the shape's true lowest CORNER, which can sit further
// down and off to one side - a rotated rect's real lowest reach was being
// underestimated, letting a rotated shape's actual lowest corner clip
// through the base even though the (wrong) straight-down distance looked
// clear. Checks every real vertex, rotated the same way the shape actually
// renders, and takes the true maximum drop - used anywhere a shape's lowest
// reach must be a hard guarantee (violatesFloor, the base's own Y
// placement), not just an aesthetic strut touch point.
function trueLowestReach(nodeInfo, tiltDir) {
  const rayDist = supportDistanceWorld(nodeInfo, tiltDir, { x: 0, y: -1, z: 0 });
  const profile = nodeInfo.localProfile;
  if (!profile || profile.kind !== 'polygon') return rayDist;
  const quat = (tiltDir && nodeInfo.localProfile)
    ? computeContactTilt(nodeInfo.shapeType, nodeInfo.s, nodeInfo.rotZ, tiltDir)
    : null;
  const q = quat || nodeInfo.fixedOrientation || BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Z, nodeInfo.rotZ || 0);
  let maxDrop = 0;
  profile.vertices.forEach(v => {
    const world = rotateVecByQuat({ x: v.x, y: v.y, z: 0 }, q);
    if (-world.y > maxDrop) maxDrop = -world.y;
  });
  return Math.max(rayDist, maxDrop);
}

// Is `worldPoint` inside `node`'s real solid volume? Distance from the
// node's true world center, compared against how far the node's own
// profile actually reaches in that exact direction (supportDistanceWorld) -
// works for isotropic or polygon profiles alike, the same boundary math
// every strut/placement check already relies on.
function pointInsideTier1Volume(worldPoint, node) {
  const wc = tier1WorldCenter(node);
  const dx = worldPoint.x - wc.x, dy = worldPoint.y - wc.y, dz = worldPoint.z - wc.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return true;
  const boundary = supportDistanceWorld(node, null, { x: dx / dist, y: dy / dist, z: dz / dist });
  return dist < boundary;
}

// "These are all solid objects... they can't [pass through each other]...
// they must be fastened to each other on the surface." Shared depth-clearance
// for every rigid wire connector (line/bezier/arcline/spiral) - originally
// only the bezier had this, leaving plain lines (often the THICKEST strokes
// in the piece) free to spear straight through shapes' volumes. A wire's 2D
// path is frozen (never reshaped), but its DEPTH is free: sample the same
// points the create3D* function actually renders, at the wire's real final
// position, and if any land inside a Tier-1 shape's volume, search alternate
// Z-leans for one that clears everything. The wire's own TARGET is only
// exempt within a small parameter neighborhood of the anchor - "fastened at
// the surface" means ONE touch point, not license for the rest of the wire
// to lie inside the target. (Excluding the whole target - the original
// behavior - let a spiral's coil, which hugs its target's face, slide whole
// loops through the target's volume the moment its free-end lean tilted it
// inward, with nothing checking it.) Falls back to the original lean if
// nothing clear turns up (same honest fallback as drawClearStrut).
// `samplePixelPts` must use the same parametrization the rendered tube's own
// Z-ramp uses (uniform index over the drawn points), so the checked curve
// always matches the drawn one.
const WIRE_ANCHOR_EPS = 0.05; // parameter-distance around the anchor that's allowed to touch the target
// The free-end lean used when a connector has no genuine second target to
// reach toward. Module scope (was local to convertShapesTo3D) so
// computeConnectorAnchor resolves the EXACT same fallback before running its
// clearance check - previously the check could return null here, whereupon
// realizeConnector quietly substituted this value UNCHECKED, so the tilt
// actually rendered was never the tilt that was verified. That is what kept
// driving spiral coils through shapes even after the check existed.
const CONNECTOR_FREE_END_TILT = 6;
// Returns a tilt that is always a real number, and always the one that was
// actually verified. If nothing is fully clear, returns the BEST-EFFORT
// candidate (fewest intersecting samples) rather than the original - a wire
// grazing one shape is strictly better than one buried through three.
function clearWireZTilt(samplePixelPts, deltaPixel, touchZ, anchorT, zTilt, tier1Placed, target) {
  const n = samplePixelPts.length - 1 || 1;
  const violations = (tilt) => {
    let count = 0;
    samplePixelPts.forEach((p, idx) => {
      const t = idx / n;
      const w = pixelToWorld(p.x + deltaPixel.dx, p.y + deltaPixel.dy);
      const pt = { x: w.x, y: w.y, z: touchZ + (t - anchorT) * tilt };
      tier1Placed.forEach(node => {
        if (node.isBase) return;
        if (node === target && Math.abs(t - anchorT) <= WIRE_ANCHOR_EPS) return;
        if (pointInsideTier1Volume(pt, node)) count++;
      });
    });
    return count;
  };
  const start = zTilt == null ? 0 : zTilt;
  if (violations(start) === 0) return start;
  const candidates = [0, MAX_REACH_ZTILT, -MAX_REACH_ZTILT, MAX_REACH_ZTILT * 0.5, -MAX_REACH_ZTILT * 0.5,
    MAX_REACH_ZTILT * 0.25, -MAX_REACH_ZTILT * 0.25, MAX_REACH_ZTILT * 0.75, -MAX_REACH_ZTILT * 0.75];
  let best = start, bestCount = violations(start);
  for (const cand of candidates) {
    const c = violations(cand);
    if (c < bestCount) { bestCount = c; best = cand; }
    if (c === 0) return cand;
  }
  return best;
}

// semiCircle's real shape is a half-disc (bulge at local y<0, flat/open edge
// at y=0 - see arcPathLocal), but its shared localProfile stays isotropic
// (matches a full circle in every direction) for safety - two attempts at a
// real polygon profile there each broke 3D mode outright in different ways
// once fed into buildElementTree's placement machinery (a page hang, then a
// blank canvas). This is a narrow, SEPARATE correction used only where
// struts pick a touch point - never in placement/collision, which stays on
// the safe isotropic path. If the query direction points into the shape's
// empty half, cap the reach down near its own thickness instead of the full
// isotropic radius, so a strut aimed through an open semiCircle's missing
// material doesn't reach as far as where a full circle's edge would be.
function semiCircleAwareDistance(nodeInfo, worldDir) {
  const baseDist = supportDistanceWorld(nodeInfo, nodeInfo.contactDir, worldDir);
  if (nodeInfo.shapeType !== 'semiCircle') return baseDist;
  const q = nodeInfo.fixedOrientation || BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Z, nodeInfo.rotZ || 0);
  const localDir = worldToLocalDir(worldDir, q);
  const inPlaneLen = Math.hypot(localDir.x, localDir.y);
  if (inPlaneLen > 1e-6 && localDir.y / inPlaneLen > 0.05) {
    const zHalf = nodeInfo.zHalf != null ? nodeInfo.zHalf : nodeInfo.r;
    return Math.min(baseDist, zHalf * 1.5);
  }
  return baseDist;
}

function create3DShape(shape, index, layerZ = 0, contactDir = null, resolvedXY = null) {
  if (!shape || !babylonScene) {
    console.warn('Cannot create shape - missing shape or scene');
    return false;
  }

  const S2 = shape.targetSize || 50;             // 2D pixel size
  const s = S2 / K3D_SCALE;                      // 3D size
  const sw3 = Math.max((shape.sw || 2) / K3D_SCALE, 0.16); // stroke thickness (3D units)
  const swr = sw3 / 2;                           // tube radius
  const depth = Math.max(0.8, s * 0.12);         // Z thickness: real 3D volume per shape
  const zPos = -layerZ;
  // resolvedXY (world units) comes from buildElementTree (Tier 1) or
  // computeConnectorAnchor (Tier 2 halo/arc-type ornaments) - NEVER read
  // shape.x/y directly here once a resolved position exists, since shape.x/y
  // is the live 2D object the running p5 draw loop also reads every frame.
  // The raw-shape.x/y fallback below only matters if this is ever called
  // without a resolved position (shouldn't happen post-rewrite, kept as a
  // safe default rather than a silent crash).
  const xPos = resolvedXY ? resolvedXY.x : (shape.x - window.innerWidth / 2) / K3D_SCALE;
  const yPos = resolvedXY ? resolvedXY.y : -(shape.y - window.innerHeight / 2) / K3D_SCALE;
  const rotZ = -(shape.rot || 0);                // P5 rotation -> Babylon (Y flipped)
  const fill = bodyColor3D(p5ColToRGBA(shape.c)); // global 3D translucency + saturation compensation

  // CONTACT TILT: when buildElementTree found a real touching neighbor for
  // this shape, wrap it in a TransformNode carrying the combined
  // rotZ+tilt orientation so its nearest corner/rim actually faces that
  // neighbor (see computeContactTilt) - the mesh(es) below are then built at
  // the node's local origin with zero rotation of their own and parented to
  // it, so the node's transform does all the positioning/orienting. Shapes
  // with no contactDir (not solid, or no contact found) are completely
  // unaffected - meshX/Y/Z/RotZ just fall back to the plain xPos/yPos/zPos/rotZ
  // used everywhere today.
  const contactQuat = contactDir ? computeContactTilt(shape.type, s, rotZ, contactDir) : null;
  let tiltNode = null;
  if (contactQuat) {
    // Pivot at the shape's TRUE geometric center, not its anchor point -
    // for circle/rect/triangle/semiCircle these coincide (zOffset 0), but
    // concentricCircle's anchor sits off-center from its ring stack
    // (zOffset != 0, see shapeVolumeRadius3D). Rotating around the wrong
    // pivot would displace the shape's real center away from the position
    // buildElementTree verified as non-overlapping - defeating the
    // whole point of the contact math. World Z of the true center = zPos -
    // zOffset (zOffset is in the same layerZ-space anchorZ/zPos already use).
    const vol = shapeVolumeRadius3D(shape);
    const trueCenterZ = zPos - (vol ? vol.zOffset : 0);
    tiltNode = new BABYLON.TransformNode(`tilt_${index}`, babylonScene);
    tiltNode.position = new BABYLON.Vector3(xPos, yPos, trueCenterZ);
    tiltNode.rotationQuaternion = contactQuat;
  }
  const meshX = tiltNode ? 0 : xPos;
  const meshY = tiltNode ? 0 : yPos;
  const meshZ = tiltNode ? 0 : zPos;
  const meshRotZ = tiltNode ? 0 : rotZ;

  try {
    // ---- circle / halo ----
    if (shape.type === 'circle') {
      if (shape.style === 'halo') {
        return createHalo3D(shape, index, xPos, yPos, zPos, s, swr);
      }
      const disc = BABYLON.MeshBuilder.CreateCylinder(`shape_${index}`, {
        diameter: s, height: depth, tessellation: 64
      }, babylonScene);
      disc.rotation.x = Math.PI / 2;
      disc.position = new BABYLON.Vector3(meshX, meshY, meshZ);
      disc.material = unlitMat(`mat_${index}`, fill);
      if (tiltNode) disc.parent = tiltNode;
      addPrismOutline(`outline_${index}`, arcPathLocal(s / 2, 0, Math.PI * 2, 64), depth, swr, meshX, meshY, meshZ, 0, [], false, tiltNode);
      return true;
    }

    // ---- rect (2D is s wide x 0.6s tall!) ----
    if (shape.type === 'rect') {
      if (shape.style === 'open') return createOpenShape3D(shape, index, meshX, meshY, meshZ, s, meshRotZ, tiltNode);
      const w = s, h = s * 0.6;
      const box = BABYLON.MeshBuilder.CreateBox(`shape_${index}`, { width: w, height: h, depth: depth }, babylonScene);
      box.position = new BABYLON.Vector3(meshX, meshY, meshZ);
      box.rotation.z = meshRotZ;
      box.material = unlitMat(`mat_${index}`, fill);
      if (tiltNode) box.parent = tiltNode;
      const rp = [
        new BABYLON.Vector3(-w / 2, -h / 2, 0), new BABYLON.Vector3(w / 2, -h / 2, 0),
        new BABYLON.Vector3(w / 2, h / 2, 0), new BABYLON.Vector3(-w / 2, h / 2, 0),
        new BABYLON.Vector3(-w / 2, -h / 2, 0)
      ];
      addPrismOutline(`outline_${index}`, rp, depth, swr, meshX, meshY, meshZ, meshRotZ, rp.slice(0, 4), true, tiltNode);
      return true;
    }

    // ---- triangle (apex UP like 2D, equilateral centered on centroid) ----
    if (shape.type === 'triangle') {
      if (shape.style === 'open') return createOpenShape3D(shape, index, meshX, meshY, meshZ, s, meshRotZ, tiltNode);
      const h = s * Math.sqrt(3) / 2;
      // Triangular PRISM (real 3D volume) - exact same profile as the 2D triangle
      extrudePrism(`shape_${index}`, [
        new BABYLON.Vector3(-s / 2, -h / 3, 0),
        new BABYLON.Vector3(s / 2, -h / 3, 0),
        new BABYLON.Vector3(0, 2 * h / 3, 0)
      ], depth, fill, meshX, meshY, meshZ, meshRotZ, tiltNode);
      const v = [
        new BABYLON.Vector3(-s / 2, -h / 3, 0),
        new BABYLON.Vector3(s / 2, -h / 3, 0),
        new BABYLON.Vector3(0, 2 * h / 3, 0),
        new BABYLON.Vector3(-s / 2, -h / 3, 0)
      ];
      addPrismOutline(`outline_${index}`, v, depth, swr, meshX, meshY, meshZ, meshRotZ, v.slice(0, 3), true, tiltNode);
      return true;
    }

    // ---- semiCircle (2D arc(0,0,s,s,0,PI) = bottom half on screen) ----
    if (shape.type === 'semiCircle') {
      if (shape.style === 'open') {
        const success = createOpenShape3D(shape, index, meshX, meshY, meshZ, s, meshRotZ, tiltNode);
        // "Complete the circle with 90% translucency" - createOpenShape3D's
        // own gradient already fades to fully transparent right at the
        // flat/open edge, so a strut or connector landing near there reads
        // as touching nothing. A faint (10% opacity) FULL disc - literally
        // the same half-disc wedge geometry every filled semiCircle already
        // uses, just mirrored to a full sweep - suggests the whole circle's
        // real presence without competing with the actual rendered half. No
        // outline (matches the earlier "no black line" call); the earlier
        // flat-cap attempt at this was reverted on suspicion of causing a
        // blank-canvas crash, but that was actually a separate bug (the
        // semiCircle support-profile change) - this is new rendering-only
        // geometry, not a repeat of that.
        if (success) {
          const ghostFill = CLEAR_RESIN_COLOR; // colorless (not tinted with the shape's own hue) - same neutral clear-resin material used elsewhere in the piece
          extrudePrism(`shape_${index}_ghost`, arcPathLocal(s / 2, 0, Math.PI * 2, 96), depth, ghostFill, meshX, meshY, meshZ, meshRotZ, tiltNode);
        }
        return success;
      }
      // Half-disc WEDGE (real 3D volume) - profile matches the 2D bottom-half arc exactly
      extrudePrism(`shape_${index}`, arcPathLocal(s / 2, 0, Math.PI, 48), depth, fill, meshX, meshY, meshZ, meshRotZ, tiltNode);
      // 2D stroke follows the curved edge only (the flat diameter edge stays unstroked)
      const semiArc = arcPathLocal(s / 2, 0, Math.PI, 48);
      addPrismOutline(`outline_${index}`, semiArc, depth, swr, meshX, meshY, meshZ, meshRotZ,
        [semiArc[0], semiArc[semiArc.length - 1]], true, tiltNode);
      return true;
    }

    if (shape.type === 'concentricCircle') {
      return createConcentricCircle3D(shape, index, xPos, yPos, zPos, tiltNode);
    }
    if (shape.type === 'concentricArc') {
      return createConcentricArc3D(shape, index, xPos, yPos, zPos, swr, rotZ, tiltNode);
    }

    // ---- squiggle: STROKED wavy line with shape color (like 2D) ----
    if (shape.type === 'squiggle') {
      if (!shape.sv || shape.sv.length < 2) return false;
      const pts = shape.sv.map(p => new BABYLON.Vector3(p.x / K3D_SCALE, -p.y / K3D_SCALE, 0));
      makeStrokeTube(`shape_${index}`, pts, swr, fill, xPos, yPos, zPos, rotZ);
      return true;
    }

    // ---- arc: STROKED arc (noFill in 2D!) with shape color ----
    if (shape.type === 'arc') {
      const a0 = shape.arcStart || 0;
      const a1 = a0 + (shape.arcSweep || Math.PI);
      makeStrokeTube(`shape_${index}`, arcPathLocal(s / 2, a0, a1, 48), swr, fill, xPos, yPos, zPos, rotZ);
      return true;
    }

    // ---- fallback: plain disc ----
    const disc = BABYLON.MeshBuilder.CreateCylinder(`shape_${index}`, {
      diameter: s, height: 0.3, tessellation: 64
    }, babylonScene);
    disc.rotation.x = Math.PI / 2;
    disc.position = new BABYLON.Vector3(xPos, yPos, zPos);
    disc.material = unlitMat(`mat_${index}`, fill);
    return true;
  } catch (e) {
    console.error(`Failed to create shape ${index} (${shape.type}/${shape.style}):`, e);
    return false;
  }
}

// Total Z depth a halo's own ring stack actually spans - 8 gradient layers
// (each += 0.03) plus (rings-1) solid rings (each += 0.5), exactly matching
// createHalo3D's own `front` stepping below. Shared with
// computeConnectorAnchor's 'halo' case so the resin shell's real extent and
// the touch-point math computed against it can never drift apart.
function haloRingSpan(rings) {
  return 8 * 0.03 + Math.max(0, rings - 1) * 0.5;
}

function createHalo3D(shape, index, x, y, z, s, swr) {
  // 2D: maxRadius = s/2; radius_i = maxR*(rings-i)/rings
  // i=0: radial gradient (solid core -> transparent rim), no stroke
  // i>0: solid muted color + black stroke (sw * 0.5)
  const rings = shape.rings || 3;
  const maxR = s / 2;
  let front = 0; // each later element drawn slightly in front (like 2D painter order)

  for (let i = 0; i < rings; i++) {
    const radius = maxR * (rings - i) / rings;
    const raw = p5ColToRGBA(shape.haloColors && shape.haloColors[i] ? shape.haloColors[i] : shape.c);
    // 2D mutes: saturation*0.7, lightness*0.8, alpha 0.8 (approximated in RGB)
    // - then the global 3D body treatment (translucency + saturation
    // compensation) on top; the gradient ring's stops already derive from
    // muted's r/g/b/a, so this covers both the solid rings and the glow
    const muted = bodyColor3D({ r: raw.r * 0.85, g: raw.g * 0.85, b: raw.b * 0.85, a: 0.8 });

    if (i === 0) {
      // Real smooth radial gradient (canvas-drawn onto a DynamicTexture),
      // not a stack of discrete alpha-blended discs - the old approach
      // (8 layered circles, each a hard-edged step in opacity) read as
      // visibly "steppy"/banded up close since it only had 8 discrete
      // opacity levels. A true canvas gradient has no such steps - same
      // texture technique createOpenShape3D already uses for its own fade.
      const TEX = 512;
      const tex = new BABYLON.DynamicTexture(`haloGradTex_${index}`, { width: TEX, height: TEX }, babylonScene, true);
      tex.hasAlpha = true;
      const gctx = tex.getContext();
      gctx.clearRect(0, 0, TEX, TEX);
      const cx = TEX / 2, cy = TEX / 2, rPix = TEX / 2;
      const rr = Math.round(muted.r * 255), gg = Math.round(muted.g * 255), bb = Math.round(muted.b * 255);
      const grad = gctx.createRadialGradient(cx, cy, 0, cx, cy, rPix);
      grad.addColorStop(0, `rgba(${rr},${gg},${bb},${muted.a * 0.9})`);
      grad.addColorStop(0.6, `rgba(${rr},${gg},${bb},${muted.a * 0.35})`);
      grad.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
      gctx.fillStyle = grad;
      gctx.beginPath();
      gctx.arc(cx, cy, rPix, 0, Math.PI * 2);
      gctx.fill();
      tex.update();

      const disc = BABYLON.MeshBuilder.CreateDisc(`halo_${index}_glow`, {
        radius, tessellation: 64, sideOrientation: BABYLON.Mesh.DOUBLESIDE
      }, babylonScene);
      disc.position = new BABYLON.Vector3(x, y, z - front);
      const gradMat = new BABYLON.StandardMaterial(`haloGradMat_${index}`, babylonScene);
      gradMat.diffuseTexture = tex;
      gradMat.emissiveTexture = tex;
      gradMat.useAlphaFromDiffuseTexture = true;
      gradMat.disableLighting = true;
      gradMat.specularColor = new BABYLON.Color3(0, 0, 0);
      gradMat.backFaceCulling = false;
      disc.material = gradMat;
      front += 8 * 0.03; // same total depth budget the old 8-layer stack used - keeps haloRingSpan's formula (and the shell/anchor math built on it) unchanged
    } else {
      // Thin solid cylinder per ring = real 3D volume
      const disc = BABYLON.MeshBuilder.CreateCylinder(`halo_${index}_${i}`, {
        diameter: radius * 2, height: 0.4, tessellation: 64
      }, babylonScene);
      disc.rotation.x = Math.PI / 2;
      disc.position = new BABYLON.Vector3(x, y, z - front);
      disc.material = unlitMat(`haloMat_${index}_${i}`, muted);
      makeStrokeTube(`haloOutline_${index}_${i}`, arcPathLocal(radius, 0, Math.PI * 2, 64), swr * 0.5, K3D_BLACK, x, y, z - front - 0.25);
      front += 0.5;
    }
  }

  // A halo is otherwise just a stack of flat, camera-facing discs - real
  // color but no actual volume around it, floating like a decal. Same
  // treatment concentricArc's bare stroke rings got: a solid, mostly-
  // transparent clear-resin shell sized to the halo's own outer radius -
  // but spanning (and centered on) the FULL depth of the ring stack
  // (z - front to z), not just parked behind the backmost ring, so every
  // ring actually sits INSIDE the shell's volume instead of the shell
  // reading as a flat plate trailing behind them.
  const shellMargin = Math.max(0.4, maxR * 0.06);
  const shellDepth = front + shellMargin * 2;
  extrudePrism(`haloResin_${index}`, arcPathLocal(maxR, 0, Math.PI * 2, 64), shellDepth, CLEAR_RESIN_COLOR, x, y, z - front / 2);

  return true;
}

function createConcentricCircle3D(shape, index, x, y, z, tiltNode = null) {
  // 2D: noStroke! Drawn largest -> smallest, diameter = i * diff * 2
  const rings = shape.rings || 4;
  const diff3 = (shape.diff || 10) / K3D_SCALE;
  // Must exactly match shapeVolumeRadius3D's concentricCircle zOffset - when
  // tilted, tiltNode is pivoted at the TRUE center (anchor's world Z minus
  // this), not the anchor itself, so each ring's local offset needs the same
  // correction to land in exactly the same place a non-tilted stack would.
  const zOffset = (rings - 1) * 0.3;

  for (let i = rings; i > 0; i--) {
    const radius = i * diff3;
    if (radius <= 0) continue;
    // Thin solid cylinder per ring = real 3D volume
    const disc = BABYLON.MeshBuilder.CreateCylinder(`concentric_${index}_${i}`, {
      diameter: radius * 2, height: 0.5, tessellation: 64
    }, babylonScene);
    disc.rotation.x = Math.PI / 2;
    // Smaller rings drawn later in 2D = slightly in front here. When tilted
    // (contact placement gave this shape a real touching neighbor), the ring
    // stack's position/orientation is entirely carried by tiltNode - each
    // ring only needs its own local stacking offset (relative to the TRUE
    // center pivot, hence + zOffset) at the node origin.
    const localZ = -(rings - i) * 0.6;
    disc.position = tiltNode
      ? new BABYLON.Vector3(0, 0, localZ + zOffset)
      : new BABYLON.Vector3(x, y, z + localZ);
    if (tiltNode) disc.parent = tiltNode;
    const col = bodyColor3D(p5ColToRGBA(shape.concentricColors && shape.concentricColors[i - 1] ? shape.concentricColors[i - 1] : shape.c));
    disc.material = unlitMat(`concentricMat_${index}_${i}`, col);
  }
  return true;
}

function createConcentricArc3D(shape, index, x, y, z, swr, rotZ, tiltNode = null) {
  // 2D: noFill! STROKED arcs with concentric colors, diameter = i * diff * 2.
  // On their own these are bare open wire (stroke tubes, no fill) - reclassified
  // as Tier-1 with a real volume: a solid, mostly-transparent "clear resin"
  // wedge sized to the ring stack's own outer radius/sweep, so the nested
  // rings read as cast/embedded inside a real physical block, the way a
  // wireframe or metal armature gets held in a clear resin casting, rather
  // than floating as unsupported open curves.
  const rings = shape.rings || 4;
  const diff3 = (shape.diff || 10) / K3D_SCALE;
  const a0 = shape.arcStart || 0;
  const a1 = a0 + (shape.arcSweep || Math.PI);
  const outerR = rings * diff3;

  const meshX = tiltNode ? 0 : x;
  const meshY = tiltNode ? 0 : y;
  const meshZ = tiltNode ? 0 : z;
  const meshRotZ = tiltNode ? 0 : rotZ;

  const resinDepth = Math.max(0.8, outerR * 2 * 0.12); // must match computeShapeProfile3D's concentricArc zHalf*2
  const arcPts = arcPathLocal(outerR, a0, a1, 48);
  const wedgeProfile = [new BABYLON.Vector3(0, 0, 0), ...arcPts];
  extrudePrism(`concentricArcResin_${index}`, wedgeProfile, resinDepth, CLEAR_RESIN_COLOR, meshX, meshY, meshZ, meshRotZ, tiltNode);
  // No outline - a real black edge read as too heavy/solid for something meant
  // to look like clear resin. The near-invisible fill plus the rings it holds
  // is enough to convey "there's material here," per the user's call.

  for (let i = rings; i > 0; i--) {
    const radius = i * diff3;
    if (radius <= 0) continue;
    const col = bodyColor3D(p5ColToRGBA(shape.concentricColors && shape.concentricColors[i - 1] ? shape.concentricColors[i - 1] : shape.c));
    makeStrokeTube(`concentricArc_${index}_${i}`, arcPathLocal(radius, a0, a1, 48), swr, col, meshX, meshY, meshZ - (rings - i) * 0.05, meshRotZ, tiltNode);
  }
  return true;
}

// Open shapes: EXACT port of the 2D canvas code (linear gradient along
// gradientAngle, open edge stays open, outline only on closed edges).
// Rendered into a DynamicTexture on a plane = pixel-perfect 2D analog in 3D.
function createOpenShape3D(shape, index, x, y, z, s, rotZ, tiltNode = null) {
  const meshX = tiltNode ? 0 : x;
  const meshY = tiltNode ? 0 : y;
  const meshZ = tiltNode ? 0 : z;
  const meshRotZ = tiltNode ? 0 : rotZ;
  const S2 = shape.targetSize || 50; // 2D pixel size
  const PAD = 1.5;
  const TEX = 1536; // was 512: looked fuzzy up close in 3D (fixed texture res upscaled/magnified)
  const tex = new BABYLON.DynamicTexture(`openTex_${index}`, { width: TEX, height: TEX }, babylonScene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, TEX, TEX);
  ctx.save();
  ctx.translate(TEX / 2, TEX / 2);
  const k = TEX / (S2 * PAD);
  ctx.scale(k, k);
  ctx.lineWidth = shape.sw || 2;
  ctx.lineCap = 'round';

  // Saturation-compensated body color (see saturate3D) baked into the
  // texture's gradient stops; translucency is NOT baked in here - the
  // material's own alpha (BODY_ALPHA_3D, set below) multiplies the
  // texture's per-pixel alpha, so baking it too would double-apply it.
  const openFill = saturate3D(p5ColToRGBA(shape.c));
  const openCSS = a => `rgba(${Math.round(openFill.r * 255)},${Math.round(openFill.g * 255)},${Math.round(openFill.b * 255)},${a})`;
  const solid = openCSS(openFill.a);
  const transparent = openCSS(0);
  const theta = shape.gradientAngle || 0;
  const dx = Math.cos(theta), dy = Math.sin(theta);

  if (shape.type === 'rect') {
    const w = S2, h = S2 * 0.6;
    const verts = [[-w/2, -h/2], [w/2, -h/2], [w/2, h/2], [-w/2, h/2]];
    const edges = [
      { v: [verts[0], verts[1]], dir: [0, -1] }, { v: [verts[1], verts[2]], dir: [1, 0] },
      { v: [verts[2], verts[3]], dir: [0, 1] }, { v: [verts[3], verts[0]], dir: [-1, 0] }
    ];
    let maxDot = -Infinity, openIdx = 0;
    for (let i = 0; i < 4; i++) {
      const dot = edges[i].dir[0] * dx + edges[i].dir[1] * dy;
      if (dot > maxDot) { maxDot = dot; openIdx = i; }
    }
    const opp = (openIdx + 2) % 4;
    const sE = edges[opp].v, eE = edges[openIdx].v;
    const lg = ctx.createLinearGradient(
      (sE[0][0] + sE[1][0]) / 2, (sE[0][1] + sE[1][1]) / 2,
      (eE[0][0] + eE[1][0]) / 2, (eE[0][1] + eE[1][1]) / 2
    );
    lg.addColorStop(0, solid);
    lg.addColorStop(0.9, transparent);
    lg.addColorStop(1, transparent);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(verts[0][0], verts[0][1]);
    ctx.lineTo(verts[1][0], verts[1][1]);
    ctx.lineTo(verts[2][0], verts[2][1]);
    ctx.lineTo(verts[3][0], verts[3][1]);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = lg;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
    // Outline ONLY on non-open edges - the open side stays open
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    for (let i = 0; i < 4; i++) {
      if (i !== openIdx) {
        ctx.beginPath();
        ctx.moveTo(edges[i].v[0][0], edges[i].v[0][1]);
        ctx.lineTo(edges[i].v[1][0], edges[i].v[1][1]);
        ctx.stroke();
      }
    }
  } else if (shape.type === 'triangle') {
    const hgt = S2 * Math.sqrt(3) / 2;
    const v = [[-S2/2, hgt/3], [S2/2, hgt/3], [0, -2*hgt/3]];
    let maxDot = -Infinity, openIdx = 0;
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const mx = (v[i][0] + v[j][0]) / 2, my = (v[i][1] + v[j][1]) / 2;
      if ((mx * dx + my * dy) > maxDot) { maxDot = mx * dx + my * dy; openIdx = i; }
    }
    const sv = v[(openIdx + 2) % 3];
    const eA = v[openIdx], eB = v[(openIdx + 1) % 3];
    const lg = ctx.createLinearGradient(sv[0], sv[1], (eA[0] + eB[0]) / 2, (eA[1] + eB[1]) / 2);
    lg.addColorStop(0, solid);
    lg.addColorStop(0.9, transparent);
    lg.addColorStop(1, transparent);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(v[0][0], v[0][1]);
    ctx.lineTo(v[1][0], v[1][1]);
    ctx.lineTo(v[2][0], v[2][1]);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = lg;
    ctx.fillRect(-S2, -S2, 2 * S2, 2 * S2);
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    for (let i = 0; i < 3; i++) {
      if (i !== openIdx) {
        const j = (i + 1) % 3;
        ctx.beginPath();
        ctx.moveTo(v[i][0], v[i][1]);
        ctx.lineTo(v[j][0], v[j][1]);
        ctx.stroke();
      }
    }
  } else if (shape.type === 'semiCircle') {
    // Gradient from peak (y=r) to base (y=0), arc stroke only - flat side open
    const r = S2 / 2;
    const lg = ctx.createLinearGradient(0, r, 0, 0);
    lg.addColorStop(0, solid);
    lg.addColorStop(0.9, transparent);
    lg.addColorStop(1, transparent);
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI);
    ctx.stroke();
  }

  ctx.restore();
  tex.update();

  const m = new BABYLON.StandardMaterial(`openMat_${index}`, babylonScene);
  m.diffuseTexture = tex;
  m.emissiveTexture = tex;
  m.useAlphaFromDiffuseTexture = true;
  m.disableLighting = true;
  m.specularColor = new BABYLON.Color3(0, 0, 0);
  m.backFaceCulling = true; // single-sided faces so front+back don't double the alpha
  m.alpha = BODY_ALPHA_3D; // multiplies the texture's own alpha - global 3D translucency, see BODY_ALPHA_3D

  // Z VOLUME: textured front + back faces separated by depth
  const depth = Math.max(0.8, s * 0.12);
  const front = BABYLON.MeshBuilder.CreatePlane(`open_${index}_f`, {
    size: s * PAD, sideOrientation: BABYLON.Mesh.FRONTSIDE
  }, babylonScene);
  front.position = new BABYLON.Vector3(meshX, meshY, meshZ - depth / 2);
  front.rotation.z = meshRotZ;
  front.material = m;
  if (tiltNode) front.parent = tiltNode;
  const back = BABYLON.MeshBuilder.CreatePlane(`open_${index}_b`, {
    size: s * PAD, sideOrientation: BABYLON.Mesh.BACKSIDE
  }, babylonScene);
  back.position = new BABYLON.Vector3(meshX, meshY, meshZ + depth / 2);
  back.rotation.z = meshRotZ;
  back.material = m;
  if (tiltNode) back.parent = tiltNode;

  // Side wall matching the shape silhouette, with alpha FADING along the same
  // gradient as the 2D fill (no solid boundary - the open edge stays open)
  let profile = null;
  if (shape.type === 'rect') {
    const w = s, h2 = s * 0.6;
    profile = [
      new BABYLON.Vector3(-w / 2, -h2 / 2, 0), new BABYLON.Vector3(w / 2, -h2 / 2, 0),
      new BABYLON.Vector3(w / 2, h2 / 2, 0), new BABYLON.Vector3(-w / 2, h2 / 2, 0)
    ];
  } else if (shape.type === 'triangle') {
    const hgt = s * Math.sqrt(3) / 2;
    profile = [
      new BABYLON.Vector3(-s / 2, -hgt / 3, 0), new BABYLON.Vector3(s / 2, -hgt / 3, 0),
      new BABYLON.Vector3(0, 2 * hgt / 3, 0)
    ];
  } else if (shape.type === 'semiCircle') {
    profile = arcPathLocal(s / 2, 0, Math.PI, 48); // bottom half, matches texture art
  }

  // OBJ EXPORT: the front/back planes are a full padded RECTANGLE with the
  // real silhouette only visible via texture alpha, which plain OBJ/MTL can't
  // carry - every "open" shape would export as a plain rectangle with a grey
  // fallback color. Tag the front plane with the true polygon footprint,
  // real depth (so it's an actual solid prism, not a flat 0-thickness face),
  // and a translucent flat color as a stand-in for the 2D open-edge gradient
  // (OBJ/MTL has no per-pixel alpha); skip the back plane and fade-walls.
  if (profile) {
    const exportFillRGBA = saturate3D(p5ColToRGBA(shape.c)); // match the on-screen (saturation-compensated) color in the OBJ export
    front.metadata = {
      exportColor: { r: exportFillRGBA.r, g: exportFillRGBA.g, b: exportFillRGBA.b, a: 0.5 },
      exportPolygon: profile.map(p => ({ x: p.x, y: p.y })),
      exportDepth: depth
    };
  }
  back.metadata = { skipExport: true };

  if (profile) {
    profile.push(profile[0].clone()); // close the loop
    // Gradient direction in Babylon local coords. arcPathLocal's bulge sits at
    // NEGATIVE local y (down to -r at the arc's midpoint), flat diameter edge
    // at y=0 - so gy=+1 makes raw t=p.y smallest (minDot) at the bulge tip and
    // largest (maxDot, =0, the unique max since every curve point has y<0) at
    // the flat edge: solid at the bulge, fading to fully open at the flat
    // edge, exactly like the 2D gradient. (gy=-1 inverts this - solid at the
    // flat edge, fading at the bulge - which also breaks openEdgeIdx below:
    // it hunts for the edge closest to fully-open, so with the sign flipped
    // it grabs an arc segment near the bulge instead of the true flat edge,
    // leaving a gap mid-arc while still stroking straight across the real
    // open side.)
    const gx = shape.type === 'semiCircle' ? 0 : dx;
    const gy = shape.type === 'semiCircle' ? 1 : -dy;
    let minDot = Infinity, maxDot = -Infinity;
    profile.forEach(p => {
      const t = p.x * gx + p.y * gy;
      if (t < minDot) minDot = t;
      if (t > maxDot) maxDot = t;
    });
    const span = Math.max(maxDot - minDot, 1e-6);
    const fillRGBA = saturate3D(p5ColToRGBA(shape.c)); // fade walls match the texture's saturation-compensated color (alpha handled by alphaAt below)
    // Same falloff as the 2D gradient: solid at t=0, fully transparent at
    // t=0.9 - times the global 3D translucency, so the fade walls stay in
    // step with the front/back faces' own scaled texture alpha
    const alphaAt = (p) => {
      const t = ((p.x * gx + p.y * gy) - minDot) / span;
      return fillRGBA.a * 0.5 * BODY_ALPHA_3D * Math.max(0, 1 - t / 0.9);
    };
    // Subdivide edges so alpha fades smoothly ALONG each wall, reaching 100%
    // transparency at the open side. On large shapes these walls can face the
    // camera almost head-on from oblique angles, so a coarse subdivision
    // (each with one flat averaged alpha) shows as visible banded stripes -
    // subdivide finely enough that it reads as a smooth gradient instead.
    const SUB = Math.max(1, Math.ceil(120 / (profile.length - 1)));
    // Pulled slightly inside +/-depth/2 (instead of exactly matching it) so
    // this wall never shares a coplanar Z with the front/back faces - at
    // depth/2 exactly, z-fighting flickered over the outline baked into
    // the front face's texture, making it look interrupted/broken up
    const wz = depth / 2 * 0.96;
    let wallIdx = 0;
    for (let i = 0; i < profile.length - 1; i++) {
      const p1 = profile[i], p2 = profile[i + 1];
      for (let j = 0; j < SUB; j++) {
        const t1 = j / SUB, t2 = (j + 1) / SUB;
        const q1 = new BABYLON.Vector3(p1.x + (p2.x - p1.x) * t1, p1.y + (p2.y - p1.y) * t1, 0);
        const q2 = new BABYLON.Vector3(p1.x + (p2.x - p1.x) * t2, p1.y + (p2.y - p1.y) * t2, 0);
        const a = (alphaAt(q1) + alphaAt(q2)) / 2;
        if (a < 0.02) continue; // fully dissolved: the open side stays open
        const seg = BABYLON.MeshBuilder.CreateRibbon(`open_${index}_w${wallIdx}`, {
          pathArray: [
            [new BABYLON.Vector3(q1.x, q1.y, -wz), new BABYLON.Vector3(q2.x, q2.y, -wz)],
            [new BABYLON.Vector3(q1.x, q1.y, wz), new BABYLON.Vector3(q2.x, q2.y, wz)]
          ],
          sideOrientation: BABYLON.Mesh.DOUBLESIDE
        }, babylonScene);
        seg.position = new BABYLON.Vector3(meshX, meshY, meshZ);
        seg.rotation.z = meshRotZ;
        seg.material = unlitMat(`open_${index}_w${wallIdx}_mat`, {
          r: fillRGBA.r, g: fillRGBA.g, b: fillRGBA.b, a: a
        });
        seg.metadata = { skipExport: true }; // fade decoration only; front polygon covers export
        if (tiltNode) seg.parent = tiltNode;
        wallIdx++;
      }
    }

    const edgeSwr = Math.max((shape.sw || 2) / K3D_SCALE / 2, 0.16);
    // WRAP THE OUTLINE AROUND THE DEPTH like real 3D piping, not a flat line
    // stuck to the front face: trace the non-open perimeter with tubes at
    // BOTH the front and back, plus a connecting tube at each real corner,
    // so the boundary reads correctly wrapped all the way around from any
    // viewing angle - same treatment as every other (non-open) shape.
    const n = profile.length - 1; // profile is closed-loop (last point = dup of first)
    // Pick by raw (unclamped) t, not alphaAt's clamped alpha: on a many-
    // segment curve (the semiCircle arc), several edges near the base already
    // sit past the alpha=0 cutoff, so multiple edges clamp to an identical
    // 0 - the true flat/open edge plus a couple of curve segments right next
    // to it. Comparing clamped alpha with strict `<` then keeps whichever
    // zero-alpha edge is hit FIRST in the loop, which is usually one of
    // those curve segments, not the real open edge - leaving an invisible
    // gap in the curve while stroking straight across the actual open side.
    // Raw t keeps a unique max even when the clamped alpha ties at zero.
    let openEdgeIdx = 0, maxEdgeT = -Infinity;
    for (let i = 0; i < n; i++) {
      const p1 = profile[i], p2 = profile[i + 1];
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      const midT = (mx * gx + my * gy - minDot) / span;
      if (midT > maxEdgeT) { maxEdgeT = midT; openEdgeIdx = i; }
    }
    const outlinePath = [];
    for (let k = 1; k <= n; k++) outlinePath.push(profile[(openEdgeIdx + k) % n].clone());
    const frontPath = outlinePath.map(p => new BABYLON.Vector3(p.x, p.y, -wz));
    const backPath = outlinePath.map(p => new BABYLON.Vector3(p.x, p.y, wz));
    makeStrokeTube(`open_${index}_edgeFront`, frontPath, edgeSwr, K3D_BLACK, meshX, meshY, meshZ, meshRotZ, tiltNode);
    makeStrokeTube(`open_${index}_edgeBack`, backPath, edgeSwr, K3D_BLACK, meshX, meshY, meshZ, meshRotZ, tiltNode);
    // Z-AXIS EDGES: front/back loops only outline the perimeter as seen
    // face-on; without a tube connecting each corner's front point to its
    // back point, the depth walls between corners still show as bare,
    // unbordered seams when viewed from an oblique angle. Only at true
    // corners though - the semiCircle's curved edge is ~48 points, and a
    // radial tube at every one of those (crossed with the tangential
    // front/back loops) reads as a grid of little bordered cells instead of
    // a clean curved rim.
    const zEdgePts = shape.type === 'semiCircle'
      ? [outlinePath[0], outlinePath[outlinePath.length - 1]]
      : outlinePath;
    zEdgePts.forEach((p, k) => {
      makeStrokeTube(`open_${index}_edgeZ${k}`, [
        new BABYLON.Vector3(p.x, p.y, -wz),
        new BABYLON.Vector3(p.x, p.y, wz)
      ], edgeSwr, K3D_BLACK, meshX, meshY, meshZ, meshRotZ, tiltNode);
    });
  }
  return true;
}

// Tube along absolute 2D pixel coordinates (for lines/beziers/arcs/spirals).
// zTilt makes the tube TRAVEL through depth: it starts zTilt/2 behind its
// layer and ends zTilt/2 in front, instead of living on a flat plane
// anchorT: where along the path (0=first point, 1=last, 0.5=middle - the old
// default, unchanged for any caller that omits it) the Z ramp is centered -
// an anchored connector passes anchorT=0 or 1 so ITS anchor point lands
// exactly at layerZ's target depth while the other, unanchored end still
// drifts naturally via zTilt instead of the whole tube flattening to one Z.
// deltaPixel: rigid 2D translation (pixel space) applied to every point
// before projecting - how Tier-2 connectors get moved to touch a shape's
// surface without ever mutating the caller's stored point data.
// Piecewise-linear Z lookup across a sorted `{t, worldZ}` breakpoint list
// (t in [0,1] along the curve's own parametrization) - lets a single
// connector lean toward several different real depths along its length
// instead of just one linear ramp between two ends. Holds the nearest
// breakpoint's value outside the covered range rather than extrapolating
// (a curve's own untouched ends shouldn't go chasing a slope past the last
// real target).
function interpolateZTilt(breakpoints, t) {
  if (breakpoints.length === 1) return breakpoints[0].worldZ;
  if (t <= breakpoints[0].t) return breakpoints[0].worldZ;
  for (let i = 0; i < breakpoints.length - 1; i++) {
    const a = breakpoints[i], b = breakpoints[i + 1];
    if (t >= a.t && t <= b.t) {
      const frac = (t - a.t) / ((b.t - a.t) || 1e-6);
      return a.worldZ + (b.worldZ - a.worldZ) * frac;
    }
  }
  return breakpoints[breakpoints.length - 1].worldZ;
}

// `tValues` (optional): each point's ORIGINAL curve parameter in [0,1]. A
// caller that TRIMS its point list (see create3DArcLine's frame clipping)
// must pass this - otherwise the surviving points get re-parametrized
// across 0..1, which silently rescales the zTilt ramp (anchored at anchorT)
// and misaligns the arc-string breakpoints, both of which are keyed to the
// FULL curve's parametrization and were verified against it.
function lineTubeAbsolute(name, pts2D, w2D, col, layerZ, zTilt = 0, anchorT = 0.5, deltaPixel = null, tValues = null) {
  const dx0 = deltaPixel ? deltaPixel.dx : 0;
  const dy0 = deltaPixel ? deltaPixel.dy : 0;
  const n = Math.max(pts2D.length - 1, 1);
  // zTilt is normally a scalar (single lean toward one far-end target) - but
  // a long sweeping arc's computeConnectorAnchor can instead pass an ARRAY
  // of {t, worldZ} breakpoints (see computeArcStringTargets) to bend toward
  // several real shapes' depths along its own length, stringing them
  // together rather than just leaning at one end.
  const useBreakpoints = Array.isArray(zTilt);
  const path = pts2D.map((p, idx) => {
    const t = tValues ? tValues[idx] : idx / n;
    return new BABYLON.Vector3(
      (p.x + dx0 - window.innerWidth / 2) / K3D_SCALE,
      -(p.y + dy0 - window.innerHeight / 2) / K3D_SCALE,
      useBreakpoints ? interpolateZTilt(zTilt, t) : -layerZ + (t - anchorT) * zTilt
    );
  });
  // Match 2D strokeWeight exactly: tube diameter = w / SCALE
  const radius = Math.max((w2D || 2) / K3D_SCALE / 2, 0.1);
  const tube = BABYLON.MeshBuilder.CreateTube(name, {
    path: path,
    radius: radius,
    tessellation: 16, // was 8: visibly faceted/blocky on large or close-up curves
    cap: BABYLON.Mesh.CAP_ALL
  }, babylonScene);
  const rgba = p5ColToRGBA(col);
  if (isBlackWireColor(rgba)) {
    // Blackened metal, shared per alpha - see blackWireMaterial.
    tube.material = blackWireMaterial(rgba.a);
    blackWireMeshes.push({ mesh: tube, alpha: rgba.a });
  } else {
    tube.material = unlitMat(name + '_mat', rgba);
  }
  return tube;
}

function create3DLine(line, index, layerZ = 0, zTilt = 0, anchorT = 0.5, deltaPixel = null) {
  if (!line || !babylonScene) return false;
  // Report format: { points: [{x,y},{x,y}], color, strokeWeight } | live: x0/y0/x1/y1, col, w
  const p0 = line.points ? line.points[0] : { x: line.x0 || 0, y: line.y0 || 0 };
  const p1 = line.points ? line.points[1] : { x: line.x1 || 0, y: line.y1 || 0 };
  if (!p0 || !p1) return false;
  if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1) return false;
  // Subdivide the straight line so the Z tilt is smooth along its length
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    pts.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t });
  }
  lineTubeAbsolute(`line_${index}`, pts, line.strokeWeight || line.w || line.sw, line.color || line.col, layerZ, zTilt, anchorT, deltaPixel);
  return true;
}

function create3DBezier(bz, index, layerZ = 0, zTilt = 0, anchorT = 0.5, deltaPixel = null) {
  if (!bz || !babylonScene) return false;
  const cps = bz.points || bz.pts;
  if (!cps || cps.length < 4) return false;
  const [p0, p1, p2, p3] = cps;
  if ([p0, p1, p2, p3].some(p => !p || p.x === undefined || p.y === undefined)) return false;
  const pts = [];
  for (let i = 0; i <= 32; i++) {
    const t = i / 32, mt = 1 - t;
    pts.push({
      x: mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x,
      y: mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y
    });
  }
  lineTubeAbsolute(`bezier_${index}`, pts, bz.strokeWeight || bz.w, bz.color || bz.col, layerZ, zTilt, anchorT, deltaPixel);
  return true;
}

// How far past the 2D canvas edge a trimmed arc may still extend, as a
// fraction of the viewport's smaller dimension - a little slack so the cut
// doesn't land exactly on the frame line (which would read as a hard
// rectangular boundary in 3D).
const ARC_FRAME_MARGIN = 0.1;
function create3DArcLine(a, index, layerZ = 0, zTilt = 0, anchorT = 0.5, deltaPixel = null) {
  if (!a || a.cx === undefined || !babylonScene) return false;
  const steps = 128; // finer than the old 64 so the frame trim below lands precisely
  const sweep = a.sweep || Math.PI;
  const pts = [], ts = [];
  for (let i = 0; i <= steps; i++) {
    const t = (a.start || 0) + sweep * (i / steps);
    pts.push({ x: a.cx + Math.cos(t) * a.r, y: a.cy + Math.sin(t) * a.r });
    ts.push(i / steps);
  }

  // TRIM TO THE 2D FRAME: the 2D sketch builds these with a radius of
  // dist(anchor -> canvas center) * up to 1.44, centered ON the anchor, so a
  // large part of every arc's circle falls outside the canvas and is simply
  // clipped away by the 2D frame - you never see it. 3D has no frame, so the
  // full hoop rendered: giant sweeping arcs looping high above and far out
  // past the sculpture that "are not really part of the 2D version." Keep
  // only the stretch that the 2D actually shows. Trimming (not rescaling)
  // preserves the arc's true radius and curvature exactly as drawn - the
  // rule is never to reshape a connector, only to show the real visible part.
  const dx0 = deltaPixel ? deltaPixel.dx : 0;
  const dy0 = deltaPixel ? deltaPixel.dy : 0;
  const margin = Math.min(window.innerWidth, window.innerHeight) * ARC_FRAME_MARGIN;
  const visible = pts.map(p => {
    const x = p.x + dx0, y = p.y + dy0;
    return x >= -margin && x <= window.innerWidth + margin &&
           y >= -margin && y <= window.innerHeight + margin;
  });
  // Keep the contiguous visible run containing the ANCHOR (the point
  // genuinely fastened to a shape, so it must survive the trim); if the
  // anchor itself somehow sits off-frame, fall back to the longest visible
  // run, and if nothing is visible at all keep the arc whole rather than
  // dropping an element the composition contains.
  let lo = 0, hi = steps;
  const anchorIdx = Math.max(0, Math.min(steps, Math.round((anchorT || 0) * steps)));
  if (visible[anchorIdx]) {
    lo = hi = anchorIdx;
    while (lo > 0 && visible[lo - 1]) lo--;
    while (hi < steps && visible[hi + 1]) hi++;
  } else {
    let bestLo = -1, bestLen = 0, curLo = -1;
    for (let i = 0; i <= steps; i++) {
      if (visible[i]) {
        if (curLo < 0) curLo = i;
        if (i - curLo + 1 > bestLen) { bestLen = i - curLo + 1; bestLo = curLo; }
      } else curLo = -1;
    }
    if (bestLen >= 2) { lo = bestLo; hi = bestLo + bestLen - 1; }
  }
  const keptPts = pts.slice(lo, hi + 1);
  const keptTs = ts.slice(lo, hi + 1);
  const usePts = keptPts.length >= 2 ? keptPts : pts;
  const useTs = keptPts.length >= 2 ? keptTs : ts;

  lineTubeAbsolute(`arcline_${index}`, usePts, a.strokeWeight || a.w, a.color || a.col, layerZ, zTilt, anchorT, deltaPixel, useTs);
  return true;
}

function create3DSpiral(sp, index, layerZ = 0, zTilt = 0, anchorT = 0.5, deltaPixel = null) {
  if (!sp || !babylonScene) return false;
  let pts;
  if (sp.sv && sp.sv.length >= 2) {
    // Live SpiralAnim: precomputed offsets
    pts = sp.sv.map(p => ({ x: sp.x + p.x, y: sp.y + p.y }));
  } else if (sp.maxRadius) {
    // Report format: regenerate the spiral exactly like the 2D constructor
    const steps = sp.steps || 200;
    const coils = sp.coils || 3;
    pts = [];
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * Math.PI * 2 * coils;
      const radius = (i / steps) * sp.maxRadius;
      pts.push({ x: sp.x + Math.cos(angle) * radius, y: sp.y + Math.sin(angle) * radius });
    }
  } else {
    return false;
  }
  lineTubeAbsolute(`spiral_${index}`, pts, sp.strokeWeight || sp.w, sp.color || sp.col, layerZ, zTilt, anchorT, deltaPixel);
  return true;
}

// ===== Tier 2: pass-through elements, single touch-point attachment =====
// Finds this element's nearest Tier-1 tree member and computes how to
// reposition it (rigid translation only, no reshaping) so a REAL point on
// its own rendered geometry touches that member's surface. No overlap
// checking against anything - Tier 2 stays pass-through by design (arcs/
// lines/beziers/spirals/halo/concentricArc/squiggle may freely thread
// through/between shapes, per the user's original rule).
//
// Several of these types' own reference field is NOT a point on their
// rendered curve (verified against each type's actual point-generation
// math): a fixed-radius arc's center is always `r` units away from every
// rendered point, never on it; a squiggle's local origin sits off the
// curve too (its peak is offset, not centered). For those, the anchor is
// found by sampling the type's own point formula and picking whichever
// sample is most aligned (dot product) with the direction toward the
// target - reusing the exact formula each create3DX function already uses,
// so the anchor is guaranteed to be a real rendered point.
//
// The point on `target`'s surface facing `originWorld` - full 3D (x, y, AND
// z). Front/behind is decided as a real, binary fact - "if a skeletal
// element is in front of a body shape, it connects to the front face; if
// behind, the back face" - by comparing draw order directly against THIS
// target (salt > target.globalIndex means drawn later, i.e. in front, per
// synthesizedZBias's own front/back sign convention), the exact same
// pairwise comparison violatesOcclusionOrder already uses for shape-vs-shape
// pairs. Used to blend a soft synthesizedZBias magnitude into the direction
// vector instead of a clean sign - close enough for a rough lean, but for a
// shape whose in-plane offset from the target was large relative to that
// bias, the blended direction could end up shallow enough to land on a side
// edge instead of cleanly on the front or back cap. Z_DOMINANCE keeps the
// direction steep enough to hit the flat cap every time, while the in-plane
// component still picks WHERE on that face, biased toward the element's
// real approach angle.
const TOUCH_Z_DOMINANCE = 3;
function touchPointFacing(target, originWorld, salt) {
  // A LATTICE target always gets the BACK face, whatever the draw order
  // says. In the 2D sketch every lattice is composited into a foreground
  // layer drawn on top of everything, every frame - the same unconditional
  // fact violatesOcclusionOrder already enforces between Tier-1 shapes.
  // That check only runs inside buildElementTree though, so Tier-2 elements
  // (halo/squiggle/arc ornaments and every connector) never saw it: a halo
  // drawn later than a lattice would weld onto the lattice's FRONT face and
  // render on top of it, which the 2D can never show.
  const isFront = target.shapeType === 'lattice' ? false : salt > target.globalIndex;
  const dx = originWorld.x - target.x, dy = originWorld.y - target.y;
  const inPlaneLen = Math.hypot(dx, dy) || 1;
  const raw = {
    x: dx / inPlaneLen, y: dy / inPlaneLen,
    z: (isFront ? -1 : 1) * TOUCH_Z_DOMINANCE // smaller/more-negative world Z = front, per this app's established convention
  };
  const len = Math.hypot(raw.x, raw.y, raw.z);
  const dir = { x: raw.x / len, y: raw.y / len, z: raw.z / len };
  // target's REAL boundary in this direction, not its full scalar radius -
  // shapes no longer tilt at all (they keep their plain 2D rotation), but a
  // rect/triangle's true edge in an arbitrary direction still isn't its
  // full corner-to-corner radius, so this still has to be measured for real.
  const touchDist = supportDistanceWorld(target, target.contactDir, dir) + SOLID_CONTACT_PAD;
  // Must match tier1WorldCenter's sign exactly (node.z - node.zOffset) - this
  // used to be `+ target.zOffset`, invisible for every shape type except
  // concentricCircle/concentricArc (the only ones with a nonzero zOffset),
  // where it put the touch point roughly 2x zOffset away from the shape's
  // true center - enough to visibly disrupt front/back order for anything
  // anchored there (a halo, say) even from the exact matched viewpoint.
  const targetCenterZ = target.z - target.zOffset;
  return {
    x: target.x + dir.x * touchDist,
    y: target.y + dir.y * touchDist,
    z: targetCenterZ + dir.z * touchDist
  };
}

// The raw Z difference toward a genuine second target is otherwise
// unbounded, and now that Tier-1 shapes can end up meaningfully spread
// through depth (SPREAD_FACTOR, violatesOcclusionOrder), that difference
// can occasionally be large enough to visibly kink a connector's whole
// depth-bend far more than its own size would suggest - a sharp, "rearranged
// weird" looking V instead of a gentle lean. Clamps it to a fixed maximum
// so the lean stays a lean.
const MAX_REACH_ZTILT = 18;
function secondaryZTilt(secondary, originPoint, saltIndex, touchWorld) {
  if (!secondary) return null;
  // Only lean toward a secondary target that's genuinely CLOSE to this end -
  // findSecondaryTarget always returns whatever Tier-1 shape is NEAREST,
  // with no distance cutoff, so a connector's unanchored far end used to
  // lean toward that shape's Z however far away it actually was. That's
  // exactly what could drag one connector's loose end into coincidental
  // contact with a completely unrelated connector's own loose end -
  // "skeletal shapes should not attach to each other in a chain... that's
  // not how it is in 2D." A far-away "nearest" shape isn't a real
  // relationship worth leaning toward at all - stay flat (no lean) instead.
  const dist2D = Math.hypot(originPoint.x - secondary.origX, originPoint.y - secondary.origY);
  if (dist2D > secondary.r * 3) return null;
  const raw = touchPointFacing(secondary, originPoint, saltIndex).z - touchWorld.z;
  return Math.max(-MAX_REACH_ZTILT, Math.min(MAX_REACH_ZTILT, raw));
}

// Nearest Tier-1 member OTHER than `exclude` (and other than anything
// already `claimed` by an earlier connector's own free-end lean this pass -
// see claimedSecondaryTargets) - lets a connector's far end reach toward a
// genuinely different shape (full x/y/z), the same nearest-by-original-2D-
// distance preference used everywhere else.
function findSecondaryTarget(originWorld, exclude, tier1Placed, claimed) {
  let target = null, bestDist = Infinity;
  tier1Placed.forEach(t => {
    if (t === exclude) return;
    if (claimed && claimed.has(t)) return;
    const d = Math.hypot(originWorld.x - t.origX, originWorld.y - t.origY);
    if (d < bestDist) { bestDist = d; target = t; }
  });
  return target;
}

// A sweep at or beyond this counts as "long" for the arc-string treatment
// below - a short arc barely spans one shape's own width, nowhere near
// enough curve to genuinely thread through a sequence of others.
const LONG_ARC_SWEEP = Math.PI * 0.9;

// Samples several points along a long arc's own curve (besides its primary
// anchor) and, for each, finds a REAL Tier-1 shape (the base included -
// "possibly an anchor point to the base") that's genuinely close to the
// curve at that specific point - not just globally nearest, which would
// just re-pick the same shape or something irrelevant. Each shape can only
// be claimed once, so a string of DIFFERENT shapes results, not one shape
// hit repeatedly.
function computeArcStringTargets(raw, anchorT, primaryTarget, tier1Placed) {
  const sweep = raw.sweep || Math.PI;
  const SAMPLE_COUNT = 6;
  const claimed = new Set([primaryTarget]);
  const points = [];
  for (let i = 1; i <= SAMPLE_COUNT; i++) {
    const t = i / (SAMPLE_COUNT + 1);
    if (Math.abs(t - anchorT) < 0.06) continue; // too close to the primary anchor to be a distinct point
    const angle = (raw.start || 0) + sweep * t;
    const sampleWorld = pixelToWorld(raw.cx + Math.cos(angle) * raw.r, raw.cy + Math.sin(angle) * raw.r);
    let best = null, bestDist = Infinity;
    tier1Placed.forEach(cand => {
      if (claimed.has(cand)) return;
      const d = Math.hypot(sampleWorld.x - cand.origX, sampleWorld.y - cand.origY);
      if (d < cand.r * 1.4 && d < bestDist) { bestDist = d; best = cand; }
    });
    if (best) { claimed.add(best); points.push({ t, node: best }); }
  }
  return points;
}

// `kind`: 'line'|'bezier'|'arcline'|'spiral' (connectors, PIXEL-space,
// rendered via lineTubeAbsolute) or 'squiggle'|'halo'|'concentricArc'|
// 'arcShape' (ornaments, WORLD-space, rendered via create3DShape/
// createConcentricArc3D). `raw`: the connector's report object for the
// first group, or the shape object itself for the second. Returns one of:
// - {mode:'delta', deltaPixel:{dx,dy}, targetWorldZ, anchorT, zTilt} - add
//   deltaPixel to every 2D field the type stores, pass anchorT/targetWorldZ
//   (as -layerZ) through to the matching create3DX; zTilt is a real second-
//   target Z traversal when available (null falls back to a small
//   deterministic wiggle, see convertShapesTo3D). Every connector type
//   (line/bezier/arcline/spiral) uses this mode exclusively now - a
//   connector is NEVER truncated or resized to fit between two points, it
//   always keeps its full original length/shape and just slides (in x/y,
//   plus a Z position) so one real point along its own curve touches the
//   target's surface. anchorT can land anywhere in [0,1], not just at an
//   end - see the line/bezier/arcline cases below, which search the whole
//   curve for the nearest point, not just its two ends.
// - {mode:'resolved', resolvedXY, targetWorldZ} - pass resolvedXY straight
//   into create3DShape/createConcentricArc3D and -targetWorldZ as layerZ.
// Returns null if there's no Tier-1 member to attach to (e.g. every
// skeleton/solid ornament failed to convert - degenerate edge case).

// A connector keeps its full original shape/length (never truncated - see
// the delta-mode cases below), but that means the shift needed to anchor
// it onto a target could still push part of its UNCHANGED curve below the
// base - "the base... must be the lowest shape" applies to the whole
// structure, not just Tier-1 volumes. Nudges deltaPixel.dy upward (screen-
// up = world-Y-up) just enough that every one of `samplePixelPoints`
// clears the base's top face, if any would otherwise dip below it -
// returns deltaPixel completely untouched when nothing needs it.
function raiseDeltaAboveFloor(deltaPixel, samplePixelPoints, tier1Placed) {
  const base = tier1Placed.find(n => n.isBase);
  if (!base) return deltaPixel;
  // +1 world unit of clear air: the sample points are the tube's CENTERLINE
  // - the rendered tube has a real radius below that, so a centerline raised
  // to exactly the base's top still leaves the tube's lower half embedded
  // in the slab.
  const floorY = base.y + base.zHalf + 1;
  let worstBelow = 0;
  samplePixelPoints.forEach(p => {
    const wy = -((p.y + deltaPixel.dy) - window.innerHeight / 2) / K3D_SCALE;
    const below = floorY - wy;
    if (below > worstBelow) worstBelow = below;
  });
  if (worstBelow <= 0) return deltaPixel;
  return { dx: deltaPixel.dx, dy: deltaPixel.dy - worstBelow * K3D_SCALE };
}
function computeConnectorAnchor(kind, raw, globalIndex, tier1Placed, forcedTarget = null, claimedSecondary = null) {
  if (!tier1Placed || tier1Placed.length === 0) return null;

  let originWorld;
  switch (kind) {
    case 'line': {
      const p0 = raw.points ? raw.points[0] : { x: raw.x0 || 0, y: raw.y0 || 0 };
      const p1 = raw.points ? raw.points[1] : { x: raw.x1 || 0, y: raw.y1 || 0 };
      originWorld = pixelToWorld((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
      break;
    }
    case 'bezier': {
      const cps = raw.points || raw.pts;
      originWorld = pixelToWorld((cps[0].x + cps[3].x) / 2, (cps[0].y + cps[3].y) / 2);
      break;
    }
    case 'arcline':
      originWorld = pixelToWorld(raw.cx, raw.cy);
      break;
    case 'spiral':
      originWorld = pixelToWorld(raw.x, raw.y);
      break;
    case 'squiggle': case 'halo': case 'concentricArc': case 'arcShape':
      originWorld = projectXY3D(raw); // raw IS the shape object for these
      break;
    default:
      return null;
  }

  // Nearest Tier-1 member by ORIGINAL 2D distance - matches how Tier-1 nodes
  // pick their own neighbors, preserving a loose "who was near whom" from
  // the 2D collage even though absolute positions have since compacted.
  // `forcedTarget` overrides this search entirely - used to guarantee a
  // specific Tier-1 node (currently: a lattice with no natural nearest
  // connector) gets a real connector reaching it instead of being left
  // with only its Tier-1 kissing contact.
  let target = forcedTarget, bestDist = Infinity;
  if (!target) {
    tier1Placed.forEach(t => {
      const d = Math.hypot(originWorld.x - t.origX, originWorld.y - t.origY);
      if (d < bestDist) { bestDist = d; target = t; }
    });
  }
  if (!target) return null;

  const touchWorld = touchPointFacing(target, originWorld, globalIndex);

  // Backstop for the same 2D rule: even when a Tier-2 element anchors to
  // some OTHER shape, its resolved depth must never end up in front of a
  // lattice. Pushes only when it would otherwise render on top of one
  // (Math.max), so anything already behind is untouched.
  let latticeBackZ = -Infinity;
  tier1Placed.forEach(n => {
    if (n.shapeType !== 'lattice') return;
    latticeBackZ = Math.max(latticeBackZ, tier1WorldCenter(n).z + n.zHalf);
  });
  const behindLattices = wz => (latticeBackZ > -Infinity ? Math.max(wz, latticeBackZ + SOLID_CONTACT_PAD) : wz);
  // Push the touch point outward by the wire's own tube RADIUS: the anchor
  // point is the tube's CENTERLINE, and SOLID_CONTACT_PAD (0.15) alone is
  // thinner than many wires' radius, so a wire "touching" a face had its
  // tube surface physically sunk inside the shape ("this spiral is clearly
  // injecting itself into this semi circle"). Centerline one radius off the
  // surface = tube surface exactly kissing it.
  {
    const wireR = Math.max((raw.strokeWeight || raw.w || raw.sw || 2) / K3D_SCALE / 2, 0.1);
    const tcz = target.z - target.zOffset;
    const tdx = touchWorld.x - target.x, tdy = touchWorld.y - target.y, tdz = touchWorld.z - tcz;
    const tlen = Math.hypot(tdx, tdy, tdz) || 1;
    touchWorld.x += (tdx / tlen) * wireR;
    touchWorld.y += (tdy / tlen) * wireR;
    touchWorld.z += (tdz / tlen) * wireR;
  }

  // A connector's free end only ever gets a Z-lean toward a nearby Tier-1
  // shape, never a real touch - if a second, unrelated connector's free end
  // also leans toward that SAME shape while sharing a similar 2D origin
  // (a common "hub" both were drawn from), the two free ends can end up
  // sitting on top of each other, wires visibly touching EACH OTHER rather
  // than a real shape. Skip anything already claimed by an earlier
  // connector this pass (findSecondaryTarget), and claim whichever target
  // actually gets used here so the next connector reaching for the same
  // shape picks a different one instead (or no lean at all).
  const leanToSecondary = (leanOrigin, saltIndex) => {
    const secondary = findSecondaryTarget(leanOrigin, target, tier1Placed, claimedSecondary);
    const tilt = secondaryZTilt(secondary, leanOrigin, saltIndex, touchWorld);
    if (tilt != null && secondary && claimedSecondary) claimedSecondary.add(secondary);
    // NEVER return null: a null propagates out to realizeConnector, which
    // then substitutes its own unchecked fallback tilt - discarding whatever
    // clearWireZTilt just verified. Resolve the same fallback HERE instead,
    // so the clearance check operates on the value that actually renders.
    return tilt != null ? tilt : synthesizedZBias(globalIndex) * CONNECTOR_FREE_END_TILT;
  };

  switch (kind) {
    case 'line': case 'bezier': {
      // Never truncate or resize a line/bezier to fit between two points -
      // it keeps its full original length and shape exactly as drawn.
      // Instead, find whichever point ALONG ITS OWN CURVE (not just an
      // endpoint - the true nearest point on the segment/curve, which can
      // land anywhere in the middle) is closest to the target, and slide
      // the whole, unmodified curve so that one point touches the
      // target's surface. anchorT (0..1, where along the curve this
      // landed) feeds lineTubeAbsolute's Z-ramp, which is already built to
      // pivot around any point, not just an end.
      const targetPixel = worldToPixel(target.x, target.y);
      let anchorPixel, anchorT;
      const cps = raw.points || raw.pts;
      if (kind === 'line') {
        const p0 = raw.points ? raw.points[0] : { x: raw.x0 || 0, y: raw.y0 || 0 };
        const p1 = raw.points ? raw.points[1] : { x: raw.x1 || 0, y: raw.y1 || 0 };
        const ex = p1.x - p0.x, ey = p1.y - p0.y;
        const lenSq = ex * ex + ey * ey || 1;
        anchorT = Math.max(0, Math.min(1, ((targetPixel.x - p0.x) * ex + (targetPixel.y - p0.y) * ey) / lenSq));
        anchorPixel = { x: p0.x + ex * anchorT, y: p0.y + ey * anchorT };
      } else {
        const steps = 32;
        let bestDist = Infinity;
        anchorT = 0; anchorPixel = { x: cps[0].x, y: cps[0].y };
        for (let i = 0; i <= steps; i++) {
          const t = i / steps, mt = 1 - t;
          const px = mt * mt * mt * cps[0].x + 3 * mt * mt * t * cps[1].x + 3 * mt * t * t * cps[2].x + t * t * t * cps[3].x;
          const py = mt * mt * mt * cps[0].y + 3 * mt * mt * t * cps[1].y + 3 * mt * t * t * cps[2].y + t * t * t * cps[3].y;
          const d = Math.hypot(px - targetPixel.x, py - targetPixel.y);
          if (d < bestDist) { bestDist = d; anchorT = t; anchorPixel = { x: px, y: py }; }
        }
      }

      // The FAR end (whichever original endpoint the anchor point ISN'T
      // close to) still reaches toward a second target's Z when one
      // exists - real depth traversal, not an arbitrary wiggle - but this
      // only tilts the curve through depth, never touches its x/y shape
      // or length.
      const cps2 = kind === 'line'
        ? [raw.points ? raw.points[0] : { x: raw.x0 || 0, y: raw.y0 || 0 },
           raw.points ? raw.points[1] : { x: raw.x1 || 0, y: raw.y1 || 0 }]
        : [(raw.points || raw.pts)[0], (raw.points || raw.pts)[3]];
      const farEndPixel = anchorT < 0.5 ? cps2[1] : cps2[0];
      const farEndWorld = pixelToWorld(farEndPixel.x, farEndPixel.y);

      const touchPixel = worldToPixel(touchWorld.x, touchWorld.y);
      const rawPts = kind === 'line' ? cps2 : (raw.points || raw.pts); // bezier: all 4 control points bound the curve's convex hull, a safe conservative check
      const deltaPixel = raiseDeltaAboveFloor(
        { dx: touchPixel.x - anchorPixel.x, dy: touchPixel.y - anchorPixel.y }, rawPts, tier1Placed
      );
      let zTilt = leanToSecondary(farEndWorld, globalIndex + 1);
      // Both lines AND beziers are solid rigid wires - "solid objects can't
      // pass through each other" - so both get the shared depth-clearance
      // search (clearWireZTilt). This used to be a bezier-only block, which
      // left plain lines (the thickest strokes in the piece) spearing
      // straight through shapes' volumes.
      const wireSamplePts = [];
      for (let i = 0; i <= 32; i++) {
        const t = i / 32;
        if (kind === 'line') {
          wireSamplePts.push({ x: cps2[0].x + (cps2[1].x - cps2[0].x) * t, y: cps2[0].y + (cps2[1].y - cps2[0].y) * t });
        } else {
          const mt = 1 - t;
          wireSamplePts.push({
            x: mt * mt * mt * cps[0].x + 3 * mt * mt * t * cps[1].x + 3 * mt * t * t * cps[2].x + t * t * t * cps[3].x,
            y: mt * mt * mt * cps[0].y + 3 * mt * mt * t * cps[1].y + 3 * mt * t * t * cps[2].y + t * t * t * cps[3].y
          });
        }
      }
      zTilt = clearWireZTilt(wireSamplePts, deltaPixel, touchWorld.z, anchorT, zTilt, tier1Placed, target);
      return {
        mode: 'delta',
        deltaPixel,
        targetWorldZ: touchWorld.z,
        anchorT,
        zTilt,
        primaryAnchorWorld: touchWorld,
        targetNode: target
      };
    }
    case 'spiral': {
      const touchPixel = worldToPixel(touchWorld.x, touchWorld.y);
      // Sample the spiral's own rendered points (same formulas create3DSpiral
      // uses, live sv or regenerated) - used for the anchor search and the
      // floor/clearance checks below.
      let spiralPts;
      if (raw.sv && raw.sv.length >= 2) {
        spiralPts = raw.sv.map(p => ({ x: raw.x + p.x, y: raw.y + p.y }));
      } else {
        const steps = raw.steps || 200, coils = raw.coils || 3;
        spiralPts = [];
        for (let i = 0; i <= steps; i++) {
          const angle = (i / steps) * Math.PI * 2 * coils;
          const radius = (i / steps) * (raw.maxRadius || 0);
          spiralPts.push({ x: raw.x + Math.cos(angle) * radius, y: raw.y + Math.sin(angle) * radius });
        }
      }
      // Anchor at whichever point ALONG ITS OWN CURVE is nearest the target -
      // the same treatment line/bezier/arcline get. The old center-point
      // anchor ("radius 0 at i=0 is on-curve") was convenient but wrong for
      // placement: the anchor slide moves the anchor point onto the target's
      // SURFACE, so anchoring by the center teleported the whole spiral from
      // wherever the 2D actually drew it. Nearest-point anchoring keeps the
      // slide minimal - the spiral stays essentially at its 2D spot.
      const targetPixel = worldToPixel(target.x, target.y);
      let anchorIdx = 0, bestAnchorDist = Infinity;
      spiralPts.forEach((p, i) => {
        const d = Math.hypot(p.x - targetPixel.x, p.y - targetPixel.y);
        if (d < bestAnchorDist) { bestAnchorDist = d; anchorIdx = i; }
      });
      const anchorPixel = spiralPts[anchorIdx];
      const anchorT = anchorIdx / (spiralPts.length - 1 || 1);
      // "The base must be the lowest shape" applies to every connector -
      // line/bezier/arcline already route through raiseDeltaAboveFloor; the
      // spiral was the one connector type that skipped it, so its coils
      // could dip below the base's top when anchored low on a target.
      const deltaPixel = raiseDeltaAboveFloor(
        { dx: touchPixel.x - anchorPixel.x, dy: touchPixel.y - anchorPixel.y }, spiralPts, tier1Placed
      );
      // The far end (center or outer tip, whichever the anchor ISN'T near)
      // still reaches toward a second target's Z when one exists.
      const farEndPixel = anchorT < 0.5 ? spiralPts[spiralPts.length - 1] : spiralPts[0];
      const farEndWorld = pixelToWorld(farEndPixel.x, farEndPixel.y);
      // A spiral wire is solid too - same depth-clearance as line/bezier/arc.
      let zTilt = leanToSecondary(farEndWorld, globalIndex + 1);
      zTilt = clearWireZTilt(spiralPts, deltaPixel, touchWorld.z, anchorT, zTilt, tier1Placed, target);
      return {
        mode: 'delta',
        deltaPixel,
        targetWorldZ: touchWorld.z,
        anchorT,
        zTilt,
        primaryAnchorWorld: touchWorld,
        targetNode: target
      };
    }
    case 'arcline': {
      // Never truncate or resize an arc to fit between two points - it
      // keeps its full original sweep and radius exactly as drawn.
      // Find whichever point ALONG ITS OWN CURVE is nearest the target
      // (sampled the same way create3DArcLine builds it - the center is
      // never on the curve, so it can't be used directly) and slide the
      // whole, unmodified arc so that point touches the target's surface.
      const steps = 64;
      const sweep = raw.sweep || Math.PI;
      const targetPixel = worldToPixel(target.x, target.y);
      let bestIdx = 0, bestDist = Infinity;
      for (let i = 0; i <= steps; i++) {
        const t = (raw.start || 0) + sweep * (i / steps);
        const ox = raw.cx + Math.cos(t) * raw.r, oy = raw.cy + Math.sin(t) * raw.r;
        const d = Math.hypot(ox - targetPixel.x, oy - targetPixel.y);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      const tBest = (raw.start || 0) + sweep * (bestIdx / steps);
      const anchorPixel = { x: raw.cx + Math.cos(tBest) * raw.r, y: raw.cy + Math.sin(tBest) * raw.r };
      const anchorT = bestIdx / steps;

      // The FAR end of the arc (whichever curve endpoint the anchor point
      // ISN'T close to) still reaches toward a second target's Z when one
      // exists - real depth traversal, never touching the arc's own x/y
      // shape or sweep.
      const startPixel = { x: raw.cx + Math.cos(raw.start || 0) * raw.r, y: raw.cy + Math.sin(raw.start || 0) * raw.r };
      const endPixel = { x: raw.cx + Math.cos((raw.start || 0) + sweep) * raw.r, y: raw.cy + Math.sin((raw.start || 0) + sweep) * raw.r };
      const farEndPixel = anchorT < 0.5 ? endPixel : startPixel;
      const farEndWorld = pixelToWorld(farEndPixel.x, farEndPixel.y);

      const touchPixel = worldToPixel(touchWorld.x, touchWorld.y);
      // 33 samples, not the old 9: on a big arc (r runs to hundreds of px)
      // the true low point sags below the nearest of 9 samples by the chord
      // error - several world units - so the floor-raise stopped short and
      // the arc's belly passed through the base slab.
      const arcSamplePts = [];
      for (let i = 0; i <= 32; i++) {
        const t = (raw.start || 0) + sweep * (i / 32);
        arcSamplePts.push({ x: raw.cx + Math.cos(t) * raw.r, y: raw.cy + Math.sin(t) * raw.r });
      }
      const deltaPixel = raiseDeltaAboveFloor(
        { dx: touchPixel.x - anchorPixel.x, dy: touchPixel.y - anchorPixel.y }, arcSamplePts, tier1Placed
      );

      // A long, sweeping arc reads as connective tissue for the whole
      // sculpture, not just a single touch point - "use the long sweeping
      // arcs to connect a string of shapes together, adding stability and
      // possibly an anchor to the base." Sample several points along its
      // own curve (besides the primary anchor) and bend toward whichever
      // real Tier-1 shape (base included) sits genuinely close to the curve
      // at each one, stringing the arc through a whole sequence of shapes
      // instead of leaning at just one far end.
      // Try the string treatment for any long arc regardless of whether a
      // "secondary" (nearest-to-far-end) target was also found - secondary
      // almost always finds SOMETHING once there's more than one Tier-1
      // shape in the scene, so gating on its absence would make this rarely
      // fire at all. Only falls back to the plain single-lean behavior below
      // when the string search comes back genuinely empty (nothing close
      // enough to the curve at any sample point).
      const stringTargets = Math.abs(sweep) >= LONG_ARC_SWEEP
        ? computeArcStringTargets(raw, anchorT, target, tier1Placed)
        : [];
      let zTilt, stringAnchors, stringTargetNodes;
      if (stringTargets.length > 0) {
        // Clamp each breakpoint's pull the same way secondaryZTilt already
        // clamps a plain far-end lean (MAX_REACH_ZTILT) - without this, one
        // string target sitting at an extreme Z (nothing stops a shape
        // elsewhere in the piece from having been pushed far out) could yank
        // the WHOLE curve out to reach it, a real "fly-away arc" instead of
        // a gentle bend through a sequence of shapes.
        const breakpoints = [{ t: anchorT, worldZ: touchWorld.z }, ...stringTargets.map(s => {
          const rawDiff = tier1WorldCenter(s.node).z - touchWorld.z;
          const clamped = Math.max(-MAX_REACH_ZTILT, Math.min(MAX_REACH_ZTILT, rawDiff));
          return { t: s.t, worldZ: touchWorld.z + clamped };
        })].sort((a, b) => a.t - b.t);
        zTilt = breakpoints;
        stringAnchors = stringTargets.map(s => {
          const angle = (raw.start || 0) + sweep * s.t;
          const p = pixelToWorld(raw.cx + Math.cos(angle) * raw.r, raw.cy + Math.sin(angle) * raw.r);
          return { x: p.x + deltaPixel.dx / K3D_SCALE, y: p.y - deltaPixel.dy / K3D_SCALE, z: interpolateZTilt(breakpoints, s.t) };
        });
        stringTargetNodes = stringTargets.map(s => s.node);
        // These shapes are now genuinely, visibly threaded by this arc's own
        // curve - claim them so a separate, unrelated connector doesn't also
        // lean its own free end toward the same one and create the same
        // "wires touching each other" pile-up the claim set exists to avoid.
        if (claimedSecondary) stringTargetNodes.forEach(n => claimedSecondary.add(n));
      } else {
        zTilt = leanToSecondary(farEndWorld, globalIndex + 1);
        // An arc wire is solid too - same depth-clearance as line/bezier.
        // (String mode above is different: it deliberately bends to TOUCH a
        // sequence of shapes at their real surfaces, which is fastening, not
        // passing through.)
        const arcWirePts = [];
        for (let i = 0; i <= 32; i++) {
          const t = (raw.start || 0) + sweep * (i / 32);
          arcWirePts.push({ x: raw.cx + Math.cos(t) * raw.r, y: raw.cy + Math.sin(t) * raw.r });
        }
        zTilt = clearWireZTilt(arcWirePts, deltaPixel, touchWorld.z, anchorT, zTilt, tier1Placed, target);
      }
      return {
        mode: 'delta',
        deltaPixel,
        targetWorldZ: touchWorld.z,
        anchorT,
        zTilt,
        stringTargetNodes,
        primaryAnchorWorld: touchWorld,
        stringAnchors,
        targetNode: target
      };
    }
    case 'squiggle': {
      const sv = raw.sv;
      if (!sv || sv.length < 2) return null;
      const ends = [
        { x: raw.x + sv[0].x, y: raw.y + sv[0].y },
        { x: raw.x + sv[sv.length - 1].x, y: raw.y + sv[sv.length - 1].y }
      ];
      const targetPixel = worldToPixel(target.x, target.y);
      const d0 = Math.hypot(ends[0].x - targetPixel.x, ends[0].y - targetPixel.y);
      const d1 = Math.hypot(ends[1].x - targetPixel.x, ends[1].y - targetPixel.y);
      const anchorPixel = d1 < d0 ? ends[1] : ends[0];
      const anchorWorld = pixelToWorld(anchorPixel.x, anchorPixel.y);
      return {
        mode: 'resolved',
        resolvedXY: { x: originWorld.x + (touchWorld.x - anchorWorld.x), y: originWorld.y + (touchWorld.y - anchorWorld.y) },
        targetWorldZ: behindLattices(touchWorld.z),
        primaryAnchorWorld: touchWorld,
        targetNode: target
      };
    }
    case 'halo': {
      // Unlike squiggle/concentricArc/arcShape (anchored at an actual END
      // point on their own curve, so the REST of the shape naturally
      // extends away from the target), a halo has no "end" - it's a
      // radially symmetric glow, so its own CENTER is the only anchor it
      // has. Placing that center directly on the target's surface (the
      // touch point) buried roughly half the halo's radius inside the
      // target's volume - visually indistinguishable from a real overlap
      // even though nothing here is subject to the Tier-1 collision rule.
      // Push the halo's center further out, along the same direction its
      // touch point already faces, so its real SHELL's boundary lands on
      // the target's surface instead of its bare center. The shell
      // (createHalo3D's clear-resin container, sized to span/contain the
      // WHOLE ring stack - see haloRingSpan) is a real oriented profile -
      // wide in-plane (haloR) but thin straight through, NOT a uniform
      // sphere - pushing by a flat haloR in every direction used to
      // overshoot badly for any touch that's mostly in-depth (a barely-
      // thick shell doesn't need to travel a full radius to clear a target
      // sitting mostly behind/in front of it).
      const haloR = (raw.targetSize || 50) / K3D_SCALE / 2;
      const rings = raw.rings || 3;
      const shellMargin = Math.max(0.4, haloR * 0.06); // must match createHalo3D's own shell margin
      const shellHalf = (haloRingSpan(rings) + shellMargin * 2) / 2; // must match createHalo3D's own shell depth
      const targetCenterZ = target.z - target.zOffset; // must match tier1WorldCenter's sign - see touchPointFacing's own fix for why
      const dx = touchWorld.x - target.x, dy = touchWorld.y - target.y, dz = touchWorld.z - targetCenterZ;
      const len = Math.hypot(dx, dy, dz) || 1;
      const dir = { x: dx / len, y: dy / len, z: dz / len };
      const pushDist = profileSupportDistance({ kind: 'isotropic', R: haloR }, dir, shellHalf);
      let haloY = touchWorld.y + dir.y * pushDist;
      // Unlike every Tier-1 shape (violatesFloor, enforced during
      // placement), a halo's position is worked out here directly with no
      // floor check at all - if it happens to anchor near the bottom of its
      // target, pushing its center outward (the step above) can send it
      // further down than the target ever reached, dipping its rendered
      // disc below the base even though the target itself never violated
      // the floor ("the base must be the lowest shape" - this is exactly
      // the gap that let one through).
      const base = tier1Placed.find(n => n.isBase);
      if (base) {
        const floorY = base.y + base.zHalf;
        if (haloY - haloR < floorY) haloY = floorY + haloR;
      }
      return {
        mode: 'resolved',
        resolvedXY: { x: touchWorld.x + dir.x * pushDist, y: haloY },
        targetWorldZ: behindLattices(touchWorld.z + dir.z * pushDist),
        primaryAnchorWorld: touchWorld,
        targetNode: target
      };
    }
    case 'concentricArc': case 'arcShape': {
      // Sample the ring's own rendered points (same local formula
      // arcPathLocal/createConcentricArc3D use, rotated by rotZ) and pick
      // whichever is most aligned with the target direction - same
      // reasoning as 'arcline': the shape's origin is never on the ring.
      const rotZ = -(raw.rot || 0);
      const s = (raw.targetSize || 50) / K3D_SCALE;
      const r = kind === 'arcShape' ? s / 2 : (raw.rings || 4) * ((raw.diff || 10) / K3D_SCALE);
      const a0 = raw.arcStart || 0;
      const a1 = a0 + (raw.arcSweep || Math.PI);
      const cosZ = Math.cos(rotZ), sinZ = Math.sin(rotZ);
      const towardX = target.x - originWorld.x, towardY = target.y - originWorld.y;
      const steps = 48;
      let bestOffset = { x: 0, y: 0 }, bestDot = -Infinity;
      for (let i = 0; i <= steps; i++) {
        const t = a0 + (a1 - a0) * (i / steps);
        const lx = r * Math.cos(t), ly = -r * Math.sin(t); // arcPathLocal's y-flipped convention
        const wx = lx * cosZ - ly * sinZ, wy = lx * sinZ + ly * cosZ; // rotate by rotZ
        const dot = wx * towardX + wy * towardY;
        if (dot > bestDot) { bestDot = dot; bestOffset = { x: wx, y: wy }; }
      }
      return {
        mode: 'resolved',
        resolvedXY: { x: touchWorld.x - bestOffset.x, y: touchWorld.y - bestOffset.y },
        targetWorldZ: behindLattices(touchWorld.z),
        primaryAnchorWorld: touchWorld,
        targetNode: target
      };
    }
    default:
      return null;
  }
}

// Lattices are reclassified as rects for PLACEMENT purposes (real box
// profile/support-function - see tier1ShapeFields/computeShapeProfile3D and
// latticeVolumeRadius3D/latticeLocalGeometry) rather than the old plain-
// sphere stand-in. For RENDERING, each cell is its own solid, uniformly-
// colored extruded prism (real depth, not a texture decal only on the
// outer faces) - "colors must be consistent, and each cell's color should
// go from front to back of each cell." Every cell uses its own RAW pixel-
// space polygon directly (matching the proven pixel->Babylon-vertex
// convention every other per-point mesh in this file uses: divide by
// K3D_SCALE, negate Y) - simpler and safer than re-deriving a shared
// rotation, since each cell's own points already encode the lattice's true
// orientation exactly, whatever it is.
function create3DLattice(lattice, index, layerZ = 0, resolvedXY = null) {
  if (!lattice || !babylonScene) {
    console.warn('Cannot create lattice - missing lattice or scene');
    return false;
  }
  const cells = lattice.cells || [];
  if (cells.length === 0) {
    console.warn(`Lattice ${index} has no cells`);
    return false;
  }

  // resolvedXY (world units) comes from buildElementTree - lattices are now a
  // full Tier-1 tree participant, not read from lattice.x/y directly.
  const x = resolvedXY ? resolvedXY.x : (lattice.x - window.innerWidth / 2) / K3D_SCALE;
  const y = resolvedXY ? resolvedXY.y : -(lattice.y - window.innerHeight / 2) / K3D_SCALE;
  const z = -layerZ;

  // "The entire ensemble should be half as deep as a standard rect" - same
  // size basis (latticeLocalGeometry's rotated-frame bounding box) the
  // Tier-1 placement profile itself uses, so this always matches whatever
  // size buildElementTree actually reasoned about.
  const geo = latticeLocalGeometry(lattice);
  const s = geo ? Math.max(geo.w, geo.h) : 1;
  const depth = Math.max(0.8, s * 0.12) / 2;

  // Each cell is shrunk inward from its own centroid before being extruded -
  // a real gap between adjacent cells, not just a thin line drawn on top,
  // which is what actually fixes the original bug (two grid-adjacent cells'
  // side walls occupying the exact same position and z-fighting/shaking
  // while orbiting). The gap is then filled with a black CreateRibbon frame
  // below - see that comment for the (unrelated) reasons it was pulled and
  // restored once already.
  const CELL_SHRINK = 0.85; // 15% inset toward each cell's own centroid - real, visible gap width
  let built = 0;
  cells.forEach((cell, ci) => {
    const poly = cell.poly || cell.points;
    const col = cell.col || cell.color;
    if (!poly || poly.length < 4) return;

    const pts = poly.map(p => new BABYLON.Vector3(p.x / K3D_SCALE, -p.y / K3D_SCALE, 0));
    const centroid = pts.reduce((acc, p) => ({ x: acc.x + p.x / pts.length, y: acc.y + p.y / pts.length }), { x: 0, y: 0 });
    const shrunkPts = pts.map(p => new BABYLON.Vector3(
      centroid.x + (p.x - centroid.x) * CELL_SHRINK,
      centroid.y + (p.y - centroid.y) * CELL_SHRINK, 0
    ));
    // Was made fully opaque specifically to cut order-independent
    // transparency's per-pass GPU cost (depth peeling redraws every
    // translucent mesh once per pass) - that reasoning no longer applies
    // since OIT was reverted entirely (caused worse problems than it
    // solved). Restoring real translucency here for the 2D piece's own
    // layered, softly-blended look ("the beauty of the 2D representation") -
    // now the shared global body treatment instead of a lattice-only 0.85.
    const rgba = bodyColor3D(p5ColToRGBA(col));
    extrudePrism(`lattice_${index}_${ci}`, shrunkPts, depth, rgba, x, y, z);

    // Black ring frame filling the shrink gap - a CreateRibbon surface
    // stretched between the cell's full-size outer boundary and its shrunk
    // inner boundary, on both the front and back cap planes. Pulled once
    // before on suspicion of causing a page freeze - that freeze turned out
    // to be an unrelated bug (a semiCircle support-distance profile that
    // could return Infinity, since fixed/reverted separately) - and this was
    // last tested while order-independent transparency was still active,
    // which was independently breaking OTHER shapes' outlines too (reverted
    // since). Restoring it now that both of those are gone.
    const outerLoop = p => [...pts.map(v => new BABYLON.Vector3(v.x, v.y, p)), new BABYLON.Vector3(pts[0].x, pts[0].y, p)];
    const innerLoop = p => [...shrunkPts.map(v => new BABYLON.Vector3(v.x, v.y, p)), new BABYLON.Vector3(shrunkPts[0].x, shrunkPts[0].y, p)];
    const FRAME_Z_PAD = 0.02;
    [z - depth / 2 - FRAME_Z_PAD, z + depth / 2 + FRAME_Z_PAD].forEach((pz, side) => {
      const ribbon = BABYLON.MeshBuilder.CreateRibbon(`latticeFrame_${index}_${ci}_${side}`, {
        pathArray: [outerLoop(pz), innerLoop(pz)],
        sideOrientation: BABYLON.Mesh.DOUBLESIDE
      }, babylonScene);
      ribbon.position = new BABYLON.Vector3(x, y, 0);
      ribbon.material = unlitMat(`latticeFrame_${index}_${ci}_${side}_mat`, K3D_BLACK);
    });
    built++;
  });

  console.log(`✅ Lattice ${index}: rebuilt as ${built}/${cells.length} solid-colored cell prisms, depth=${depth.toFixed(2)}`);
  return built > 0;
}

// —————————————————————————————————————
// EXPORT 3D MODEL (.OBJ + .MTL) - for Rhino / other rendering software
// —————————————————————————————————————

window.isBabylonSceneReady = function () {
  return !!(babylonScene && babylonScene.meshes.some(m => !m.name.startsWith('skyFace_')));
};

// Best representative flat color for a mesh (checks the exact color tagged
// by unlitMat()/createOpenShape3D() first, then falls back to material
// properties/texture sampling for anything untagged)
function meshExportColor(mesh) {
  if (mesh.metadata && mesh.metadata.exportColor) {
    const ec = mesh.metadata.exportColor;
    return { c: new BABYLON.Color3(ec.r, ec.g, ec.b), a: ec.a !== undefined ? ec.a : 1 };
  }
  const mat = mesh.material;
  if (mat && mat.metadata && mat.metadata.exportColor) {
    const ec = mat.metadata.exportColor;
    return { c: new BABYLON.Color3(ec.r, ec.g, ec.b), a: ec.a !== undefined ? ec.a : 1 };
  }
  if (mat && mat.emissiveColor && (mat.emissiveColor.r + mat.emissiveColor.g + mat.emissiveColor.b) > 0.004) {
    return { c: mat.emissiveColor, a: mat.alpha !== undefined ? mat.alpha : 1 };
  }
  if (mat && mat.diffuseColor && (mat.diffuseColor.r + mat.diffuseColor.g + mat.diffuseColor.b) > 0.004) {
    return { c: mat.diffuseColor, a: mat.alpha !== undefined ? mat.alpha : 1 };
  }
  // Texture-only material (e.g. some open shapes): sample the average pixel
  // color of its DynamicTexture canvas as a flat stand-in color
  const tex = mat && (mat.emissiveTexture || mat.diffuseTexture);
  if (tex && typeof tex.getContext === 'function') {
    try {
      const ctx = tex.getContext();
      const w = ctx.canvas.width, h = ctx.canvas.height;
      const step = Math.max(1, Math.floor(Math.min(w, h) / 24)); // sparse sample, stays fast
      const data = ctx.getImageData(0, 0, w, h).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const i = (y * w + x) * 4;
          if (data[i + 3] < 8) continue; // skip transparent pixels
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
      }
      if (n > 0) {
        return { c: new BABYLON.Color3(r / n / 255, g / n / 255, b / n / 255), a: mat.alpha !== undefined ? mat.alpha : 1 };
      }
    } catch (e) { /* canvas may be tainted or empty - fall through to default */ }
  }
  return { c: new BABYLON.Color3(0.7, 0.7, 0.7), a: 1 };
}

// Minimal dependency-free ZIP writer (STORE method, i.e. uncompressed - the
// files are small text, so compression isn't worth the code). Needed because
// browsers silently block a page's second auto-triggered download in the
// same action: exporting .obj + .mtl separately meant the .mtl (color data)
// never actually landed on disk, so Rhino always saw flat grey.
function crc32(bytes) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buildZip(files) {
  // files: [{ name, data: Uint8Array }]
  const encoder = new TextEncoder();
  const localParts = [], centralParts = [];
  let offset = 0;

  files.forEach(f => {
    const nameBytes = encoder.encode(f.name);
    const data = f.data;
    const crc = crc32(data);
    const localHeader = new DataView(new ArrayBuffer(30));
    localHeader.setUint32(0, 0x04034b50, true);   // local file header signature
    localHeader.setUint16(4, 20, true);            // version needed
    localHeader.setUint16(6, 0, true);             // flags
    localHeader.setUint16(8, 0, true);             // method: 0 = store
    localHeader.setUint16(10, 0, true);            // mod time
    localHeader.setUint16(12, 0, true);            // mod date
    localHeader.setUint32(14, crc, true);
    localHeader.setUint32(18, data.length, true);  // compressed size
    localHeader.setUint32(22, data.length, true);  // uncompressed size
    localHeader.setUint16(26, nameBytes.length, true);
    localHeader.setUint16(28, 0, true);            // extra field length

    localParts.push(new Uint8Array(localHeader.buffer), nameBytes, data);

    const centralHeader = new DataView(new ArrayBuffer(46));
    centralHeader.setUint32(0, 0x02014b50, true);  // central directory signature
    centralHeader.setUint16(4, 20, true);
    centralHeader.setUint16(6, 20, true);
    centralHeader.setUint16(8, 0, true);
    centralHeader.setUint16(10, 0, true);
    centralHeader.setUint16(12, 0, true);
    centralHeader.setUint16(14, 0, true);
    centralHeader.setUint32(16, crc, true);
    centralHeader.setUint32(20, data.length, true);
    centralHeader.setUint32(24, data.length, true);
    centralHeader.setUint16(28, nameBytes.length, true);
    centralHeader.setUint16(30, 0, true);
    centralHeader.setUint16(32, 0, true);
    centralHeader.setUint16(34, 0, true);
    centralHeader.setUint16(36, 0, true);
    centralHeader.setUint32(38, 0, true);
    centralHeader.setUint32(42, offset, true);     // offset of local header

    centralParts.push(new Uint8Array(centralHeader.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
  });

  const centralStart = offset;
  let centralSize = 0;
  centralParts.forEach(p => centralSize += p.length);

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, centralStart, true);
  eocd.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, new Uint8Array(eocd.buffer)], { type: 'application/zip' });
}

// Builds a solid prism (top cap + bottom cap + side walls) from a flat 2D
// polygon (local XY, closed loop not required) extruded +/- depth/2 along Z.
// Used to give "open" shapes real volume in the OBJ export, matching how
// every other shape has actual depth rather than a flat 0-thickness face.
function polygonPrismGeometry(poly2D, depth) {
  const n = poly2D.length;
  const half = depth / 2;
  const positions = [];
  const indices = [];
  // Top cap (z = +half), bottom cap (z = -half): fan triangulated
  for (let i = 0; i < n; i++) positions.push(poly2D[i].x, poly2D[i].y, half);
  for (let i = 0; i < n; i++) positions.push(poly2D[i].x, poly2D[i].y, -half);
  for (let i = 1; i + 1 < n; i++) indices.push(0, i, i + 1);               // top cap
  for (let i = 1; i + 1 < n; i++) indices.push(n, n + i + 1, n + i);       // bottom cap (reversed)
  // Side walls: one quad (2 triangles) per polygon edge
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const t0 = i, t1 = j, b0 = n + i, b1 = n + j;
    indices.push(t0, t1, b1, t0, b1, b0);
  }
  return { positions, indices };
}

function downloadZip(filename, files) {
  const blob = buildZip(files);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Exports every artwork mesh (skybox excluded) as a single OBJ + companion
// MTL, one material per mesh so each shape keeps its flat 2D color in Rhino.
// Axes are remapped so the piece opens standing upright facing the viewer in
// Rhino's FRONT view, not lying flat in Top view: Babylon's Y (2D "up") becomes
// Rhino Z (up), and Babylon's Z (camera depth/layering) becomes Rhino Y (the
// axis Front view looks along). This remap has the same net handedness flip
// as a straight left-handed -> right-handed conversion, so the same triangle
// winding reversal below keeps faces/normals correct.
const EXPORT_OBJ_PASSWORD = '12345';

window.exportSceneToOBJ = function () {
  const entered = window.prompt('Enter password to export the 3D model:');
  if (entered === null) return; // cancelled
  if (entered !== EXPORT_OBJ_PASSWORD) {
    alert('Incorrect password.');
    return;
  }

  if (!babylonScene) {
    console.warn('No 3D scene to export yet - enter 3D mode first');
    return;
  }
  const meshes = babylonScene.meshes.filter(m =>
    !m.name.startsWith('skyFace_') && m.isEnabled() && m.getTotalVertices() > 0 &&
    !(m.metadata && m.metadata.skipExport)
  );
  if (meshes.length === 0) {
    console.warn('Nothing to export - no artwork meshes found');
    return;
  }

  // Unique, matching filenames every export - if the .obj always said
  // "mtllib scene.mtl" but you'd already downloaded one before, the browser
  // saves the new one as "scene (1).mtl" and the .obj silently points at a
  // file that no longer matches, so Rhino can't find it and every shape
  // falls back to flat grey. A timestamp keeps every pair self-consistent.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const objFilename = `kandinsky-3d-${stamp}.obj`;
  const mtlFilename = `kandinsky-3d-${stamp}.mtl`;

  const objLines = ['# Kandinsky 3D export', `mtllib ${mtlFilename}`, ''];
  const mtlLines = [];
  let vertexOffset = 0;
  const seenColors = new Map(); // dedupe identical colors into one material

  meshes.forEach((mesh, mi) => {
    mesh.computeWorldMatrix(true);
    const world = mesh.getWorldMatrix();

    // "Open" shapes (openRect/openTriangle/openSemiCircle) tag their front
    // plane with the true polygon footprint - plain OBJ/MTL can't carry the
    // texture-alpha silhouette, so use the real shape outline (extruded into
    // an actual solid prism, matching the real depth every other shape has)
    // instead of the full padded rectangle the plane mesh actually is
    let positions, indices;
    if (mesh.metadata && mesh.metadata.exportPolygon) {
      const built = polygonPrismGeometry(mesh.metadata.exportPolygon, mesh.metadata.exportDepth || 0);
      positions = built.positions;
      indices = built.indices;
    } else {
      positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
      indices = mesh.getIndices();
    }
    if (!positions || !indices || indices.length < 3) return;

    const { c, a } = meshExportColor(mesh);
    const colorKey = `${c.r.toFixed(3)}_${c.g.toFixed(3)}_${c.b.toFixed(3)}_${a.toFixed(2)}`;
    let matName = seenColors.get(colorKey);
    if (!matName) {
      matName = `mat_${seenColors.size}`;
      seenColors.set(colorKey, matName);
      mtlLines.push(
        `newmtl ${matName}`,
        `Kd ${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)}`,
        `Ka 0 0 0`,
        `Ks 0 0 0`,
        `d ${a.toFixed(3)}`,
        `illum 1`,
        ''
      );
    }

    // Both "o" (object) and "g" (group) tags: Rhino's OBJ import dialog can
    // optionally split objects into separate layers by object/group/material,
    // so each shape stays independently selectable/colorable either way
    const objName = `${mesh.name.replace(/\s+/g, '_')}_${mi}`;
    objLines.push(`o ${objName}`, `g ${objName}`, `usemtl ${matName}`);

    const vertCount = positions.length / 3;
    for (let i = 0; i < vertCount; i++) {
      const p = BABYLON.Vector3.TransformCoordinates(
        new BABYLON.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]),
        world
      );
      // Stand the piece up for Rhino's Front view: Rhino Y = Babylon Z (depth),
      // Rhino Z = Babylon Y (up)
      objLines.push(`v ${p.x.toFixed(5)} ${p.z.toFixed(5)} ${p.y.toFixed(5)}`);
    }

    for (let i = 0; i + 2 < indices.length; i += 3) {
      // Reverse winding to match the Z negation above (keeps faces/normals correct)
      const a1 = indices[i] + 1 + vertexOffset;
      const b1 = indices[i + 1] + 1 + vertexOffset;
      const c1 = indices[i + 2] + 1 + vertexOffset;
      objLines.push(`f ${a1} ${c1} ${b1}`);
    }

    vertexOffset += vertCount;
  });

  // ONE zip download (not two separate file downloads) - browsers silently
  // block a page's second auto-triggered download, which meant the .mtl
  // (all the color data) was never actually reaching disk before
  const encoder = new TextEncoder();
  downloadZip(`kandinsky-3d-${stamp}.zip`, [
    { name: objFilename, data: encoder.encode(objLines.join('\n') + '\n') },
    { name: mtlFilename, data: encoder.encode(mtlLines.join('\n') + '\n') }
  ]);
  console.log(`Exported ${meshes.length} meshes to kandinsky-3d-${stamp}.zip (unzip, then import the .obj into Rhino)`);
};

console.log('✅ babylon3D.js loaded!');
