// Babylon.js 3D Mode Integration
// Converts P5.js 2D Kandinsky shapes to navigable 3D space

console.log('🎮 babylon3D.js loading...');

let babylonEngine = null;
let babylonScene = null;
let camera3D = null;
let is3DMode = false;

// ————— MOBILE TOUCH CONTROLS —————
const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const MOBILE_LOOK_SPEED = 0.0022; // radians per pixel, two-finger look
const MOBILE_MOVE_ACCEL = 0.025;  // thruster: accel/frame at full deflection
const MOBILE_MOVE_MAX = 0.6;      // top speed, units/frame
const MOBILE_MOVE_DAMPING = 0.985; // space drift decay after thruster cut
const JOYSTICK_RADIUS = 60;       // max knob travel in px
let joystick = null;

// Virtual joystick visual: low center screen, tilted back like a plane lying
// in 3D space (pushing the knob "up" visually recedes = flying forward).
// It only fades in while a finger is down; the touch itself can START
// ANYWHERE on the screen - the visual just mirrors it.
function createJoystick() {
  if (joystick) return;
  const base = document.createElement('div');
  base.id = 'joystick-base';
  Object.assign(base.style, {
    position: 'absolute', bottom: '60px', left: '50%',
    width: '130px', height: '130px', borderRadius: '50%',
    background: 'rgba(255,255,255,0.10)', border: '2px solid rgba(255,255,255,0.4)',
    zIndex: '200', pointerEvents: 'none',
    opacity: '0', transition: 'opacity 0.25s',
    transform: 'translateX(-50%) perspective(280px) rotateX(52deg)',
    transformOrigin: '50% 100%'
  });
  const knob = document.createElement('div');
  Object.assign(knob.style, {
    position: 'absolute', left: '50%', top: '50%',
    width: '52px', height: '52px', borderRadius: '50%',
    background: 'rgba(255,255,255,0.6)',
    boxShadow: '0 0 12px rgba(255,255,255,0.5)',
    transform: 'translate(-50%,-50%)'
  });
  base.appendChild(knob);
  document.body.appendChild(base);
  joystick = { base: base, knob: knob, dx: 0, dy: 0 };
}

function setJoystickVisible(visible) {
  if (!joystick) return;
  joystick.base.style.opacity = visible ? '1' : '0';
  if (!visible) {
    joystick.dx = 0;
    joystick.dy = 0;
    joystick.knob.style.transition = 'transform 0.15s ease-out'; // spring back
    joystick.knob.style.transform = 'translate(-50%,-50%)';
  } else {
    joystick.knob.style.transition = 'none';
  }
}

