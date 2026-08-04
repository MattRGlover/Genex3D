// Kandinsky-Inspired Generative Art for Mobile
// sketchIOS2.0.js: Merges the generative engine from sketch.js with the watercolor background.

// —————————————————————————————————————
// CONFIGURATION & STATE
// —————————————————————————————————————
const N_ANCHORS = 300;
const TRIGGER_DIST = 50;
const ANCHOR_VIS_RADIUS = 0;

const LINE_STEPS = 900;
const ARC_STEPS = 540;
const BEZ_STEPS = 360;
const MAX_ELEMENTS = 50;
const SHAPE_SPEED_MIN = 0.000835; // ~20-second animation, slowed down by 2x
const SHAPE_SPEED_MAX = 0.002; // Slowed down by 2x

let shapeCounter = 0;
let totalElementsCreated = 0;
let currentElementCount = 0;
let latticesCompleted = 0;

let finalBgLayer;
let randomSeedValue;

let anchors = [];
let skeletons = [];
let ornaments = [];
let lineAnims = [];
let latticeAnims = [];

// Element type tracking for variety
let allShapeTypes = [];
let allLineTypes = ['line', 'bezier', 'arc', 'spiral'];
let createdShapeTypes = new Set();
let createdLineTypes = new Set();
let latticeSlots = [];
let thickLineSlots = [];
let lineCounter = 0;

let lastDragTime = 0;
let isLooping = true;
let sceneReport;
let bigBgLayer; // WORLD background strip (4 square skybox side faces, tileable)
let isShapeTurn;
let vanishingPoints = [];
let thickStrokeCount = 0;
let foregroundAnims = [];
let firstTwoShapeColors = [];
let compositionFinished = false;
let maxElementsReached = false; // New flag
let resetCycleTimestamp = 0; // 0 when inactive, timestamp when active
let resetHasOccurred = false;
let finalCompositionImage;
let fadeAlpha = 255; // Start with black screen
let completionTimestamp = 0;
let projectStartTime = 0; // Track when project starts
const FADE_DURATION_MS = 2000; // 2 seconds
const BLACKOUT_DELAY_MS = 5000; // 5 seconds

let palette;
let lineLayer, foregroundLayer, fadeLayer;
let BASE_UNIT;
let prevTouch = null; // For native touch handling

let baseHue;

// Global variable to store captured pixel bitmap
let capturedPixelBitmap = null;

// —————————————————————————————————————
// P5 SETUP
// —————————————————————————————————————
function setup() {
  baseHue = random(360);
  let w = windowWidth, h = windowHeight;
  BASE_UNIT = min(w, h);

  pixelDensity(min(window.devicePixelRatio, 2));
  let canvas = createCanvas(w, h);
  smooth();
  colorMode(HSL, 360, 100, 100, 1);


  vanishingPoints = [
    createVector(width / 2, -height * 0.5),
    createVector(width * 1.5, height / 2),
    createVector(-width * 0.5, height / 2),
  ];

  const d = pixelDensity();
  finalBgLayer = createGraphics(w, h); finalBgLayer.pixelDensity(d);
  lineLayer = createGraphics(w, h); lineLayer.pixelDensity(d);
  foregroundLayer = createGraphics(w, h); foregroundLayer.pixelDensity(d);
  fadeLayer = createGraphics(w, h); fadeLayer.pixelDensity(d);

  lineLayer.strokeCap(ROUND);
  foregroundLayer.strokeCap(ROUND);

  calculateBaseUnitAndAssets();
  
  // Initialize random seed before reset to ensure it's available for scene report
  randomSeedValue = int(random(1000000));
  randomSeed(randomSeedValue);
  
  reset();

  // Initialize project start time for initial fade-in
  projectStartTime = millis();

  // Purely local mode: no Firebase initialization
  generateWorldBackground();
  
  // Expose arrays and background layer globally for 3D mode integration
  window.skeletons = skeletons;
  window.ornaments = ornaments;
  window.lineAnims = lineAnims;
  window.bezierAnims = bezierAnims;
  window.arcAnims = arcAnims;
  window.spiralAnims = spiralAnims;
  window.latticeAnims = latticeAnims;
  window.finalBgLayer = finalBgLayer; // Cloud background only
  console.log('✅ Shape arrays and background layer exposed to window for 3D mode');
}

function calculateBaseUnitAndAssets() {
  BASE_UNIT = min(width, height);
  updateAnchorPositions();
}

function windowResized() {
  let w = windowWidth, h = windowHeight;
  resizeCanvas(w, h);

  const d = pixelDensity();
  finalBgLayer = createGraphics(w, h); finalBgLayer.pixelDensity(d);
  lineLayer = createGraphics(w, h); lineLayer.pixelDensity(d);
  foregroundLayer = createGraphics(w, h); foregroundLayer.pixelDensity(d);
  fadeLayer = createGraphics(w, h); fadeLayer.pixelDensity(d);
  lineLayer.strokeCap(ROUND);
  foregroundLayer.strokeCap(ROUND);

  calculateBaseUnitAndAssets();
  reset();

  randomSeed(randomSeedValue);
  generateWorldBackground();
}

// —————————————————————————————————————
// DRAW LOOP
// —————————————————————————————————————
function draw() {
  // --- UNIFIED DRAWING LOGIC ---
  currentElementCount = skeletons.length + ornaments.length + lineAnims.length + latticeAnims.length + foregroundAnims.length;
  image(finalBgLayer, 0, 0);
  image(lineLayer, 0, 0);

  noStroke();
  fill(0, 0, 0, 0.07);
  anchors.forEach(a => ellipse(a.x, a.y, ANCHOR_VIS_RADIUS));

  skeletons.forEach(s => s.display());
  ornaments.forEach(o => o.display());

  image(foregroundLayer, 0, 0);

  // Step through all animations unless the composition is finished and we are in the 10s pause
  if (!(compositionFinished && resetCycleTimestamp === 0)) {
    for (let i = lineAnims.length - 1; i >= 0; i--) {
      const anim = lineAnims[i];
      const targetLayer = anim.layer === 'foreground' ? foregroundLayer : lineLayer;
      if (!anim.step(targetLayer)) {
        lineAnims.splice(i, 1);
      }
    }
    for (let i = latticeAnims.length - 1; i >= 0; i--) {
      console.log(`Stepping lattice ${i} of ${latticeAnims.length}`);
      if (!latticeAnims[i].step(foregroundLayer)) {
        console.log(`Lattice ${i} completed and removed`);
        latticesCompleted++;
        latticeAnims.splice(i, 1);
      }
    }
    for (let i = foregroundAnims.length - 1; i >= 0; i--) {
      if (!foregroundAnims[i].step(foregroundLayer)) {
        foregroundAnims.splice(i, 1);
      }
    }
  }

  checkCompletion();

  // --- INITIAL FADE-IN LOGIC ---
  // Handle the initial fade-in from black when project first loads
  if (projectStartTime > 0 && resetCycleTimestamp === 0) {
    let elapsed = millis() - projectStartTime;
    if (elapsed < FADE_DURATION_MS) {
      // Initial fade-in from black to transparent
      fadeAlpha = map(elapsed, 0, FADE_DURATION_MS, 255, 0);
    } else {
      // Initial fade-in complete
      fadeAlpha = 0;
      projectStartTime = 0; // Mark initial fade as complete
    }
  }

  // --- FADE AND RESET LOGIC ---
  // NOTE: the composition no longer resets itself automatically once finished
  // (MAX_ELEMENTS reached) - it just stays on screen, complete, until the
  // user manually triggers a reset from the menu (see resetComposition()
  // below, which starts this same fade-out/blackout/fade-in cycle on demand).

  if (resetCycleTimestamp > 0) {
    let elapsed = millis() - resetCycleTimestamp;
    console.log(`[FADE DEBUG] Elapsed: ${elapsed}ms, fadeAlpha: ${fadeAlpha}, resetHasOccurred: ${resetHasOccurred}`);

    if (elapsed < FADE_DURATION_MS) {
      // 1. Fading out
      fadeAlpha = map(elapsed, 0, FADE_DURATION_MS, 0, 255);
      console.log(`[FADE DEBUG] Phase 1: Fading out - fadeAlpha: ${fadeAlpha}`);
    } else if (elapsed < FADE_DURATION_MS + BLACKOUT_DELAY_MS) {
      // 2. Blackout period - reset happens here while screen is black
      fadeAlpha = 255;
      console.log(`[FADE DEBUG] Phase 2: Blackout - resetHasOccurred: ${resetHasOccurred}`);

      if (!resetHasOccurred) {
        console.log(`[DEBUG] Before reset - skeletons: ${skeletons.length}, ornaments: ${ornaments.length}, totalElements: ${totalElementsCreated}`);
        reset();
        console.log(`[DEBUG] After reset - skeletons: ${skeletons.length}, ornaments: ${ornaments.length}, totalElements: ${totalElementsCreated}`);
        resetHasOccurred = true;
      }
    } else if (elapsed < FADE_DURATION_MS + BLACKOUT_DELAY_MS + FADE_DURATION_MS) {
      // 3. Fading in - reset already completed during blackout
      fadeAlpha = map(elapsed - (FADE_DURATION_MS + BLACKOUT_DELAY_MS), 0, FADE_DURATION_MS, 255, 0);
      console.log(`[FADE DEBUG] Phase 3: Fading in - fadeAlpha: ${fadeAlpha}`);
    } else {
      // 4. Cycle complete
      console.log(`[DEBUG] ✅ Fade cycle complete at ${millis()}`);
      resetCycleTimestamp = 0;
      fadeAlpha = 0;
      resetHasOccurred = false;
      fadeLayer.clear(); // Ensure the fade layer is clear for the next cycle
      console.log(`[DEBUG] Cycle reset complete - ready for new composition`);
    }

    // Draw the fade effect onto its dedicated layer
    fadeLayer.clear();
    fadeLayer.background(0, fadeAlpha);
  }

  // --- DEBUG INFO ---
  // Display element count for debugging
  push();
  fill(0, 0, 15, 0.7);
  noStroke();
  textSize(14);
  textAlign(LEFT, TOP);
  textFont('monospace');
  text(`Elements: ${totalElementsCreated}/${MAX_ELEMENTS}`, 10, 10);
  pop();

  // Render the fade layer on top of everything
  if (resetCycleTimestamp > 0) {
    image(fadeLayer, 0, 0);
  }

  // Draw debug info on top of everything
  drawDebugInfo();
}

// —————————————————————————————————————
// COMPLETION LOGIC
// —————————————————————————————————————
function checkCompletion() {
  if (compositionFinished) return;

  // First, check if we've hit the element limit and set the flag.
  if (!maxElementsReached && totalElementsCreated >= MAX_ELEMENTS) {
    maxElementsReached = true;
  }

  // Then, check if the flag is set AND all animations have completed.
  const allAnimationsDone = lineAnims.length === 0 && latticeAnims.length === 0 && foregroundAnims.length === 0;

  if (maxElementsReached && allAnimationsDone) {
    if (!compositionFinished) { // Set timestamp only once
      compositionFinished = true;
      completionTimestamp = millis();
    }
  }
}