// Touch controls, anywhere on the screen:
//   ONE finger  = joystick move (origin is wherever the finger lands)
//   TWO fingers = look around (follows fingers directly, stops on release)
function setupTouchControls(canvas) {
  createJoystick();
  const touches = new Map();
  let stickOrigin = null;
  let lastCenter = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastCenter = null;
    if (touches.size === 1) {
      stickOrigin = { x: e.clientX, y: e.clientY };
      setJoystickVisible(true);
    } else {
      // Second finger down: switch from moving to looking
      stickOrigin = null;
      setJoystickVisible(false);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 1 && stickOrigin && joystick) {
      let dx = e.clientX - stickOrigin.x;
      let dy = e.clientY - stickOrigin.y;
      const d = Math.hypot(dx, dy);
      if (d > JOYSTICK_RADIUS) {
        dx *= JOYSTICK_RADIUS / d;
        dy *= JOYSTICK_RADIUS / d;
      }
      joystick.dx = dx / JOYSTICK_RADIUS;
      joystick.dy = dy / JOYSTICK_RADIUS;
      joystick.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    } else if (touches.size === 2 && camera3D) {
      const [a, b] = [...touches.values()];
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (lastCenter) {
        camera3D.rotation.y += (cx - lastCenter.x) * MOBILE_LOOK_SPEED;
        camera3D.rotation.x += (cy - lastCenter.y) * MOBILE_LOOK_SPEED;
      }
      lastCenter = { x: cx, y: cy };
    }
  });
  const end = (e) => {
    if (!touches.delete(e.pointerId)) return;
    lastCenter = null;
    stickOrigin = null;
    setJoystickVisible(false); // fade out when the finger lifts
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

function hideJoystick() {
  setJoystickVisible(false);
}

// Wait for everything to load
window.addEventListener('load', () => {
  setTimeout(initBabylon3D, 1000);
});

function initBabylon3D() {
  console.log('Initializing Babylon 3D system...');
  
  const toggleBtn = document.getElementById('mode-toggle-btn');
  const instructions = document.getElementById('instructions');
  
  if (!toggleBtn) {
    console.error('Mode toggle button not found');
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
  
  // Update button
  const toggleBtn = document.getElementById('mode-toggle-btn');
  toggleBtn.textContent = '2D';
  
  console.log('3D mode activated!');
}

function deactivate3DMode() {
  console.log('Deactivating 3D mode...');
  
  hideJoystick();
  
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
  
  // Update button
  const toggleBtn = document.getElementById('mode-toggle-btn');
  toggleBtn.textContent = '3D';
  
  console.log('Returned to 2D mode');
}

function createBabylonScene(canvas) {
  const scene = new BABYLON.Scene(babylonEngine);
  
  // Capture P5 canvas as background texture
  captureP5Background(scene);
  
  // Paper base wash color (identical to the texture borders, so any hairline
  // gap between skybox faces is invisible)
  scene.clearColor = new BABYLON.Color4(229 / 255, 214 / 255, 184 / 255, 1);
  
  // Camera - Match 2D view exactly
  // Position closer to shapes for proper framing
  camera3D = new BABYLON.UniversalCamera("camera", new BABYLON.Vector3(0, 0, -50), scene);
  camera3D.setTarget(new BABYLON.Vector3(0, 0, 0));
  camera3D.fov = 0.45; // Narrow FOV to avoid fisheye distortion
  camera3D.attachControl(canvas, true);
  
  // SPACE TRAVEL feel: slow drift with almost no friction. Low speed makes
  // the shapes feel monumental; high inertia keeps you gliding after keys
  // are released, like a thruster cutting out.
  camera3D.speed = 1.2;
  camera3D.inertia = 0.975; // near-frictionless glide (default 0.9)
  camera3D.angularSensibility = 2500; // look-around speed (lower = faster)
  camera3D.maxZ = 5000; // Far clip - keep shapes visible when flying far away
  camera3D.keysUp = [87]; // W
  camera3D.keysDown = [83]; // S
  camera3D.keysLeft = [65]; // A
  camera3D.keysRight = [68]; // D
  camera3D.keysUpward = [69]; // E
  camera3D.keysDownward = [81]; // Q
  
  // DRAG-TO-LOOK ONLY (desktop mouse): rotation stops the instant the button
  // is released. Kill only the leftover rotation inertia - the WASD movement
  // glide is untouched.
  const stopLook = () => {
    if (camera3D && camera3D.cameraRotation) {
      camera3D.cameraRotation.set(0, 0);
    }
  };
  canvas.addEventListener('pointerup', stopLook);
  canvas.addEventListener('pointercancel', stopLook);
  canvas.addEventListener('pointerleave', stopLook);
  
  if (IS_TOUCH) {
    // MOBILE: virtual joystick moves, TWO fingers look around. Disable
    // Babylon's built-in touch handling so one finger on the scene does
    // nothing (it would fight the joystick) and speeds are fully ours.
    camera3D.inputs.removeByType('FreeCameraTouchInput');
    const mouseInput = camera3D.inputs.attached.mouse;
    if (mouseInput) mouseInput.touchEnabled = false;
    setupTouchControls(canvas);
    // SPACE PHYSICS: the joystick fires thrusters (acceleration), and letting
    // go leaves you gliding with a slow frictionless decay - same space-drift
    // feel as the desktop WASD flight
    const velocity = new BABYLON.Vector3(0, 0, 0);
    scene.registerBeforeRender(() => {
      if (!camera3D || !is3DMode) return;
      if (joystick && (joystick.dx || joystick.dy)) {
        const forward = camera3D.getDirection(BABYLON.Vector3.Forward());
        const right = camera3D.getDirection(BABYLON.Vector3.Right());
        velocity.addInPlace(forward.scale(-joystick.dy * MOBILE_MOVE_ACCEL));
        velocity.addInPlace(right.scale(joystick.dx * MOBILE_MOVE_ACCEL));
        const speed = velocity.length();
        if (speed > MOBILE_MOVE_MAX) velocity.scaleInPlace(MOBILE_MOVE_MAX / speed);
      }
      velocity.scaleInPlace(MOBILE_MOVE_DAMPING); // thruster cut = slow drift
      if (velocity.lengthSquared() > 1e-8) {
        camera3D.position.addInPlace(velocity);
      }
    });
  }
  
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
    /^(shape_|line_|bezier_|arcline_|spiral_|lattice|open_|outline_|halo|concentric)/.test(m.name)
  );
  meshesToRemove.forEach(mesh => mesh.dispose());
  
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
  let drawOrder = 0; // Track drawing order for Z-depth
  let conversionStats = {
    skeletons: 0,
    ornaments: 0,
    lines: 0,
    lattices: 0,
    failed: []
  };
  
  // LAYERING: Each element gets progressively closer Z position
  // Kept subtle so the head-on view matches the flat 2D composition
  const LAYER_SPACING = 2;
  
  // Lines/beziers/arcs/spirals weave BETWEEN the shapes: scattered through the
  // depth band the SHAPES actually occupy (15% beyond either end), so they go
  // behind, between and in front - never stacked as a group in front
  const shapeDepth = Math.max((shapes.length + ornaments.length) * LAYER_SPACING, LAYER_SPACING);
  let lineSeq = 0;
  const lineDepth = () => {
    // Golden-ratio sequences: deterministic, evenly scattered
    const z = (((lineSeq * 0.618034) % 1) * 1.3 - 0.15) * shapeDepth;
    const tilt = (((lineSeq * 0.754878) % 1) - 0.5) * shapeDepth;
    lineSeq++;
    return { z, tilt };
  };
  
  // Convert skeleton shapes (drawn first, farthest back). These are always
  // the 2 large translucent "open" shapes - give them extra depth separation
  // beyond the normal per-layer spacing so they don't visually intersect
  // (overlapping semi-transparent surfaces sort inconsistently by view angle)
  const SKELETON_EXTRA_GAP = 10;
  shapes.forEach((shape, i) => {
    const success = create3DShape(shape, i, true, drawOrder * LAYER_SPACING + i * SKELETON_EXTRA_GAP);
    if (success) {
      totalConverted++;
      conversionStats.skeletons++;
      drawOrder++;
    } else {
      conversionStats.failed.push({type: 'skeleton', index: i, shapeType: shape?.type, style: shape?.style});
    }
  });
  
  // Convert ornament shapes (drawn after skeletons)
  ornaments.forEach((shape, i) => {
    const success = create3DShape(shape, i + shapes.length, false, drawOrder * LAYER_SPACING);
    if (success) {
      totalConverted++;
      conversionStats.ornaments++;
      drawOrder++;
    } else {
      conversionStats.failed.push({type: 'ornament', index: i, shapeType: shape?.type, style: shape?.style});
    }
  });
  
  // Convert lines (scattered through the whole depth range)
  lines.forEach((line, i) => {
    const d = lineDepth();
    const success = create3DLine(line, i, d.z, d.tilt);
    if (success) {
      totalConverted++;
      conversionStats.lines++;
      drawOrder++;
    } else {
      conversionStats.failed.push({type: 'line', index: i});
    }
  });
  
  // Convert beziers (curved lines)
  beziers.forEach((bz, i) => {
    const d = lineDepth();
    const success = create3DBezier(bz, i, d.z, d.tilt);
    if (success) {
      totalConverted++;
      conversionStats.lines++;
      drawOrder++;
    } else {
      conversionStats.failed.push({type: 'bezier', index: i});
    }
  });
  
  // Convert arc lines
  arcLines.forEach((a, i) => {
    const d = lineDepth();
    const success = create3DArcLine(a, i, d.z, d.tilt);
    if (success) {
      totalConverted++;
      conversionStats.lines++;
      drawOrder++;
    } else {
      conversionStats.failed.push({type: 'arcLine', index: i});
    }
  });
  
  // Convert spirals
  spirals.forEach((sp, i) => {
    const d = lineDepth();
    const success = create3DSpiral(sp, i, d.z, d.tilt);
    if (success) {
      totalConverted++;
      conversionStats.lines++;
      drawOrder++;
    } else {
      conversionStats.failed.push({type: 'spiral', index: i});
    }
  });
  
  // Convert lattices (drawn last, closest)
  lattices.forEach((lattice, i) => {
    const success = create3DLattice(lattice, i, drawOrder * LAYER_SPACING);
    if (success) {
      totalConverted++;
      conversionStats.lattices++;
      drawOrder++;
    } else {
      conversionStats.failed.push({type: 'lattice', index: i});
    }
  });
  
  console.log(`📏 Created ${drawOrder} layers with ${LAYER_SPACING} units spacing`);
  console.log(`📐 Total depth range: ${drawOrder * LAYER_SPACING} units`);
  
  // Frame camera so the initial 3D view matches the 2D canvas exactly:
  // distance chosen so the canvas height fills the vertical FOV (no fisheye)
  if (camera3D) {
    const fov = 0.45; // Natural lens
    const canvasH = window.innerHeight / K3D_SCALE;
    const dist = (canvasH / 2) / Math.tan(fov / 2);
    const midZ = -(drawOrder * LAYER_SPACING) / 2; // center of the layer stack
    camera3D.fov = fov;
    camera3D.position = new BABYLON.Vector3(0, 0, midZ - dist);
    camera3D.setTarget(new BABYLON.Vector3(0, 0, midZ));
    console.log(`📷 Camera: z=${(midZ - dist).toFixed(1)}, FOV=${fov} framing ${drawOrder} layers like 2D`);
  }
  
  console.log(`✅ Converted ${totalConverted} elements to 3D!`);
  console.log('📈 Conversion breakdown:', {
    skeletons: `${conversionStats.skeletons}/${shapes.length}`,
    ornaments: `${conversionStats.ornaments}/${ornaments.length}`,
    lines: `${conversionStats.lines}/${lines.length}`,
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
    console.log(`🎉 Successfully created ${totalConverted} 3D objects! Use WASD to fly around.`);
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

function p5ColToCSS(c, alphaOverride) {
  if (!c || !c.levels) {
    return `rgba(128,128,128,${alphaOverride !== undefined ? alphaOverride : 1})`;
  }
  const a = alphaOverride !== undefined ? alphaOverride : (c.levels[3] !== undefined ? c.levels[3] : 255) / 255;
  return `rgba(${c.levels[0]},${c.levels[1]},${c.levels[2]},${a})`;
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
function makeStrokeTube(name, localPts, radius, rgba, x, y, z, rotZ = 0) {
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
function addPrismOutline(prefix, loopPts, depth, swr, x, y, z, rotZ, edgeCorners = [], addBack = true) {
  const frontZ = -(depth / 2 + 0.1);
  const backZ = depth / 2 + 0.1;
  makeStrokeTube(`${prefix}_front`, loopPts, swr, K3D_BLACK, x, y, z + frontZ, rotZ);
  if (addBack) makeStrokeTube(`${prefix}_back`, loopPts, swr, K3D_BLACK, x, y, z + backZ, rotZ);
  edgeCorners.forEach((v, i) => {
    makeStrokeTube(`${prefix}_edgeZ${i}`, [
      new BABYLON.Vector3(v.x, v.y, frontZ),
      new BABYLON.Vector3(v.x, v.y, backZ)
    ], swr, K3D_BLACK, x, y, z, rotZ);
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
function extrudePrism(name, profileXY, depth, rgba, x, y, z, rotZ = 0) {
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
  return mesh;
}

function create3DShape(shape, index, isSkeleton, layerZ = 0) {
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
  const xPos = (shape.x - window.innerWidth / 2) / K3D_SCALE;
  const yPos = -(shape.y - window.innerHeight / 2) / K3D_SCALE;
  const rotZ = -(shape.rot || 0);                // P5 rotation -> Babylon (Y flipped)
  const fill = p5ColToRGBA(shape.c);

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
      disc.position = new BABYLON.Vector3(xPos, yPos, zPos);
      disc.material = unlitMat(`mat_${index}`, fill);
      addPrismOutline(`outline_${index}`, arcPathLocal(s / 2, 0, Math.PI * 2, 64), depth, swr, xPos, yPos, zPos, 0, [], false);
      return true;
    }

    // ---- rect (2D is s wide x 0.6s tall!) ----
    if (shape.type === 'rect') {
      if (shape.style === 'open') return createOpenShape3D(shape, index, xPos, yPos, zPos, s, rotZ);
      const w = s, h = s * 0.6;
      const box = BABYLON.MeshBuilder.CreateBox(`shape_${index}`, { width: w, height: h, depth: depth }, babylonScene);
      box.position = new BABYLON.Vector3(xPos, yPos, zPos);
      box.rotation.z = rotZ;
      box.material = unlitMat(`mat_${index}`, fill);
      const rp = [
        new BABYLON.Vector3(-w / 2, -h / 2, 0), new BABYLON.Vector3(w / 2, -h / 2, 0),
        new BABYLON.Vector3(w / 2, h / 2, 0), new BABYLON.Vector3(-w / 2, h / 2, 0),
        new BABYLON.Vector3(-w / 2, -h / 2, 0)
      ];
      addPrismOutline(`outline_${index}`, rp, depth, swr, xPos, yPos, zPos, rotZ, rp.slice(0, 4));
      return true;
    }

    // ---- triangle (apex UP like 2D, equilateral centered on centroid) ----
    if (shape.type === 'triangle') {
      if (shape.style === 'open') return createOpenShape3D(shape, index, xPos, yPos, zPos, s, rotZ);
      const h = s * Math.sqrt(3) / 2;
      // Triangular PRISM (real 3D volume) - exact same profile as the 2D triangle
      extrudePrism(`shape_${index}`, [
        new BABYLON.Vector3(-s / 2, -h / 3, 0),
        new BABYLON.Vector3(s / 2, -h / 3, 0),
        new BABYLON.Vector3(0, 2 * h / 3, 0)
      ], depth, fill, xPos, yPos, zPos, rotZ);
      const v = [
        new BABYLON.Vector3(-s / 2, -h / 3, 0),
        new BABYLON.Vector3(s / 2, -h / 3, 0),
        new BABYLON.Vector3(0, 2 * h / 3, 0),
        new BABYLON.Vector3(-s / 2, -h / 3, 0)
      ];
      addPrismOutline(`outline_${index}`, v, depth, swr, xPos, yPos, zPos, rotZ, v.slice(0, 3));
      return true;
    }

    // ---- semiCircle (2D arc(0,0,s,s,0,PI) = bottom half on screen) ----
    if (shape.type === 'semiCircle') {
      if (shape.style === 'open') return createOpenShape3D(shape, index, xPos, yPos, zPos, s, rotZ);
      // Half-disc WEDGE (real 3D volume) - profile matches the 2D bottom-half arc exactly
      extrudePrism(`shape_${index}`, arcPathLocal(s / 2, 0, Math.PI, 48), depth, fill, xPos, yPos, zPos, rotZ);
      // 2D stroke follows the curved edge only (the flat diameter edge stays unstroked)
      const semiArc = arcPathLocal(s / 2, 0, Math.PI, 48);
      addPrismOutline(`outline_${index}`, semiArc, depth, swr, xPos, yPos, zPos, rotZ,
        [semiArc[0], semiArc[semiArc.length - 1]], false);
      return true;
    }

    if (shape.type === 'concentricCircle') {
      return createConcentricCircle3D(shape, index, xPos, yPos, zPos);
    }
    if (shape.type === 'concentricArc') {
      return createConcentricArc3D(shape, index, xPos, yPos, zPos, swr, rotZ);
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
    const muted = { r: raw.r * 0.85, g: raw.g * 0.85, b: raw.b * 0.85, a: 0.8 };

    if (i === 0) {
      // Radial gradient: layered discs from solid core to transparent rim
      const layers = 8;
      for (let j = 0; j < layers; j++) {
        const t = j / (layers - 1);
        const rr = radius * (0.6 + 0.4 * t);
        const disc = BABYLON.MeshBuilder.CreateDisc(`halo_${index}_g${j}`, {
          radius: rr, tessellation: 64, sideOrientation: BABYLON.Mesh.DOUBLESIDE
        }, babylonScene);
        disc.position = new BABYLON.Vector3(x, y, z - front);
        disc.material = unlitMat(`haloMat_${index}_g${j}`, { r: muted.r, g: muted.g, b: muted.b, a: muted.a * (1 - t) * 0.5 });
        front += 0.03;
      }
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
  return true;
}

function createConcentricCircle3D(shape, index, x, y, z) {
  // 2D: noStroke! Drawn largest -> smallest, diameter = i * diff * 2
  const rings = shape.rings || 4;
  const diff3 = (shape.diff || 10) / K3D_SCALE;

  for (let i = rings; i > 0; i--) {
    const radius = i * diff3;
    if (radius <= 0) continue;
    // Thin solid cylinder per ring = real 3D volume
    const disc = BABYLON.MeshBuilder.CreateCylinder(`concentric_${index}_${i}`, {
      diameter: radius * 2, height: 0.5, tessellation: 64
    }, babylonScene);
    disc.rotation.x = Math.PI / 2;
    // Smaller rings drawn later in 2D = slightly in front here
    disc.position = new BABYLON.Vector3(x, y, z - (rings - i) * 0.6);
    const col = p5ColToRGBA(shape.concentricColors && shape.concentricColors[i - 1] ? shape.concentricColors[i - 1] : shape.c);
    disc.material = unlitMat(`concentricMat_${index}_${i}`, col);
  }
  return true;
}

function createConcentricArc3D(shape, index, x, y, z, swr, rotZ) {
  // 2D: noFill! STROKED arcs with concentric colors, diameter = i * diff * 2
  const rings = shape.rings || 4;
  const diff3 = (shape.diff || 10) / K3D_SCALE;
  const a0 = shape.arcStart || 0;
  const a1 = a0 + (shape.arcSweep || Math.PI);

  for (let i = rings; i > 0; i--) {
    const radius = i * diff3;
    if (radius <= 0) continue;
    const col = p5ColToRGBA(shape.concentricColors && shape.concentricColors[i - 1] ? shape.concentricColors[i - 1] : shape.c);
    makeStrokeTube(`concentricArc_${index}_${i}`, arcPathLocal(radius, a0, a1, 48), swr, col, x, y, z - (rings - i) * 0.05, rotZ);
  }
  return true;
}

// Open shapes: EXACT port of the 2D canvas code (linear gradient along
// gradientAngle, open edge stays open, outline only on closed edges).
// Rendered into a DynamicTexture on a plane = pixel-perfect 2D analog in 3D.
function createOpenShape3D(shape, index, x, y, z, s, rotZ) {
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

  const solid = p5ColToCSS(shape.c);
  const transparent = p5ColToCSS(shape.c, 0);
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

  // Z VOLUME: textured front + back faces separated by depth
  const depth = Math.max(0.8, s * 0.12);
  const front = BABYLON.MeshBuilder.CreatePlane(`open_${index}_f`, {
    size: s * PAD, sideOrientation: BABYLON.Mesh.FRONTSIDE
  }, babylonScene);
  front.position = new BABYLON.Vector3(x, y, z - depth / 2);
  front.rotation.z = rotZ;
  front.material = m;
  const back = BABYLON.MeshBuilder.CreatePlane(`open_${index}_b`, {
    size: s * PAD, sideOrientation: BABYLON.Mesh.BACKSIDE
  }, babylonScene);
  back.position = new BABYLON.Vector3(x, y, z + depth / 2);
  back.rotation.z = rotZ;
  back.material = m;

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
    const exportFillRGBA = p5ColToRGBA(shape.c);
    front.metadata = {
      exportColor: { r: exportFillRGBA.r, g: exportFillRGBA.g, b: exportFillRGBA.b, a: 0.5 },
      exportPolygon: profile.map(p => ({ x: p.x, y: p.y })),
      exportDepth: depth
    };
  }
  back.metadata = { skipExport: true };

  if (profile) {
    profile.push(profile[0].clone()); // close the loop
    // Gradient direction in Babylon local coords (canvas y is flipped).
    // 2D semiCircle gradient is fixed: solid at arc peak, fading to the flat edge
    const gx = shape.type === 'semiCircle' ? 0 : dx;
    const gy = shape.type === 'semiCircle' ? 1 : -dy;
    let minDot = Infinity, maxDot = -Infinity;
    profile.forEach(p => {
      const t = p.x * gx + p.y * gy;
      if (t < minDot) minDot = t;
      if (t > maxDot) maxDot = t;
    });
    const span = Math.max(maxDot - minDot, 1e-6);
    const fillRGBA = p5ColToRGBA(shape.c);
    // Same falloff as the 2D gradient: solid at t=0, fully transparent at t=0.9
    const alphaAt = (p) => {
      const t = ((p.x * gx + p.y * gy) - minDot) / span;
      return fillRGBA.a * 0.5 * Math.max(0, 1 - t / 0.9);
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
        seg.position = new BABYLON.Vector3(x, y, z);
        seg.rotation.z = rotZ;
        seg.material = unlitMat(`open_${index}_w${wallIdx}_mat`, {
          r: fillRGBA.r, g: fillRGBA.g, b: fillRGBA.b, a: a
        });
        seg.metadata = { skipExport: true }; // fade decoration only; front polygon covers export
        wallIdx++;
      }
    }

    // WRAP THE OUTLINE AROUND THE DEPTH: the black line was only baked into
    // the flat front/back textures, so at oblique angles the wall's bare
    // colored edge stuck out past it with no border. Trace the same
    // non-open perimeter with real 3D tubes at both the front and back
    // edges, so the boundary reads correctly wrapped around from any angle.
    const n = profile.length - 1; // profile is closed-loop (last point = dup of first)
    let openEdgeIdx = 0, minEdgeAlpha = Infinity;
    for (let i = 0; i < n; i++) {
      const p1 = profile[i], p2 = profile[i + 1];
      const midAlpha = alphaAt({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
      if (midAlpha < minEdgeAlpha) { minEdgeAlpha = midAlpha; openEdgeIdx = i; }
    }
    const outlinePath = [];
    for (let k = 1; k <= n; k++) outlinePath.push(profile[(openEdgeIdx + k) % n].clone());
    const edgeSwr = Math.max((shape.sw || 2) / K3D_SCALE / 2, 0.16);
    const frontPath = outlinePath.map(p => new BABYLON.Vector3(p.x, p.y, -wz));
    const backPath = outlinePath.map(p => new BABYLON.Vector3(p.x, p.y, wz));
    makeStrokeTube(`open_${index}_edgeFront`, frontPath, edgeSwr, K3D_BLACK, x, y, z, rotZ);
    makeStrokeTube(`open_${index}_edgeBack`, backPath, edgeSwr, K3D_BLACK, x, y, z, rotZ);
    // Z-AXIS EDGES: front/back loops only outline the perimeter as seen face-on;
    // without a tube connecting each corner's front point to its back point,
    // the depth walls between corners still show as bare, unbordered seams
    // when viewed from an oblique angle. Only at true corners though - the
    // semiCircle's curved edge is ~48 points, and a radial tube at every one
    // of those (crossed with the tangential front/back loops) reads as a
    // grid of little bordered cells instead of a clean curved rim.
    const zEdgePts = shape.type === 'semiCircle'
      ? [outlinePath[0], outlinePath[outlinePath.length - 1]]
      : outlinePath;
    zEdgePts.forEach((p, k) => {
      makeStrokeTube(`open_${index}_edgeZ${k}`, [
        new BABYLON.Vector3(p.x, p.y, -wz),
        new BABYLON.Vector3(p.x, p.y, wz)
      ], edgeSwr, K3D_BLACK, x, y, z, rotZ);
    });
  }
  return true;
}

function renderShapeToTexture(shape, pixelSize) {
  // Create offscreen P5 graphics to render this shape
  const pg = createGraphics(pixelSize, pixelSize);
  pg.colorMode(HSL, 360, 100, 100, 1);
  pg.clear();
  
  // Center the shape in the texture
  pg.push();
  pg.translate(pixelSize / 2, pixelSize / 2);
  pg.rotate(0); // Rotation handled by mesh
  
  // Draw the shape exactly as it appears in 2D
  const size = shape.targetSize || 50;
  
  // Fill - preserve the exact color AND alpha from 2D
  if (shape.c) {
    // Extract RGBA values including alpha
    const r = shape.c.levels ? shape.c.levels[0] : 128;
    const g = shape.c.levels ? shape.c.levels[1] : 128;
    const b = shape.c.levels ? shape.c.levels[2] : 128;
    const a = shape.c.levels ? shape.c.levels[3] : 255;
    
    // Use the exact alpha from the 2D shape (translucent watercolor effect)
    pg.fill(r, g, b, a);
  } else {
    pg.fill(128, 128, 128, 128); // Default translucent gray
  }
  
  // Stroke (black outline)
  pg.stroke(0);
  pg.strokeWeight(shape.sw || 2);
  
  // Draw based on type
  switch(shape.type) {
    case 'circle':
      pg.ellipse(0, 0, size);
      break;
    case 'rect':
      pg.rectMode(CENTER);
      pg.rect(0, 0, size, size);
      break;
    case 'triangle':
      pg.triangle(-size/2, size/2, size/2, size/2, 0, -size/2);
      break;
    case 'semiCircle':
      pg.arc(0, 0, size, size, 0, PI);
      break;
    default:
      pg.ellipse(0, 0, size);
  }
  
  pg.pop();
  
  // Convert P5 graphics to Babylon texture
  const canvas = pg.canvas;
  const texture = new BABYLON.DynamicTexture(`shapeTex_${shape.type}`, {
    width: pixelSize,
    height: pixelSize
  }, babylonScene, false);
  
  const ctx = texture.getContext();
  ctx.drawImage(canvas, 0, 0);
  texture.update();
  texture.hasAlpha = true;
  
  pg.remove(); // Clean up
  
  return texture;
}


// Tube along absolute 2D pixel coordinates (for lines/beziers/arcs/spirals).
// zTilt makes the tube TRAVEL through depth: it starts zTilt/2 behind its
// layer and ends zTilt/2 in front, instead of living on a flat plane
function lineTubeAbsolute(name, pts2D, w2D, col, layerZ, zTilt = 0) {
  const n = Math.max(pts2D.length - 1, 1);
  const path = pts2D.map((p, idx) => new BABYLON.Vector3(
    (p.x - window.innerWidth / 2) / K3D_SCALE,
    -(p.y - window.innerHeight / 2) / K3D_SCALE,
    -layerZ + (idx / n - 0.5) * zTilt
  ));
  // Match 2D strokeWeight exactly: tube diameter = w / SCALE
  const radius = Math.max((w2D || 2) / K3D_SCALE / 2, 0.1);
  const tube = BABYLON.MeshBuilder.CreateTube(name, {
    path: path,
    radius: radius,
    tessellation: 16, // was 8: visibly faceted/blocky on large or close-up curves
    cap: BABYLON.Mesh.CAP_ALL
  }, babylonScene);
  tube.material = unlitMat(name + '_mat', p5ColToRGBA(col));
  return tube;
}

function create3DLine(line, index, layerZ = 0, zTilt = 0) {
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
  lineTubeAbsolute(`line_${index}`, pts, line.strokeWeight || line.w || line.sw, line.color || line.col, layerZ, zTilt);
  return true;
}

function create3DBezier(bz, index, layerZ = 0, zTilt = 0) {
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
  lineTubeAbsolute(`bezier_${index}`, pts, bz.strokeWeight || bz.w, bz.color || bz.col, layerZ, zTilt);
  return true;
}

function create3DArcLine(a, index, layerZ = 0, zTilt = 0) {
  if (!a || a.cx === undefined || !babylonScene) return false;
  const pts = [];
  const steps = 64;
  const sweep = a.sweep || Math.PI;
  for (let i = 0; i <= steps; i++) {
    const t = (a.start || 0) + sweep * (i / steps);
    pts.push({ x: a.cx + Math.cos(t) * a.r, y: a.cy + Math.sin(t) * a.r });
  }
  lineTubeAbsolute(`arcline_${index}`, pts, a.strokeWeight || a.w, a.color || a.col, layerZ, zTilt);
  return true;
}

function create3DSpiral(sp, index, layerZ = 0, zTilt = 0) {
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
  lineTubeAbsolute(`spiral_${index}`, pts, sp.strokeWeight || sp.w, sp.color || sp.col, layerZ, zTilt);
  return true;
}

function create3DLattice(lattice, index, layerZ = 0) {
  if (!lattice || !babylonScene) {
    console.warn('Cannot create lattice - missing lattice or scene');
    return false;
  }

  // Live LatticeAnim: cells = [{ poly: [4 p5.Vectors], col: p5.Color }]
  const cells = lattice.cells || [];
  if (cells.length === 0) {
    console.warn(`Lattice ${index} has no cells`);
    return false;
  }

  const x = (lattice.x - window.innerWidth / 2) / K3D_SCALE;
  const y = -(lattice.y - window.innerHeight / 2) / K3D_SCALE;
  const z = -layerZ;

  // NOT FLAT: infer the plane's tilt from the cells' perspective
  // foreshortening. If cells shrink toward one side, that side is farther
  // away - fit the size gradients and convert them into a Z slope.
  const info = [];
  cells.forEach(cell => {
    const poly = cell.poly || cell.points;
    if (!poly || poly.length < 4) return;
    const xs = poly.map(p => p.x), ys = poly.map(p => p.y);
    info.push({
      cx: xs.reduce((a, b) => a + b, 0) / xs.length,
      cy: ys.reduce((a, b) => a + b, 0) / ys.length,
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys)
    });
  });
  const mean = a => a.reduce((s, v) => s + v, 0) / Math.max(a.length, 1);
  const fitSlope = (xs, ys) => {
    const mx = mean(xs), my = mean(ys);
    let num = 0, den = 0;
    xs.forEach((v, i) => { num += (v - mx) * (ys[i] - my); den += (v - mx) * (v - mx); });
    return den > 1e-6 ? num / den : 0;
  };
  const avgW = Math.max(mean(info.map(c => c.w)), 1e-6);
  const avgH = Math.max(mean(info.map(c => c.h)), 1e-6);
  const relWy = fitSlope(info.map(c => c.cy), info.map(c => c.w)) / avgW; // width change per y px
  const relHx = fitSlope(info.map(c => c.cx), info.map(c => c.h)) / avgH; // height change per x px
  // Perspective: relative size s ~ D/(D+depth) => d(depth)/d(axis) = -D * (ds/daxis)/s
  const Dpx = (window.innerHeight / 2) / Math.tan(0.45 / 2); // matches the 3D camera framing
  const clampTan = v => Math.max(-1.7, Math.min(1.7, v)); // cap tilt at ~60 degrees
  const sy = clampTan(-relWy * Dpx); // dz/dy in 2D px space (tilt about X axis)
  const sx = clampTan(-relHx * Dpx); // dz/dx (tilt about Y axis)

  let built = 0;
  cells.forEach((cell, ci) => {
    const poly = cell.poly || cell.points;
    const col = cell.col || cell.color;
    if (!poly || poly.length < 4) return;

    // Cell polygon (offsets from lattice center, Y flipped, Z from the
    // inferred plane tilt so the lattice leans through space like in 2D)
    const pts = poly.map(p => new BABYLON.Vector3(
      p.x / K3D_SCALE,
      -p.y / K3D_SCALE,
      (sx * p.x + sy * p.y) / K3D_SCALE
    ));

    // Quad fill via ribbon
    const ribbon = BABYLON.MeshBuilder.CreateRibbon(`lattice_${index}_${ci}`, {
      pathArray: [[pts[0], pts[1]], [pts[3], pts[2]]],
      sideOrientation: BABYLON.Mesh.DOUBLESIDE
    }, babylonScene);
    ribbon.position = new BABYLON.Vector3(x, y, z);
    // 10% more transparent than the 2D fill - lattices read as too solid/heavy in 3D
    const latticeRGBA = p5ColToRGBA(col);
    latticeRGBA.a *= 0.9;
    ribbon.material = unlitMat(`latticeMat_${index}_${ci}`, latticeRGBA);

    // Black outline (2D uses strokeWeight 1.5)
    makeStrokeTube(`latticeOutline_${index}_${ci}`,
      [...pts.map(p => p.clone()), pts[0].clone()],
      0.1, K3D_BLACK, x, y, z - 0.05);

    built++;
  });

  console.log(`✅ Lattice ${index}: built ${built}/${cells.length} cells`);
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

function downloadTextFile(filename, contents, mime) {
  const blob = new Blob([contents], { type: mime || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