// —————————————————————————————————————
// MOUSE & KEYBOARD
// —————————————————————————————————————
// Ignore mouse events that belong to the UI chrome (3D/fullscreen buttons,
// instructions panel) or that happen while 3D mode is active - otherwise
// clicking "3D" itself fires p5's global mousePressed and spawns a shape.
function isUiEvent(event) {
    if (typeof is3DMode !== 'undefined' && is3DMode) return true;
    return !!(event && event.target && event.target.closest &&
        event.target.closest('#controls, #instructions, #menu-dropdown'));
}

function mouseDragged(event) {
    if (isUiEvent(event)) return;
    handleDrag();
}
  
function mousePressed(event) {
    if (isUiEvent(event)) return;
    handleDrag();
}
  
function keyPressed() {
    // Screenshot removed - conflicts with WASD navigation in 3D mode
    // Use browser's built-in screenshot instead
}

function handleTouchMove(event) {
    event.preventDefault();
    if (!prevTouch || event.touches.length > 1) return;
    prevTouch.moved = true;
    const touch = event.touches[0];
    pmouseX = prevTouch.x;
    pmouseY = prevTouch.y;
    mouseX = touch.clientX;
    mouseY = touch.clientY;
    handleDrag();
    prevTouch.x = mouseX;
    prevTouch.y = mouseY;
}

function handleTouchEnd(event) {
    event.preventDefault();
    prevTouch = null;
}

// —————————————————————————————————————
// SPAWN ON DRAG (PRIMARY GENERATIVE LOGIC)
// —————————————————————————————————————
// —————————————————————————————————————
// SCENE REPORTING
// —————————————————————————————————————
function captureShapeReport(shape) {
  const report = {
    className: 'KandinskyShape', // Add className for gallery reproduction
    type: shape.type || 'shape',
    style: shape.style || 'normal',
    rawType: shape.rawType || null,
    x: shape.x || 0,
    y: shape.y || 0,
    targetSize: shape.targetSize || 50,
    c: shape.c ? shape.c.toString('#rrggbbaa') : '#000000ff',
    c2: shape.c2 ? shape.c2.toString('#rrggbbaa') : '#000000ff',
    rot: shape.rot || 0,
    sw: shape.sw || 2,
    anchorId: shape.anchorId || null,
    index: shape.index || 0,
    speed: shape.speed || 1,
    useAdditiveBlend: shape.useAdditiveBlend || false,
    gradientAngle: shape.gradientAngle || 0 // Ensure gradientAngle is always defined with default value
  };
  // Add type-specific properties
  if (shape.type === "concentricCircle") {
    report.rings = shape.rings;
    report.diff = shape.diff;
    report.concentricColors = shape.concentricColors.map(c => c.toString('#rrggbbaa'));
  } else if (shape.type === "concentricArc") {
    report.rings = shape.rings;
    report.diff = shape.diff;
    report.arcStart = shape.arcStart;
    report.arcSweep = shape.arcSweep;
    report.concentricColors = shape.concentricColors.map(c => c.toString('#rrggbbaa'));
  } else if (shape.style === "halo") {
    report.rings = shape.rings;
    report.haloColors = shape.haloColors.map(c => c.toString('#rrggbbaa'));
    report.haloGradientAngles = shape.haloGradientAngles;
  } else if (shape.style === "open") {
    report.gradientAngle = shape.gradientAngle;
  } else if (shape.type === "squiggle") {
    report.sv = shape.sv;
  }
  
  return report;
}

function captureLatticeReport(lattice, anchorId) {
  // Capture all individual cell colors for perfect reproduction
  const cellColors = lattice.cells.map(cell => {
    return cell.col ? cell.col.toString('#rrggbbaa') : '#000000ff';
  });
  
  // Flatten polygon data for Firebase compatibility (no nested arrays)
  const cellPolygonData = [];
  lattice.cells.forEach(cell => {
    cell.poly.forEach(point => {
      cellPolygonData.push({ x: point.x, y: point.y });
    });
  });
  
  return {
    type: 'lattice',
    x: lattice.x || 0,
    y: lattice.y || 0,
    anchorId: anchorId || null,
    angle1: lattice.angle1 || 0,
    angle2: lattice.angle2 || Math.PI/2,
    spacing: lattice.spacing || 20,
    N1: lattice.N1 || 3,
    N2: lattice.N2 || 3,
    fillAlpha: lattice.fillAlpha || 255,
    w: lattice.w || 100,
    h: lattice.h || 100,
    cols: lattice.cols || 3,
    rows: lattice.rows || 3,
    cellColors: cellColors,           // Individual cell colors
    cellPolygonData: cellPolygonData, // Flattened polygon points
    cellCount: lattice.cells.length   // Number of cells for reconstruction
  };
}

function captureLineReport(line, anchorId) {
    const report = {
        type: 'line',
        lineType: line.constructor.name,
        color: line.col ? line.col.toString('#rrggbbaa') : '#000000ff',
        strokeWeight: line.w || 2,
        anchorId: anchorId || null,
        steps: line.steps || null,
    };

    if (line instanceof LineAnim) {
        report.points = [{ x: line.x0, y: line.y0 }, { x: line.x1, y: line.y1 }];
    } else if (line instanceof BezierAnim) {
        report.points = line.pts.filter(p => p && p.x !== undefined && p.y !== undefined).map(p => ({ x: p.x, y: p.y }));
    } else if (line instanceof ArcAnim) {
        report.cx = line.cx || 0;
        report.cy = line.cy || 0;
        report.r = line.r || 50;
        report.start = line.start || 0;
        report.sweep = line.sweep || Math.PI;
    } else if (line instanceof SpiralAnim) {
        report.x = line.x || 0;
        report.y = line.y || 0;
        report.maxRadius = line.maxRadius || 50;
        report.coils = line.coils || 3;
    }
    return report;
}

function weightedRandom(options) {
  let total = 0;
  for (let i = 0; i < options.length; i++) {
    total += options[i].weight;
  }

  let rand = random(total);
  let currentTotal = 0;
  for (let i = 0; i < options.length; i++) {
    currentTotal += options[i].weight;
    if (rand < currentTotal) {
      return options[i].value;
    }
  }
}

function handleDrag() {
  console.log('handleDrag()');
  if (totalElementsCreated >= MAX_ELEMENTS) return false;

  let now = millis();
  if (now - lastDragTime < 300) return false;
  lastDragTime = now;

  let near = anchors.map(a => ({ a, d: dist(mouseX, mouseY, a.x, a.y) })).filter(o => o.d < TRIGGER_DIST);
  if (!near.length) return false;

  let A = near.sort((a, b) => a.d - b.d)[0].a;

  let elementCreated = false;
  
  // Check if this should be a lattice slot
  if (latticeSlots.includes(totalElementsCreated + 1)) {
    console.log('Turn: Lattice');
    elementCreated = createLatticeElement(A);
  } else if (totalElementsCreated < 2) {
    // The first two elements must be skeleton shapes.
    console.log('Turn: Skeleton Shape');
    elementCreated = createShapeElement(A);
  } else {
    // After skeletons, alternate with fallback logic.
    if (totalElementsCreated % 2 === 0) {
      console.log('Attempting to create Line...');
      elementCreated = createLineElement(A);
      if (!elementCreated) {
        console.log('Line creation failed, falling back to Shape.');
        elementCreated = createShapeElement(A); // Fallback
      }
    } else {
      console.log('Attempting to create Shape...');
      elementCreated = createShapeElement(A);
      if (!elementCreated) {
        console.log('Shape creation failed, falling back to Line.');
        elementCreated = createLineElement(A); // Fallback
      }
    }
  }

  if (elementCreated) {
    totalElementsCreated++; // Increment ONLY on success.
    console.log(`🎯 ELEMENT COUNT UPDATE: ${totalElementsCreated}/${MAX_ELEMENTS} total elements`);
    console.log(`📊 Current arrays: skeletons=${skeletons.length}, ornaments=${ornaments.length}, lineAnims=${lineAnims.length}, latticeAnims=${latticeAnims.length}`);
    
    // Check if we're close to completion
    if (totalElementsCreated >= MAX_ELEMENTS - 5) {
      console.log(`⚠️ APPROACHING COMPLETION: ${totalElementsCreated}/${MAX_ELEMENTS} elements`);
    }
  } else {
    console.log(`❌ Element creation failed at slot ${totalElementsCreated + 1}`);
  }

  return elementCreated; // Return true to indicate an element was created
}

function createLatticeElement(anchor) {
  console.log('  Type: Lattice');
  let angle1 = random(TWO_PI);
  let angle2 = angle1 + random(PI * 0.3, PI * 0.7);
  let maxDim;
  if (latticeSlots.length === 1) maxDim = 4;  // Reduced from 8
  else if (latticeSlots.length === 2) maxDim = 3;  // Reduced from 6
  else maxDim = 2;  // Reduced from 5

  // MOBILE: grid is (2N+1) cells across, so N<=2 caps it at 5x5 (closest
  // possible to a 6x6 ceiling), and cells are drawn smaller physically too.
  const isMobileDevice = (typeof IS_TOUCH !== 'undefined' && IS_TOUCH) ||
    (typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0));
  if (isMobileDevice) maxDim = Math.min(maxDim, 2);

  let N1 = floor(random(1, maxDim + 1));  // Start from 1 instead of 2
  let N2 = floor(random(max(1, N1 - 2), min(maxDim, N1 + 2) + 1));  // Smaller range

  const options = {
    angle1, angle2,
    spacing: isMobileDevice ? random(14, 24) : random(20, 40), // smaller cells on mobile
    N1, N2,
    fillAlpha: random(0.8, 1.0),
    anchorId: anchor.id,
  };
  const lattice = new LatticeAnim(anchor.x, anchor.y, options);
  console.log(`  Lattice created with ${lattice.cells.length} cells at (${anchor.x}, ${anchor.y})`);
  latticeAnims.push(lattice);
  console.log(`  Total latticeAnims: ${latticeAnims.length}`);
  sceneReport.lattices.push(captureLatticeReport(lattice, anchor.id));
  return true;
}

function createShapeElement(anchor) {
  shapeCounter++;
  console.log(`Creating shape #${shapeCounter}`);
  console.log(`  totalElementsCreated: ${totalElementsCreated}, checking slot: ${totalElementsCreated + 1}`);
  console.log(`  latticeSlots:`, latticeSlots);

  // It's a regular shape
  let shapeType, size;
  let angle = random(TWO_PI);

  // --- Variety Enforcement Logic ---
  let availableTypes;
  if (shapeCounter <= 2) {
    // Correct list for skeleton shapes
    availableTypes = ['openRect', 'openTriangle', 'openSemiCircle'];
  } else {
    // Definitive list for ornament shapes from KandinskyShape class
    availableTypes = ['circle', 'rect', 'triangle', 'semiCircle', 'openRect', 'openTriangle', 'openSemiCircle', 'halo', 'concentricCircle', 'concentricArc', 'squiggle', 'arc'];
  }

  const missingTypes = availableTypes.filter(t => !createdShapeTypes.has(t));

  if (missingTypes.length > 0) {
    shapeType = random(missingTypes);
    console.log(`  Enforcing variety: selected missing type '${shapeType}'`);
  } else {
    // All required types have been created, proceed with weighted random
    if (shapeCounter <= 2) {
      shapeType = weightedRandom([
        { value: 'openRect', weight: 33 },
        { value: 'openTriangle', weight: 33 },
        { value: 'openSemiCircle', weight: 34 },
      ]);
    } else {
      shapeType = weightedRandom([
        { value: 'circle', weight: 6 },
        { value: 'rect', weight: 6 },
        { value: 'triangle', weight: 6 },
        { value: 'semiCircle', weight: 6 },
        { value: 'openRect', weight: 12 },
        { value: 'openTriangle', weight: 12 },
        { value: 'openSemiCircle', weight: 12 },
        { value: 'halo', weight: 8 },
        { value: 'concentricCircle', weight: 8 },
        { value: 'concentricArc', weight: 8 },
        { value: 'squiggle', weight: 8 },
        { value: 'arc', weight: 8 },
      ]);
      if (shapeType && shapeType.value) shapeType = shapeType.value;
    }
  }

  createdShapeTypes.add(shapeType);


  if (shapeCounter <= 2) {
    console.log('  Type: Skeleton Shape');
    size = random(BASE_UNIT * 0.54, BASE_UNIT * 0.96); // Increased by 1.2x
  } else {
    console.log('  Type: Ornament Shape');
    size = random(BASE_UNIT * 0.144, BASE_UNIT * 0.324); // Increased by 1.2x
  }

  const shape = new KandinskyShape(anchor.x, anchor.y, { shapeType, size, angle, anchorId: anchor.id });
  console.log(`✅ Created shape:`, { type: shapeType, x: anchor.x, y: anchor.y, size });

  if (shapeCounter <= 2) {
    skeletons.push(shape);
    const shapeReport = captureShapeReport(shape);
    sceneReport.skeletons.push(shapeReport);
    console.log(`📊 Added to skeletons. Total skeletons: ${skeletons.length}, Scene report skeletons: ${sceneReport.skeletons.length}`);
    console.log(`📋 Shape report:`, shapeReport);
  } else {
    ornaments.push(shape);
    const shapeReport = captureShapeReport(shape);
    sceneReport.ornaments.push(shapeReport);
    console.log(`📊 Added to ornaments. Total ornaments: ${ornaments.length}, Scene report ornaments: ${sceneReport.ornaments.length}`);
    console.log(`📋 Shape report:`, shapeReport);
  }

  console.log(`🔍 Current scene report summary:`);
  console.log(`  - Skeletons: ${sceneReport.skeletons.length}`);
  console.log(`  - Ornaments: ${sceneReport.ornaments.length}`);
  console.log(`  - Lines: ${sceneReport.lines.length}`);
  console.log(`  - Total shapes in arrays: ${skeletons.length + ornaments.length}`);

  return true;
}

function createLineElement(anchor) {
  lineCounter++; // Increment the line counter
  console.log('createLineElement()');
  let elementCreated = false;
  let isThick = thickLineSlots.includes(lineCounter);
  let lineType;

  // --- Variety Enforcement Logic ---
  const missingLineTypes = allLineTypes.filter(t => !createdLineTypes.has(t));

  if (isThick) {
    // For thick lines, prioritize missing 'line' or 'bezier' types
    const missingThickTypes = ['line', 'bezier'].filter(t => !createdLineTypes.has(t));
    if (missingThickTypes.length > 0) {
      lineType = random(missingThickTypes);
    } else {
      lineType = random(['line', 'bezier']);
    }
    console.log(`  Creating THICK line #${lineCounter} of type: ${lineType}`);
  } else if (missingLineTypes.length > 0) {
    lineType = random(missingLineTypes);
    console.log(`  Enforcing variety: selected missing type '${lineType}'`);
  } else {
    // All types used, proceed with weighted random
    lineType = weightedRandom([
      { value: 'line', weight: 40 },
      { value: 'bezier', weight: 40 },
      { value: 'arc', weight: 10 },
      { value: 'spiral', weight: 10 },
    ]);
  }

  createdLineTypes.add(lineType);

  let line;
  switch (lineType) {
    case 'line':
      console.log('  Creating: Line');
      let B = random(anchors.filter(a => a !== anchor));
      let lineSteps = min(dist(anchor.x, anchor.y, B.x, B.y) * 0.5, 600);
      line = new LineAnim(anchor.x, anchor.y, B.x, B.y, lineSteps, { isThick });
      sceneReport.lines.push(captureLineReport(line, anchor.id));
      elementCreated = true;
      break;
    case 'bezier':
      console.log('  Creating: Bezier');
      let B2 = random(anchors.filter(a => a !== anchor));
      const lineVec = p5.Vector.sub(B2, anchor);
      const lineLength = lineVec.mag();
      const perpVec = lineVec.copy().rotate(HALF_PI).setMag(random(-lineLength * 0.3, lineLength * 0.3));
      
      const cp1Vec = p5.Vector.add(anchor, p5.Vector.mult(lineVec, 1/3)).add(perpVec);
      const cp2Vec = p5.Vector.add(anchor, p5.Vector.mult(lineVec, 2/3)).add(perpVec);
      const cp1 = { x: cp1Vec.x, y: cp1Vec.y };
      const cp2 = { x: cp2Vec.x, y: cp2Vec.y };
      const approxLength = dist(anchor.x, anchor.y, cp1.x, cp1.y) + dist(cp1.x, cp1.y, cp2.x, cp2.y) + dist(cp2.x, cp2.y, B2.x, B2.y);
      let bezierSteps = min(approxLength * 0.5, 600);
      line = new BezierAnim(anchor, cp1, cp2, B2, bezierSteps, { isThick });
      sceneReport.beziers.push(captureLineReport(line, anchor.id));
      elementCreated = true;
      break;
    case 'arc':
       console.log('  Creating: Arc');
       let r = dist(anchor.x, anchor.y, width / 2, height / 2) * random(0.6, 1.44); // Increased by 1.2x
       let startAngle = random(TWO_PI);
       let sweep = random(PI * 0.25, PI * 1.5);
       let steps = min(r * sweep * 0.5, 600);
       line = new ArcAnim(anchor.x, anchor.y, r, startAngle, sweep, steps);
       sceneReport.arcs.push(captureLineReport(line, anchor.id));
       elementCreated = true;
       break;
    case 'spiral':
      console.log('  Creating: Spiral');
      let maxRadius = random(40, 150);
      let coils = random(2, 6);
      line = new SpiralAnim(anchor.x, anchor.y, {radius: maxRadius, revolutions: coils, steps: 600});
      sceneReport.spirals.push(captureLineReport(line, anchor.id));
      elementCreated = true;
      break;
  }

  if (line) {
    // Assign to a layer probabilistically
    line.layer = random() < 0.5 ? 'foreground' : 'background';
    lineAnims.push(line);
    elementCreated = true;
  }

  return elementCreated;
}

// —————————————————————————————————————
// ANIMATION CLASSES
// —————————————————————————————————————

class LatticeAnim {
  constructor(x, y, opts) {
    this.x = x;
    this.y = y;
    Object.assign(this, opts);
    
    // basis vectors
    this.v1 = p5.Vector.fromAngle(this.angle1).mult(this.spacing);
    this.v2 = p5.Vector.fromAngle(this.angle2).mult(this.spacing);

    // build cells - use centered grid like reference code
    this.cells = [];
    for(let i = -this.N1; i <= this.N1; i++){
      for(let j = -this.N2; j <= this.N2; j++){
        let p00 = p5.Vector.add(this.v1.copy().mult(i),
                                this.v2.copy().mult(j)),
            p10 = p5.Vector.add(this.v1.copy().mult(i+1),
                                this.v2.copy().mult(j)),
            p11 = p5.Vector.add(this.v1.copy().mult(i+1),
                                this.v2.copy().mult(j+1)),
            p01 = p5.Vector.add(this.v1.copy().mult(i),
                                this.v2.copy().mult(j+1));
        // Generate completely unique color for each cell - full spectrum including whites/blacks
        let col = color(
          random(360),        // Full hue range (0-360)
          random(0, 100),     // Full saturation range (0-100) - includes grays/whites
          random(20, 90),     // Full brightness range (20-90) - includes darks and lights
          this.fillAlpha      // Maintain proper alpha
        );
        this.cells.push({ poly:[p00,p10,p11,p01], col });
      }
    }
    this.cIdx = 0;
    this.delay = 12;
    this.lastF = 0;
  }

  step(g) {
    if (this.cIdx >= this.cells.length) {
        console.log(`Lattice animation complete. Drew ${this.cells.length} cells.`);
        latticesCompleted++;
        return false; // Animation is done
    }
    if (frameCount - this.lastF < this.delay) return true;
    this.lastF = frameCount;

    g.push();
    g.translate(this.x, this.y);

    // Draw one cell with its outline
    let c = this.cells[this.cIdx++];
    g.fill(c.col);
    g.stroke(0); // Stark black outline
    g.strokeWeight(1.5); // Slightly thicker for more definition
    g.beginShape();
    c.poly.forEach(p => g.vertex(p.x, p.y));
    g.endShape(CLOSE);

    g.pop();

    // Return true if there are more cells to draw, false if done.
    return this.cIdx < this.cells.length;
  }
}

class LineAnim {
  constructor(x0, y0, x1, y1, steps, opts = {}) {
    Object.assign(this, { x0, y0, x1, y1, steps, i: 0 });
    this.col = opts.color || color(0, 0, 15, 0.8);
    if (opts.isThick) {
      this.w = opts.strokeWeight || random(BASE_UNIT * 0.01, BASE_UNIT * 0.025);
    } else {
      this.w = opts.strokeWeight || random(BASE_UNIT * 0.001, BASE_UNIT * 0.005);
    }
  }
  step(g){
    let t0 = this.i/this.steps,
        t1 = (this.i+1)/this.steps;

    let easedT0 = easeOutCubic(t0);
    let easedT1 = easeOutCubic(t1);

    let xA = lerp(this.x0,this.x1,easedT0),
        yA = lerp(this.y0,this.y1,easedT0),
        xB = lerp(this.x0,this.x1,easedT1),
        yB = lerp(this.y0,this.y1,easedT1);

    if(g){
      g.stroke(this.col);
      g.strokeWeight(this.w);
      g.line(xA,yA, xB,yB);
    } else {
      stroke(this.col);
      strokeWeight(this.w);
      line(xA,yA, xB,yB);
    }
    this.i++;
    return this.i < this.steps;
  }
}

class ArcAnim {
  constructor(cx,cy,r,start,sweep,steps){
    Object.assign(this,{cx,cy,r,start,sweep,steps,i:0});
    this.col = color(0,0,15,0.6);
    this.w   = random(BASE_UNIT * 0.001, BASE_UNIT * 0.005);
  }
  step(g){
    let t0 = this.i/this.steps,
        t1 = (this.i+1)/this.steps;
    
    let easedT0 = easeOutCubic(t0);
    let easedT1 = easeOutCubic(t1);

    let a0 = this.start + this.sweep*easedT0,
        a1 = this.start + this.sweep*easedT1;
    let xA = this.cx + cos(a0)*this.r,
        yA = this.cy + sin(a0)*this.r,
        xB = this.cx + cos(a1)*this.r,
        yB = this.cy + sin(a1)*this.r;
    g.stroke(this.col);
    g.strokeWeight(this.w);
    g.line(xA,yA, xB,yB);
    this.i++;
    return this.i < this.steps;
  }
}

class SpiralAnim {
  constructor(x, y, opts) {
    this.x = x;
    this.y = y;
    this.steps = opts.steps || 200;
    this.progress = 0;
    this.sv = [];
    const colorfulPalette = palette.filter(c => brightness(c) >= 15 && brightness(c) < 85);
    const colorSource = colorfulPalette.length > 0 ? colorfulPalette : palette;
    const baseColor = random(colorSource);
    this.col = opts.color || color(hue(baseColor), saturation(baseColor), lightness(baseColor), 0.8);
    this.w = opts.strokeWeight || random(BASE_UNIT * 0.002, BASE_UNIT * 0.005);

    const revolutions = opts.revolutions || random(2, 5);
    const endRadius = opts.radius || random(BASE_UNIT * 0.04, BASE_UNIT * 0.08);

    for (let i = 0; i <= this.steps; i++) {
      const angle = map(i, 0, this.steps, 0, TWO_PI * revolutions);
      const radius = map(i, 0, this.steps, 0, endRadius);
      const sx = cos(angle) * radius;
      const sy = sin(angle) * radius;
      this.sv.push(createVector(sx, sy));
    }
  }

  step(g) {
    if (this.isDone()) {
      return false;
    }

    this.progress += 1;

    g.push();
    g.noFill();
    g.stroke(this.col);
    
    const easedProgress = easeOutCubic(this.progress / this.steps);
    const numPointsToShow = floor(easedProgress * this.steps);

    for (let j = 1; j < numPointsToShow && j < this.sv.length; j++) {
      const currentWeight = map(j, 0, this.steps, this.w, this.w * 0.1);
      g.strokeWeight(currentWeight);
      
      const p1 = this.sv[j - 1];
      const p2 = this.sv[j];
      g.line(this.x + p1.x, this.y + p1.y, this.x + p2.x, this.y + p2.y);
    }

    g.pop();

    return true;
  }

  isDone() {
    return this.progress >= this.steps;
  }
}

class BezierAnim {
  constructor(p0, p1, p2, p3, steps, opts = {}) {
    this.pts = [p0, p1, p2, p3];
    this.steps = steps;
    this.i = 0;
    this.col = opts.color || color(0, 0, 15, 0.8);
    if (opts.isThick) {
      this.w = opts.strokeWeight || random(BASE_UNIT * 0.01, BASE_UNIT * 0.025);
    } else {
      this.w = opts.strokeWeight || random(BASE_UNIT * 0.0005, BASE_UNIT * 0.0015);
    }
  }
  step(g){
    let t0 = this.i/this.steps,
        t1 = (this.i+1)/this.steps;

    let easedT0 = easeOutCubic(t0);
    let easedT1 = easeOutCubic(t1);

    let [p0,p1,p2,p3] = this.pts;
    
    // Safety check: ensure all points are defined
    if (!p0 || !p1 || !p2 || !p3 || 
        p0.x === undefined || p0.y === undefined ||
        p1.x === undefined || p1.y === undefined ||
        p2.x === undefined || p2.y === undefined ||
        p3.x === undefined || p3.y === undefined) {
      console.warn('BezierAnim: undefined points detected, skipping step');
      this.i++;
      return this.i < this.steps;
    }
    
    let ax = bezierPoint(p0.x,p1.x,p2.x,p3.x,easedT0),
        ay = bezierPoint(p0.y,p1.y,p2.y,p3.y,easedT0),
        bx = bezierPoint(p0.x,p1.x,p2.x,p3.x,easedT1),
        by = bezierPoint(p0.y,p1.y,p2.y,p3.y,easedT1);
    if(g){
      g.stroke(this.col); g.strokeWeight(this.w);
      g.line(ax,ay,bx,by);
    } else {
      stroke(this.col); strokeWeight(this.w);
      line(ax,ay,bx,by);
    }
    this.i++;
    return this.i < this.steps;
  }
}

class KandinskyShape {
  constructor(x,y,opts={}){
    this.x = x; this.y = y;
    this.anchorId = opts.anchorId;
    this.index      = shapeCounter;
    this.targetSize = opts.size;

    if (this.index > 2 && random() < 0.5) {
      const radius = this.targetSize / 2;
      const angle = random(TWO_PI);
      this.x = x + radius * cos(angle);
      this.y = y + radius * sin(angle);
    }

    this.t     = 0;
    const maxSpeed = map(this.index, 3, 50, SHAPE_SPEED_MAX, SHAPE_SPEED_MAX * 2.5, true);
    this.speed = random(SHAPE_SPEED_MIN, maxSpeed);
    const colorfulPalette = palette.filter(c => brightness(c) >= 15 && brightness(c) < 85);
    this.palette = colorfulPalette;

    if (this.index <= 2) {
        let selectedColor;
        if (firstTwoShapeColors.length === 0) {
            if (colorfulPalette.length > 0) {
                selectedColor = random(colorfulPalette);
            } else { 
                let c1 = random(palette);
                selectedColor = color(hue(c1), saturation(c1), random(40, 70));
            }
        } 
        else {
            let firstColor = firstTwoShapeColors[0];
            let hueShift = random(90, 270); 
            let newHue = (hue(firstColor) + hueShift) % 360;

            let newSaturation = random(70, 100);
            let newLightness = random(50, 85);

            selectedColor = color(newHue, newSaturation, newLightness);
        }
        this.c = selectedColor;
        this.c2 = selectedColor; 
        firstTwoShapeColors.push(this.c);

    } else {
        if (colorfulPalette.length > 0) {
            this.c = generateShapeColor(colorfulPalette);
            this.c2 = generateShapeColor(colorfulPalette, this.c);
        } else {
            this.c = generateShapeColor(null);
            this.c2 = generateShapeColor(null, this.c);
        }
    }
    this.rot = opts.angle || random(TWO_PI);
    this.sw = this.targetSize * random(0.005, 0.02);

    this.rawType = opts.shapeType;
    if (!this.rawType) {
        console.warn('No shapeType provided, falling back to random selection.');
        if (this.index <= 2) {
            this.rawType = random(['openRect', 'openTriangle', 'openSemiCircle']);
        } else {
            let styles = opts.styleSet || [
                "circle", "rect", "triangle", "semiCircle",
                "openRect", "openTriangle", "openSemiCircle", "openSemiCircle", "openSemiCircle",
                "halo", "halo",
                "concentricCircle", "concentricArc", "squiggle",
                "arc"
            ];
            this.rawType = random(styles);
        }
    }
    this.useAdditiveBlend = false;

    if (this.rawType === "concentricCircle") {
        this.type = "concentricCircle";
        this.style = "normal";
        this.rings = floor(random(3, 8));
        this.diff = this.targetSize * random(0.01, 0.035);
        this.concentricColors = [];
        let lastColor = null;
        for (let i = 0; i < this.rings; i++) {
            const newColor = generateShapeColor(this.palette, lastColor);
            this.concentricColors.push(newColor);
            lastColor = newColor;
        }
    } else if (this.rawType === "concentricArc") {
        this.type = "concentricArc";
        this.style = "normal";
        this.rings = floor(random(3, 6));
        this.diff = this.targetSize * random(0.03, 0.105);
        this.arcStart = random(TWO_PI);
        this.arcSweep = random(PI / 3, TWO_PI);
        this.concentricColors = [];
        let lastColor = null;
        for (let i = 0; i < this.rings; i++) {
            const newColor = generateShapeColor(this.palette, lastColor);
            this.concentricColors.push(newColor);
            lastColor = newColor;
        }
    } else if (this.rawType === "halo") {
        this.type = "circle";
        this.style = "halo";
        this.rings = floor(random(3, 6));
        this.haloColors = [];
        this.haloGradientAngles = [];
        const haloPalette = this.palette.filter(c => brightness(c) < 75 && saturation(c) > 30);
        const colorSource = haloPalette.length > 0 ? haloPalette : this.palette;
        for (let i = 0; i < this.rings; i++) {
            const newColor = generateShapeColor(colorSource, this.haloColors[i - 1]);
            this.haloColors.push(newColor);
            this.haloGradientAngles.push(random(TWO_PI));
        }
    } else if (this.rawType === "openRect") {
        this.type = "rect";
        this.style = "open";
        this.gradientAngle = random(TWO_PI);
    } else if (this.rawType === "openTriangle") {
        this.type = "triangle";
        this.style = "open";
        this.gradientAngle = random(TWO_PI);
    } else if (this.rawType === "openSemiCircle") {
        this.type = "semiCircle";
        this.style = "open";
        this.gradientAngle = random(TWO_PI);
    } else if (this.rawType === "squiggle") {
        this.type = "squiggle";
        this.style = "normal";
        let segs = 15, len = this.targetSize * 2;
        this.sv = [];
        for (let i = 0; i <= segs; i++) {
            let xx = map(i, 0, segs, -len / 2, len / 2),
                yy = sin(i / segs * PI) * this.targetSize * 0.2;
            this.sv.push({ x: xx, y: yy });
        }
    } else if (this.rawType === "arc") {
        this.type = "arc";
        this.style = "normal";
        this.arcStart = random(TWO_PI);
        this.arcSweep = random(PI / 3, PI);
    } else {
        this.type = this.rawType;
        this.style = "filled";
        // Add variable opacity for the 'washed paint' effect on later shapes
        if (this.index > 2) {
            let newAlpha = random(0.4, 0.9);
            this.c = color(hue(this.c), saturation(this.c), lightness(this.c), newAlpha);
        }
    }

    if ((this.type === 'openTriangle' || this.type === 'openRect') && this.targetSize < BASE_UNIT * 0.06) {
        this.type = this.type.replace('open', '').toLowerCase();
    }
  }

  display() {
    const slowdownStart = 16;
    let speedModifier = 1.0;
    if (currentElementCount > slowdownStart) {
      speedModifier = map(currentElementCount, slowdownStart, 33, 1.0, 0.1, true);
    }

    if (this.t < 1) {
      this.t += this.speed * speedModifier;
    }
    let easedT = easeOutCubic(this.t);
    let s = this.targetSize * easedT;

    push();
    translate(this.x, this.y);
    rotate(this.rot);
    let ctx = drawingContext;
    // ... (rest of the code remains the same)
    const originalBlendMode = ctx.globalCompositeOperation;

    try {
        if (this.useAdditiveBlend) {
            ctx.globalCompositeOperation = 'lighter';
        }

        // --- circle / halo ---
        if (this.type === "circle") {
                                                if (this.style === "halo") {
                const numCircles = this.rings;
                const maxRadius = s * 0.5;

                for (let i = 0; i < numCircles; i++) {
                    const radius = maxRadius * ((numCircles - i) / numCircles);
                    const circleColor = this.haloColors[i];
                    // Muted colors for both solid and gradient
                    const finalColor = color(
                        hue(circleColor), 
                        saturation(circleColor) * 0.7, 
                        lightness(circleColor) * 0.8, 
                        0.8  // Semi-opaque for subtle effect
                    );

                    // The outermost circle (i=0) gets a gradient surround
                    if (i === 0) {
                        const transparentColor = color(hue(finalColor), saturation(finalColor), lightness(finalColor), 0);
                        let grad = ctx.createRadialGradient(0, 0, radius * 0.6, 0, 0, radius);
                        grad.addColorStop(0, finalColor.toString());
                        grad.addColorStop(1, transparentColor.toString());
                        ctx.fillStyle = grad;
                        noStroke();
                        circle(0, 0, radius * 2);
                    } else {
                        // Inner circles are solid with muted colors
                        fill(finalColor);
                        stroke(0);
                        strokeWeight(this.sw * 0.5);
                        circle(0, 0, radius * 2);
                    }
                }
            } else { // Filled circle
                stroke(0);
                strokeWeight(this.sw);
                fill(this.c);
                circle(0, 0, s);
            }
        }

        // --- semiCircle ---
        else if (this.type === "semiCircle") {
            if (this.style === "open") {
                let r = s / 2;
                let transparentColor = color(hue(this.c), saturation(this.c), lightness(this.c), 0);
                
                // arc(..., 0, PI) draws the bottom half. Gradient from peak (y=r) to base (y=0).
                let lg = drawingContext.createLinearGradient(0, r, 0, 0);
                lg.addColorStop(0, this.c.toString());
                lg.addColorStop(0.9, transparentColor.toString());
                lg.addColorStop(1, transparentColor.toString());

                // Draw the gradient-filled semi-circle
                drawingContext.fillStyle = lg;
                noStroke();
                arc(0, 0, s, s, 0, PI);

                // Draw the stroked arc outline on top
                stroke(0);
                strokeWeight(this.sw);
                noFill();
                arc(0, 0, s, s, 0, PI);

            } else { // Filled semiCircle
                stroke(0);
                strokeWeight(this.sw);
                fill(this.c);
                arc(0, 0, s, s, 0, PI);
            }
        }

        // --- rect / openRect ---
        else if (this.type === "rect") {
            let w = s, h = s * 0.6;
            if (this.style === "open") {
                const verts = [
                    [-w / 2, -h / 2], [w / 2, -h / 2],
                    [w / 2, h / 2], [-w / 2, h / 2]
                ];
                const edges = [
                    { v: [verts[0], verts[1]], dir: [0, -1] }, { v: [verts[1], verts[2]], dir: [1, 0] },
                    { v: [verts[2], verts[3]], dir: [0, 1] }, { v: [verts[3], verts[0]], dir: [-1, 0] }
                ];

                let θ = this.gradientAngle, dx = cos(θ), dy = sin(θ);
                let maxDot = -Infinity, openIdx = 0;
                for (let i = 0; i < 4; i++) {
                    let dot = edges[i].dir[0] * dx + edges[i].dir[1] * dy;
                    if (dot > maxDot) { maxDot = dot; openIdx = i; }
                }

                let oppositeIdx = (openIdx + 2) % 4;
                let startEdge = edges[oppositeIdx].v, endEdge = edges[openIdx].v;
                let startX = (startEdge[0][0] + startEdge[1][0]) / 2, startY = (startEdge[0][1] + startEdge[1][1]) / 2;
                let endX = (endEdge[0][0] + endEdge[1][0]) / 2, endY = (endEdge[0][1] + endEdge[1][1]) / 2;

                let transparentColor = color(hue(this.c), saturation(this.c), lightness(this.c), 0);
                let lg = ctx.createLinearGradient(startX, startY, endX, endY);
                lg.addColorStop(0, this.c.toString());
                lg.addColorStop(0.9, transparentColor.toString());
                lg.addColorStop(1, transparentColor.toString());

                ctx.save();
                ctx.beginPath();
                ctx.moveTo(...verts[0]); ctx.lineTo(...verts[1]); ctx.lineTo(...verts[2]); ctx.lineTo(...verts[3]);
                ctx.closePath();
                ctx.clip();
                ctx.fillStyle = lg;
                ctx.fillRect(-w / 2, -h / 2, w, h);
                ctx.restore();

                noFill(); stroke(0); strokeWeight(this.sw);
                for (let i = 0; i < 4; i++) {
                    if (i !== openIdx) { line(edges[i].v[0][0], edges[i].v[0][1], edges[i].v[1][0], edges[i].v[1][1]); }
                }
            } else { // Filled rect
                stroke(0);
                strokeWeight(this.sw);
                fill(this.c);
                rect(-s / 2, -s * 0.3, s, s * 0.6);
            }
        }

        // --- triangle / openTriangle ---
        else if (this.type === "triangle") {
            let hgt = s * sqrt(3) / 2, v = [[-s / 2, hgt / 3], [s / 2, hgt / 3], [0, -2 * hgt / 3]];
            if (this.style === "open") {
                let θ = this.gradientAngle, dx = cos(θ), dy = sin(θ);
                let maxDot = -Infinity, openIdx = 0;
                for (let i = 0; i < 3; i++) {
                    let j = (i + 1) % 3;
                    let mx = (v[i][0] + v[j][0]) / 2, my = (v[i][1] + v[j][1]) / 2;
                    if ((mx * dx + my * dy) > maxDot) { maxDot = (mx * dx + my * dy); openIdx = i; }
                }

                let startVert = v[(openIdx + 2) % 3];
                let edgeA = v[openIdx], edgeB = v[(openIdx + 1) % 3];
                let midX = (edgeA[0] + edgeB[0]) / 2, midY = (edgeA[1] + edgeB[1]) / 2;

                let transparentColor = color(hue(this.c), saturation(this.c), lightness(this.c), 0);
                let lg = ctx.createLinearGradient(startVert[0], startVert[1], midX, midY);
                lg.addColorStop(0, this.c.toString());
                lg.addColorStop(0.9, transparentColor.toString());
                lg.addColorStop(1, transparentColor.toString());

                ctx.save();
                ctx.beginPath();
                ctx.moveTo(...v[0]); ctx.lineTo(...v[1]); ctx.lineTo(...v[2]);
                ctx.closePath();
                ctx.clip();
                ctx.fillStyle = lg;
                ctx.fillRect(-s, -s, 2 * s, 2 * s);
                ctx.restore();

                noFill(); stroke(0); strokeWeight(this.sw);
                for (let i = 0; i < 3; i++) {
                    if (i !== openIdx) { let j = (i + 1) % 3; line(v[i][0], v[i][1], v[j][0], v[j][1]); }
                }
            } else { // Filled triangle
                stroke(0);
                strokeWeight(this.sw);
                fill(this.c);
                triangle(v[0][0], v[0][1], v[1][0], v[1][1], v[2][0], v[2][1]);
            }
        }

        // --- Other shapes ---
        else if (this.type === "concentricCircle") {
            noStroke();
            const scale = s / this.targetSize;
            for (let i = this.rings; i > 0; i--) {
                const d = i * this.diff * 2 * scale;
                fill(this.concentricColors[i - 1]);
                ellipse(0, 0, d, d);
            }
        } else if (this.type === "concentricArc") {
            noFill();
            strokeWeight(this.sw);
            const scale = s / this.targetSize;
            for (let i = this.rings; i > 0; i--) {
                const d = i * this.diff * 2 * scale;
                stroke(this.concentricColors[i - 1]);
                arc(0, 0, d, d, this.arcStart, this.arcStart + this.arcSweep);
            }
        }
        else if (this.type === "squiggle") {
            noFill();
            stroke(this.c);
            strokeWeight(this.sw);
            beginShape();
            this.sv.forEach(p => vertex(p.x * (s / this.targetSize), p.y * (s / this.targetSize)));
            endShape();
        }
        else if (this.type === "arc") {
            noFill(); stroke(this.c); strokeWeight(this.sw);
            arc(0, 0, s, s, this.arcStart, this.arcStart + this.arcSweep);
        }

    } finally {
        ctx.globalCompositeOperation = originalBlendMode;
    }
    pop();
  }
}
// —————————————————————————————————————
// HELPER & STATE FUNCTIONS
// —————————————————————————————————————

// Manually start the fade-out/blackout/fade-in reset cycle (see the RESET
// menu item). Composition no longer resets on its own after MAX_ELEMENTS -
// this is now the only way a reset happens.
function resetComposition() {
  if (resetCycleTimestamp > 0) return; // a reset is already in progress
  console.log('Manual reset triggered');
  compositionFinished = true;
  completionTimestamp = millis();
  resetCycleTimestamp = millis();
}
window.resetComposition = resetComposition;

function reset() {
  // Clear graphics layers
  if (lineLayer) lineLayer.clear();
  if (foregroundLayer) foregroundLayer.clear();

  // Generate a NEW random seed for fresh composition
  randomSeedValue = int(random(1000000));
  randomSeed(randomSeedValue);
  
  // Re-initialize palette with new randomness
  palette = getPalette();

  // Reset state variables and animation arrays
  skeletons = [];
  ornaments = [];
  lineAnims = [];
  bezierAnims = [];
  spiralAnims = [];
  arcAnims = [];
  latticeAnims = [];
  foregroundAnims = [];

  // Keep window references fresh for 3D mode
  window.skeletons = skeletons;
  window.ornaments = ornaments;
  window.lineAnims = lineAnims;
  window.bezierAnims = bezierAnims;
  window.arcAnims = arcAnims;
  window.spiralAnims = spiralAnims;
  window.latticeAnims = latticeAnims;

  // Reset counters and flags
  thickStrokeCount = 0;
  latticesCompleted = 0;
  completionTimestamp = 0; // Reset the completion timestamp
  compositionFinished = false;
  maxElementsReached = false; // Reset the max elements flag
  // resetCycleTimestamp should NOT be reset here - let fade-in complete
  lastDragTime = 0;
  // projectStartTime is only for initial load, not reset cycles
  shapeCounter = 0;
  lineCounter = 0;
  totalElementsCreated = 0;
  isShapeTurn = true; // Start with a shape turn
  createdShapeTypes.clear(); // Reset shape type tracking
  createdLineTypes.clear(); // Reset line type tracking
  firstTwoShapeColors = []; // Reset first two shape colors

  // Determine number of lattices (1, 2, or 3) and assign their slots.
  const numLattices = floor(random(1, 4)); // 1, 2, or 3
  latticeSlots = [];
  let lastSlot = 3; // Start after the first two skeleton shapes
  for (let i = 0; i < numLattices; i++) {
    // Distribute the slots somewhat evenly across the remaining timeline
    const rangeStart = lastSlot + 5;
    const rangeEnd = 48 - (numLattices - 1 - i) * 5;
    const newSlot = floor(random(rangeStart, rangeEnd));
    latticeSlots.push(newSlot);
    lastSlot = newSlot;
  }
  console.log(`Generating ${numLattices} lattice(s) in slots:`, latticeSlots);

  // Determine the two random slots for thick lines
  const lineSlot1 = floor(random(1, 13)); // First half of lines
  let lineSlot2;
  do {
    lineSlot2 = floor(random(13, 26)); // Second half of lines
  } while (lineSlot1 === lineSlot2);
  thickLineSlots = [lineSlot1, lineSlot2];

  // Initialize a fresh, fully structured sceneReport with complete reproduction data
  sceneReport = {
    palette: palette.map(c => c.toString('#rrggbb')),
    backgroundColors: [],
    randomSeed: randomSeedValue,
    skeletons: [],
    ornaments: [],
    lines: [],
    beziers: [],
    arcs: [],
    spirals: [],
    lattices: [],
    foregroundShapes: [],
    userInputLog: [],
    // Enhanced data for pixel-perfect reproduction
    canvasWidth: width,
    canvasHeight: height,
    baseUnit: BASE_UNIT,
    vanishingPoints: [],
    thickLineSlots: [],
    latticeSlots: [],
    backgroundData: null, // Will be populated after background generation
    renderingParams: {
      pixelDensity: pixelDensity(),
      colorMode: 'RGB', // p5.js default
      angleMode: 'RADIANS' // p5.js default
    }
  };

  // Expose persistent scene record for 3D mode (live anim arrays get spliced as animations finish)
  window.sceneReport = sceneReport;

  // Generate a fresh watercolor background for each new composition
  // Random seed already set above, so this will use the new seed
  generateWorldBackground();
  
  // Capture complete state for pixel-perfect reproduction
  sceneReport.thickLineSlots = [...thickLineSlots];
  sceneReport.latticeSlots = [...latticeSlots];
  sceneReport.vanishingPoints = vanishingPoints.map(vp => ({ x: vp.x, y: vp.y }));
  
  // Note: Background image will be uploaded to Firebase Storage during save
  // No longer storing base64 data in scene report to avoid Firestore size limits
  
  console.log("System reset. All state variables and sceneReport have been initialized.");
  console.log("🎨 Background ready for Firebase Storage upload");
}

function easeOutCubic(t) {
    return 1 - pow(1 - t, 3);
}

function drawDebugInfo() {
  if (!compositionFinished && resetCycleTimestamp === 0) return;

  push();
  fill(255, 0, 0);
  textSize(16);
  textAlign(LEFT, BOTTOM);
  textFont('monospace');
  let msg = '';

  if (compositionFinished && resetCycleTimestamp === 0) {
    msg = 'COMPLETE - use menu to reset';
  } else if (resetCycleTimestamp > 0) {
    const elapsed = millis() - resetCycleTimestamp;
    if (elapsed < FADE_DURATION_MS) {
      msg = 'STATE: FADING OUT';
    } else if (elapsed < FADE_DURATION_MS + BLACKOUT_DELAY_MS) {
      const countdown = 5 - ((elapsed - FADE_DURATION_MS) / 1000);
      msg = `STATE: BLACKOUT (${max(0, countdown).toFixed(1)}s)`;
    } else if (elapsed < FADE_DURATION_MS + BLACKOUT_DELAY_MS + FADE_DURATION_MS) {
      msg = 'STATE: FADING IN';
    }
  }

  text(msg, 10, height - 10);
  pop();
}

function updateAnchorPositions() {
  anchors = [];
  for (let i = 0; i < N_ANCHORS; i++) {
    anchors.push(createVector(random(width), random(height)));
  }
}

// —————————————————————————————————————
// COLOR GENERATION LOGIC
// —————————————————————————————————————

// Centralized function to generate varied colors for all shapes.
// Pass a palette to use it, or null to generate a fully random color.
// Pass a colorToAvoid to ensure the new color is different.
function generateShapeColor(palette, colorToAvoid) {
    let newColor;
    let attempts = 0;

    // Dynamically adjust the base hue for more variety.
    baseHue = (baseHue + random(5, 15)) % 360;

    do {
        let h = (baseHue + random([-120, -90, -60, 0, 60, 90, 120, 180])) % 360;
        if (h < 0) h += 360;
        let s = random(40, 95);
        let b = random(60, 100);

        newColor = color(h, s, b);
        attempts++;
    } while (colorToAvoid && dist(hue(newColor), saturation(newColor), brightness(newColor), hue(colorToAvoid), saturation(colorToAvoid), brightness(colorToAvoid)) < 100 && attempts < 20);

    return newColor;
}

function getPalette() {
  let baseHue = random(360);
  let scheme = random(['mono', 'comp', 'split', 'triad', 'analog']);
  let p = [];
  
  // Expanded saturation and lightness ranges for more variety
  const satMin = 40, satMax = 95;
  const lightMin = 30, lightMax = 90;

    while (p.length < 5) {
    let newColor;
    if (scheme === 'mono') {
      newColor = color(baseHue, random(satMin, satMax), random(lightMin, lightMax));
    } else if (scheme === 'comp') {
      newColor = color((baseHue + (p.length % 2) * 180) % 360, random(satMin, satMax), random(lightMin, lightMax));
    } else if (scheme === 'split') {
      newColor = color((baseHue + (p.length % 3 > 0 ? 150 : 0) + (p.length % 3 === 2 ? 60 : 0)) % 360, random(satMin, satMax), random(lightMin, lightMax));
    } else if (scheme === 'triad') {
      newColor = color((baseHue + (p.length % 3) * 120) % 360, random(satMin, satMax), random(lightMin, lightMax));
    } else { // Analogous
      newColor = color((baseHue + (p.length - 2) * 30 + 360) % 360, random(satMin, satMax), random(lightMin, lightMax));
    }

    if (brightness(newColor) < 95) {
      p.push(newColor);
    }
  }
  return p;
}

// —————————————————————————————————————
// BACKGROUND GENERATION (from sketchIOS2.0)
// —————————————————————————————————————

// Generate the WORLD background as a CUBE SKYBOX strip: 4 square side faces
// side by side in one horizontally-tileable texture (4S x S), plus separate
// square top/bottom cap textures. The cube has no poles, so nothing stretches,
// and side seams are continuous by construction (adjacent faces are adjacent
// slices of the same strip; the strip tiles horizontally for the wrap seam).
const BG_FACE_SCALE = 2; // cube face texture side = 2x the SMALLER canvas dim
let bgCapTop, bgCapBottom;
function generateWorldBackground() {
  // Base the face size on min(w,h): on portrait screens (phones) sizing from
  // height would explode the texture area and generation time
  const faceSize = Math.round(Math.min(width, height) * BG_FACE_SCALE);
  const worldW = faceSize * 4, worldH = faceSize;
  if (!bigBgLayer || bigBgLayer.width !== worldW || bigBgLayer.height !== worldH) {
    bigBgLayer = createGraphics(worldW, worldH);
    bigBgLayer.pixelDensity(1); // keep the big buffer memory-friendly
  } else {
    bigBgLayer.clear();
  }
  generateWatercolorBackground(bigBgLayer, { tileX: true, guaranteeVisible: true });
  window.bigBgLayer = bigBgLayer;

  // Top and bottom cube faces: same watercolor style, splotches kept away from
  // the edges so every cube edge meets on plain paper base (no visible seams)
  if (!bgCapTop || bgCapTop.width !== faceSize) {
    bgCapTop = createGraphics(faceSize, faceSize);
    bgCapTop.pixelDensity(1);
    bgCapBottom = createGraphics(faceSize, faceSize);
    bgCapBottom.pixelDensity(1);
  } else {
    bgCapTop.clear();
    bgCapBottom.clear();
  }
  generateWatercolorBackground(bgCapTop, { edgeMargin: true });
  generateWatercolorBackground(bgCapBottom, { edgeMargin: true });
  window.bgCapTop = bgCapTop;
  window.bgCapBottom = bgCapBottom;

  // 2D background = silent screenshot of the skybox from the exact camera pose
  // 3D mode starts with (looking at the front face center). Entering 3D
  // therefore shows the identical background. The screenshot lands async, so
  // draw a flat crop of the front-face window immediately as a placeholder.
  finalBgLayer.clear();
  finalBgLayer.image(bigBgLayer, -(worldW * 0.375 - width / 2), -(worldH * 0.5 - height / 2));
  if (typeof window.renderSphereBackgroundTo2D === 'function') {
    window.renderSphereBackgroundTo2D(finalBgLayer, bigBgLayer.canvas, width, height);
  }
}

// opts:
//   tileX: true  -> texture must tile horizontally (skybox side strip); every
//                   splotch is also drawn at x +/- width so the wrap seam is
//                   ALWAYS continuous, and splotches stay off the top/bottom
//                   edges so the strip meets the cap faces on plain paper
//   edgeMargin: true -> keep splotches away from ALL edges (cap faces)
//   guaranteeVisible: true -> force 2 splotches inside the window of the
//                   texture that the initial 2D view shows (front face center)
function generateWatercolorBackground(pg, opts = {}) {
  pg.push();
  pg.colorMode(HSB, 360, 100, 100, 100);
  pg.angleMode(DEGREES);

  pg.blendMode(pg.BLEND);
  pg.background(40, 20, 90);
  pg.blendMode(pg.MULTIPLY);

  const baseCount = pg.floor(pg.random(6, 12)); // distinct clouds, not a solid wash
  // Scale splotch count by buffer area so bigger world buffers keep the same
  // cloud density and cloud SIZE as the on-screen canvas
  const areaFactor = (pg.width * pg.height) / (width * height);
  const numSplotches = Math.max(1, Math.round(baseCount * areaFactor));
  const arr_num = 300; // More layered forms, each fainter = softer clouds
  
  // Initialize background data capture for perfect reproduction
  const backgroundData = {
    numSplotches: numSplotches,
    splotches: [],
    randomSeed: randomSeedValue
  };
  
  const placedSplotches = [];
  // Scale attempts with area: with many splotches in the big world buffer, too
  // few attempts causes overlap-stacking under MULTIPLY = dark saturated blobs
  const maxAttempts = Math.ceil(20 * areaFactor);

  // GUARANTEED VISIBLE SPLOTCHES: the 2D background is a screenshot of the
  // skybox FRONT face (strip slice 1, centered at u = 0.375) taken with a
  // fov 0.45 camera, so the screen shows a window around that face's center.
  // Force 2 splotches fully inside that window.
  const forced = [];
  if (opts.guaranteeVisible) {
    const FOV = 0.45; // must match renderSphereBackgroundTo2D / 3D camera
    const hfov = 2 * Math.atan(Math.tan(FOV / 2) * (width / height));
    const faceSize = pg.height; // square faces: slice width = pg.width/4 = pg.height
    // Half-extents of the visible texture window, in texture pixels.
    // The face spans 90 degrees, mapped linearly in tan space.
    const halfW = Math.tan(hfov / 2) * faceSize / 2;
    const halfH = Math.tan(FOV / 2) * faceSize / 2;
    const cx = pg.width * 0.375, cy = pg.height * 0.5; // front face center
    // Whole splotch (reach ~2r) must fit inside the window with paper base
    // still showing around it
    const fr = Math.min(halfW, halfH) * 0.3;
    const fdx = halfW * 0.5;
    forced.push({ x: cx - fdx, y: cy - halfH * 0.25, radius: fr });
    forced.push({ x: cx + fdx, y: cy + halfH * 0.25, radius: fr });
  }
  // Forced splotches use the normal soft look; bold splotches disabled (they
  // over-saturate under MULTIPLY once the sphere window magnifies them)
  const boldIndices = [];
  const totalSplotches = Math.max(numSplotches, forced.length);

  for (let i = 0; i < totalSplotches; i++) {
    // Inverse size scaling: more splotches = smaller radius (smaller clouds).
    const baseRadius = pg.map(baseCount, 6, 12, BASE_UNIT * 0.12, BASE_UNIT * 0.05);
    const radius = i < forced.length ? forced[i].radius
      : pg.random(baseRadius * 0.85, baseRadius * 1.15); // Add variation

    let zone_x, zone_y;

    // Attempt to find a good position that doesn't overlap too much
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (i < forced.length) {
        // Guaranteed-visible splotch: fixed position inside a visible window
        zone_x = forced[i].x;
        zone_y = forced[i].y;
        break;
      }
      // Keep the whole splotch (shape + scatter, reach ~2.5r) inside the safe
      // area: off top/bottom edges for the tileable strip (cube edges must
      // meet on plain paper), off ALL edges for cap faces
      const margin = (opts.tileX || opts.edgeMargin) ? radius * 2.5 : radius;
      zone_x = opts.edgeMargin
        ? pg.random(margin, pg.width - margin)
        : pg.random(0, pg.width); // any x - horizontal wrap handles edges
      zone_y = pg.random(margin, pg.height - margin);
      let isOverlapping = false;
      for (const s of placedSplotches) {
        // Wrap-aware horizontal distance (canvas is an infinite cylinder)
        let dxw = Math.abs(zone_x - s.x);
        dxw = Math.min(dxw, pg.width - dxw);
        const d = Math.sqrt(dxw * dxw + (zone_y - s.y) * (zone_y - s.y));
        // Keep clear space between clouds so the paper base shows through.
        if (d < (radius + s.radius) * 1.15) { 
          isOverlapping = true;
          break;
        }
      }
      if (!isOverlapping) {
        break; // Found a good spot
      }
    }
    // If no position is found after max attempts, it will use the last one.
    
    placedSplotches.push({ x: zone_x, y: zone_y, radius: radius });

    let arr = [];
    const zone_hue = pg.random(360);

    for (let k = 0; k < arr_num; k++) {
      let angle_sep = pg.int(3, pg.noise(k) * 7);
      let points = createShape(radius, angle_sep, pg); // Use the new dynamic radius
      let form = transformShape(points, 4, 0.5, pg);
      arr.push(form);
    }
    
    // Precompute each form's offset and color so wrapped copies are identical
    const rendered = arr.map(form => {
      const std = radius / 6; // wider scatter dissolves hard polygon edges
      let alpha = (100 / arr_num) * 2;
      let saturation = 80;
      if (boldIndices.includes(i)) {
        // This is a 'bold' splotch
        alpha *= 2.5; // Make it more opaque
        saturation = 100; // Max saturation
      }
      return {
        form: form,
        ox: pg.randomGaussian(0, std),
        oy: pg.randomGaussian(0, std),
        col: pg.color(pg.randomGaussian(zone_hue, 5), saturation, 90, alpha)
      };
    });
    
    // INFINITE CANVAS: splotches near the left/right edge are drawn again on
    // the opposite side (identical precomputed forms) so the texture tiles
    // horizontally with a continuous wrap seam. reach = 4r generously covers
    // the shape + scatter spread (anything further is invisibly faint), while
    // skipping the double-draw for the ~90% of splotches nowhere near an edge
    const xPositions = [zone_x];
    if (opts.tileX) {
      const reach = radius * 4;
      if (zone_x < reach) xPositions.push(zone_x + pg.width);
      if (zone_x > pg.width - reach) xPositions.push(zone_x - pg.width);
    }
    
    for (const wx of xPositions) {
      pg.push();
      pg.translate(wx, zone_y);
      for (const r of rendered) {
        pg.push();
        pg.translate(r.ox, r.oy);
        drawShape(r.form, r.col, pg);
        pg.pop();
      }
      pg.pop();
    }
  }

  // FADE BORDERS TO THE FLAT PAPER BASE: cube faces meet each other on an
  // IDENTICAL solid-color band, so the skybox edges are invisible. Each
  // splotch leaves a faint wide haze that tints its whole texture slightly
  // differently - without this fade those tints make the face boundaries
  // perceptible. Side faces only fade top/bottom (content flows continuously
  // across the vertical seams); cap faces fade all four edges.
  pg.blendMode(pg.BLEND);
  const ctx2 = pg.drawingContext;
  const BASE = '229,214,184'; // same paper wash as pg.background(40, 20, 90)
  const band = pg.height * 0.22;
  const fadeRect = (x0, y0, w0, h0, gx0, gy0, gx1, gy1) => {
    const g = ctx2.createLinearGradient(gx0, gy0, gx1, gy1);
    g.addColorStop(0, `rgba(${BASE},1)`);
    g.addColorStop(1, `rgba(${BASE},0)`);
    ctx2.fillStyle = g;
    ctx2.fillRect(x0, y0, w0, h0);
  };
  if (opts.tileX || opts.edgeMargin) {
    fadeRect(0, 0, pg.width, band, 0, 0, 0, band); // top
    fadeRect(0, pg.height - band, pg.width, band, 0, pg.height, 0, pg.height - band); // bottom
  }
  if (opts.edgeMargin) {
    fadeRect(0, 0, band, pg.height, 0, 0, band, 0); // left
    fadeRect(pg.width - band, 0, band, pg.height, pg.width, 0, pg.width - band, 0); // right
  }
  pg.pop();
}

function createShape(shape_radius, angle_sep, pg) {
    let points = [];
    let start_angle = pg.random(360);
    let angle_step = 360 / angle_sep;
    for (let angle = start_angle; angle < start_angle + 360; angle += angle_step) {
        let x = pg.cos(angle) * shape_radius;
        let y = pg.sin(angle) * shape_radius;
        let point = pg.createVector(x, y);
        points.push(point);
    }
    return points;
}

function transformShape(points, count, variance, pg) {
    if (count <= 0) {
        return points;
    }
    let new_points = [];
    for (let i = 0; i < points.length; i++) {
        let p1 = points[i];
        let p2 = points[(i + 1) % points.length];
        new_points.push(p1);
        let mid = p5.Vector.lerp(p1, p2, 0.5);
        let len = p5.Vector.dist(p1, p2);
        mid.x += pg.randomGaussian(0, variance * len);
        mid.y += pg.randomGaussian(0, variance * len);
        new_points.push(mid);
    }
    return transformShape(new_points, count - 1, variance, pg);
}

function drawShape(points, col, pg) {
    pg.push();
    pg.fill(col);
    pg.noStroke();
    pg.beginShape();
    for (let p of points) {
        pg.vertex(p.x, p.y);
    }
    pg.endShape(pg.CLOSE);
    pg.pop();
}

// —————————————————————————————————————
// FIREBASE INTEGRATION
// —————————————————————————————————————

/**
 * Recursively find undefined fields in an object
 * @param {Object} obj - Object to check
 * @param {string} path - Current path for debugging
 * @returns {Array} Array of paths to undefined fields
 */
function findUndefinedFields(obj, path = '') {
  const undefinedFields = [];
  
  if (obj === undefined) {
    return [path];
  }
  
  if (obj === null || typeof obj !== 'object') {
    return [];
  }
  
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      undefinedFields.push(...findUndefinedFields(item, itemPath));
    });
  } else {
    Object.keys(obj).forEach(key => {
      const value = obj[key];
      const fieldPath = path ? `${path}.${key}` : key;
      
      if (value === undefined) {
        undefinedFields.push(fieldPath);
      } else if (typeof value === 'object' && value !== null) {
        undefinedFields.push(...findUndefinedFields(value, fieldPath));
      }
    });
  }
  
  return undefinedFields;
}


// —————————————————————————————————————
// SHAPE RECONSTRUCTION FROM SCENE REPORTS
// —————————————————————————————————————

/**
 * Renders a shape from scene report data for high-res image generation
 * This ensures consistency between Firebase reports and generated images
 */
function renderShapeFromReport(graphics, shapeReport, scaleFactor) {
  try {
    graphics.push();
    
    // Apply transformations
    graphics.translate(shapeReport.x * scaleFactor, shapeReport.y * scaleFactor);
    graphics.rotate(shapeReport.rot || 0);
    
    // Parse colors from hex strings
    const fillColor = parseColorFromHex(shapeReport.c);
    const strokeColor = parseColorFromHex(shapeReport.c2 || shapeReport.c);
    
    // Set basic properties
    graphics.fill(fillColor);
    graphics.stroke(0); // Always black stroke like original
    graphics.strokeWeight((shapeReport.sw || 2) * scaleFactor);
    
    const size = (shapeReport.targetSize || 50) * scaleFactor;
    
    // Render based on shape type and style
    if (shapeReport.type === 'concentricCircle') {
      renderConcentricCircleFromReport(graphics, shapeReport, size, scaleFactor);
    } else if (shapeReport.type === 'concentricArc') {
      renderConcentricArcFromReport(graphics, shapeReport, size, scaleFactor);
    } else if (shapeReport.style === 'halo') {
      renderHaloShapeFromReport(graphics, shapeReport, size, scaleFactor);
    } else if (shapeReport.style === 'open') {
      renderOpenShapeFromReport(graphics, shapeReport, size, scaleFactor);
    } else if (shapeReport.type === 'squiggle') {
      renderSquiggleFromReport(graphics, shapeReport, size, scaleFactor);
    } else if (shapeReport.type === 'arc') {
      renderArcFromReport(graphics, shapeReport, size);
    } else {
      // Default shape rendering (circle, rect, triangle, semiCircle)
      renderBasicShapeFromReport(graphics, shapeReport, size);
    }
    
    graphics.pop();
    
  } catch (error) {
    console.error('Error rendering shape from report:', error, shapeReport);
  }
}

/**
 * Parse color from hex string to p5.js color
 */
function parseColorFromHex(hexString) {
  if (!hexString || typeof hexString !== 'string') {
    return color(0, 0, 15, 0.8); // Default color
  }
  
  // Handle both #rrggbb and #rrggbbaa formats
  if (hexString.startsWith('#')) {
    const hex = hexString.slice(1);
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return color(r, g, b);
    } else if (hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = parseInt(hex.slice(6, 8), 16) / 255;
      return color(r, g, b, a);
    }
  }
  
  return color(0, 0, 15, 0.8); // Fallback
}

/**
 * Render basic shapes (circle, rect, triangle, semiCircle)
 */
function renderBasicShapeFromReport(graphics, shapeReport, size) {
  const fillColor = parseColorFromHex(shapeReport.c);
  graphics.fill(fillColor);
  
  switch (shapeReport.type) {
    case 'circle':
      graphics.circle(0, 0, size);
      break;
    case 'rect':
      graphics.rect(-size / 2, -size * 0.3, size, size * 0.6);
      break;
    case 'triangle':
      const hgt = size * sqrt(3) / 2;
      graphics.triangle(-size / 2, hgt / 3, size / 2, hgt / 3, 0, -2 * hgt / 3);
      break;
    case 'semiCircle':
      graphics.arc(0, 0, size, size, 0, PI);
      break;
    default:
      graphics.circle(0, 0, size); // Default to circle
  }
}

/**
 * Render open shapes with gradients
 */
function renderOpenShapeFromReport(graphics, shapeReport, size, scaleFactor) {
  const fillColor = parseColorFromHex(shapeReport.c);
  const transparentColor = color(hue(fillColor), saturation(fillColor), lightness(fillColor), 0);
  
  // Create gradient based on shape type
  let ctx = graphics.drawingContext;
  let lg;
  
  if (shapeReport.type === 'rect') {
    const w = size, h = size * 0.6;
    const gradientAngle = shapeReport.gradientAngle || 0;
    const dx = cos(gradientAngle), dy = sin(gradientAngle);
    
    lg = ctx.createLinearGradient(-w/4 * dx, -h/4 * dy, w/4 * dx, h/4 * dy);
    lg.addColorStop(0, fillColor.toString());
    lg.addColorStop(0.9, transparentColor.toString());
    lg.addColorStop(1, transparentColor.toString());
    
    ctx.save();
    ctx.beginPath();
    ctx.rect(-w/2, -h/2, w, h);
    ctx.clip();
    ctx.fillStyle = lg;
    ctx.fillRect(-w/2, -h/2, w, h);
    ctx.restore();
    
    // Draw stroke (3 sides, leaving one open)
    graphics.noFill();
    graphics.stroke(0);
    graphics.strokeWeight(shapeReport.sw * scaleFactor);
    graphics.line(-w/2, -h/2, w/2, -h/2); // top
    graphics.line(w/2, -h/2, w/2, h/2);   // right
    graphics.line(-w/2, -h/2, -w/2, h/2); // left
    
  } else if (shapeReport.type === 'triangle') {
    const hgt = size * sqrt(3) / 2;
    const vertices = [[-size/2, hgt/3], [size/2, hgt/3], [0, -2*hgt/3]];
    
    lg = ctx.createLinearGradient(0, -hgt/3, 0, hgt/3);
    lg.addColorStop(0, fillColor.toString());
    lg.addColorStop(0.9, transparentColor.toString());
    lg.addColorStop(1, transparentColor.toString());
    
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(vertices[0][0], vertices[0][1]);
    ctx.lineTo(vertices[1][0], vertices[1][1]);
    ctx.lineTo(vertices[2][0], vertices[2][1]);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = lg;
    ctx.fillRect(-size, -size, 2*size, 2*size);
    ctx.restore();
    
    // Draw stroke (2 sides, leaving one open)
    graphics.noFill();
    graphics.stroke(0);
    graphics.strokeWeight(shapeReport.sw * scaleFactor);
    graphics.line(vertices[0][0], vertices[0][1], vertices[2][0], vertices[2][1]);
    graphics.line(vertices[1][0], vertices[1][1], vertices[2][0], vertices[2][1]);
    
  } else if (shapeReport.type === 'semiCircle') {
    const r = size / 2;
    lg = ctx.createLinearGradient(0, r, 0, 0);
    lg.addColorStop(0, fillColor.toString());
    lg.addColorStop(0.9, transparentColor.toString());
    lg.addColorStop(1, transparentColor.toString());
    
    ctx.fillStyle = lg;
    graphics.noStroke();
    graphics.arc(0, 0, size, size, 0, PI);
    
    // Draw stroke outline
    graphics.stroke(0);
    graphics.strokeWeight(shapeReport.sw * scaleFactor);
    graphics.noFill();
    graphics.arc(0, 0, size, size, 0, PI);
  }
}

/**
 * Render concentric circles
 */
function renderConcentricCircleFromReport(graphics, shapeReport, size, scaleFactor) {
  graphics.noStroke();
  const scale = size / shapeReport.targetSize;
  
  for (let i = shapeReport.rings; i > 0; i--) {
    const d = i * shapeReport.diff * 2 * scale;
    const colorHex = shapeReport.concentricColors[i - 1];
    const ringColor = parseColorFromHex(colorHex);
    graphics.fill(ringColor);
    graphics.ellipse(0, 0, d, d);
  }
}

/**
 * Render concentric arcs
 */
function renderConcentricArcFromReport(graphics, shapeReport, size, scaleFactor) {
  graphics.noFill();
  graphics.strokeWeight(shapeReport.sw * scaleFactor);
  const scale = size / shapeReport.targetSize;
  
  for (let i = shapeReport.rings; i > 0; i--) {
    const d = i * shapeReport.diff * 2 * scale;
    const colorHex = shapeReport.concentricColors[i - 1];
    const ringColor = parseColorFromHex(colorHex);
    graphics.stroke(ringColor);
    graphics.arc(0, 0, d, d, shapeReport.arcStart, shapeReport.arcStart + shapeReport.arcSweep);
  }
}

/**
 * Render halo shapes
 */
function renderHaloShapeFromReport(graphics, shapeReport, size, scaleFactor) {
  const numCircles = shapeReport.rings;
  const maxRadius = size * 0.5;
  let ctx = graphics.drawingContext;
  
  for (let i = 0; i < numCircles; i++) {
    const radius = maxRadius * ((numCircles - i) / numCircles);
    const colorHex = shapeReport.haloColors[i];
    const circleColor = parseColorFromHex(colorHex);
    
    // Muted colors for both solid and gradient
    const finalColor = color(
      hue(circleColor), 
      saturation(circleColor) * 0.7, 
      lightness(circleColor) * 0.8, 
      0.8
    );
    
    if (i === 0) {
      // Outermost circle gets gradient surround
      const transparentColor = color(hue(finalColor), saturation(finalColor), lightness(finalColor), 0);
      let grad = ctx.createRadialGradient(0, 0, radius * 0.6, 0, 0, radius);
      grad.addColorStop(0, finalColor.toString());
      grad.addColorStop(1, transparentColor.toString());
      ctx.fillStyle = grad;
      graphics.noStroke();
      graphics.circle(0, 0, radius * 2);
    } else {
      // Inner circles are solid
      graphics.fill(finalColor);
      graphics.stroke(0);
      graphics.strokeWeight(shapeReport.sw * scaleFactor * 0.5);
      graphics.circle(0, 0, radius * 2);
    }
  }
}

/**
 * Render squiggle shapes
 */
function renderSquiggleFromReport(graphics, shapeReport, size, scaleFactor) {
  if (!shapeReport.sv || !Array.isArray(shapeReport.sv)) return;
  
  const fillColor = parseColorFromHex(shapeReport.c);
  graphics.noFill();
  graphics.stroke(fillColor);
  graphics.strokeWeight(shapeReport.sw * scaleFactor);
  
  graphics.beginShape();
  shapeReport.sv.forEach(p => {
    graphics.vertex(p.x * (size / shapeReport.targetSize), p.y * (size / shapeReport.targetSize));
  });
  graphics.endShape();
}

/**
 * Render arc shapes
 */
function renderArcFromReport(graphics, shapeReport, size) {
  const fillColor = parseColorFromHex(shapeReport.c);
  graphics.noFill();
  graphics.stroke(fillColor);
  graphics.strokeWeight(shapeReport.sw);
  graphics.arc(0, 0, size, size, shapeReport.arcStart, shapeReport.arcStart + shapeReport.arcSweep);
}

/**
 * Captures the current canvas as a pixel bitmap for perfect reproduction
 * Returns an object with pixel data as hex color strings
 */
function capturePixelBitmap() {
  console.log('🎯 Capturing pixel bitmap...');
  
  // Load pixels from the main canvas
  loadPixels();
  
  const pixelData = [];
  
  // Get actual pixel buffer dimensions (accounts for pixel density)
  const density = pixelDensity();
  const actualPixelWidth = width * density;
  const actualPixelHeight = height * density;
  const expectedPixelCount = actualPixelWidth * actualPixelHeight;
  
  console.log('🔍 Desktop pixel capture debug:', {
    logicalCanvas: { width, height },
    pixelDensity: density,
    actualPixelBuffer: { width: actualPixelWidth, height: actualPixelHeight },
    expectedPixels: expectedPixelCount,
    actualPixelsLength: pixels.length / 4
  });
  
  // Convert each pixel to hex color string
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1]; 
    const b = pixels[i + 2];
    const a = pixels[i + 3];
    
    // Convert RGBA to hex string
    const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}${a.toString(16).padStart(2, '0')}`;
    pixelData.push(hex);
  }
  
  const bitmap = {
    width: actualPixelWidth,
    height: actualPixelHeight,
    pixels: pixelData,
    captureMethod: 'pixel_bitmap',
    timestamp: Date.now(),
    pixelDensity: density,
    logicalCanvas: { width, height }
  };
  
  console.log(`✅ Desktop pixel bitmap captured: ${actualPixelWidth}x${actualPixelHeight} = ${pixelData.length} pixels (density: ${density}x)`);
  
  return bitmap;
}