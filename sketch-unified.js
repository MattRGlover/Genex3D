// Kandinsky-Inspired Generative Art - Unified Canvas with Download Modal
// Combines the main generative engine with download functionality

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
let isShapeTurn;
let vanishingPoints = [];
let thickStrokeCount = 0;
let foregroundAnims = [];
let firstTwoShapeColors = [];
let compositionFinished = false;
let maxElementsReached = false;

// New unified modal state
let showDownloadModal = false;
let downloadModalStartTime = 0;
let currentPixelBitmap = null;
let currentSceneReport = null;

// Timing and fade state
let fadeRect;
let fadeAlpha = 255;
let fadeStartTime = 0;
let fadeState = 'fadingIn'; // 'fadingIn', 'drawing', 'viewing', 'showingModal'
let resetCycleTimestamp = 0;
let BASE_UNIT;
let palette = [];

// Firebase
let db, storage;

// —————————————————————————————————————
// P5 SETUP
// —————————————————————————————————————
function setup() {
  let canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent('canvas-container');
  
  colorMode(HSL, 360, 100, 100, 1);
  
  calculateBaseUnitAndAssets();
  
  // Initialize Firebase
  initializeFirebase();
  
  // Create fade rectangle
  fadeRect = createGraphics(width, height);
  fadeRect.fill(0);
  fadeRect.noStroke();
  fadeRect.rect(0, 0, width, height);
  
  reset();
  
  // Set up modal event listeners
  setupModalEventListeners();
}

function calculateBaseUnitAndAssets() {
  BASE_UNIT = min(width, height);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  calculateBaseUnitAndAssets();
  
  // Recreate fade rectangle
  fadeRect = createGraphics(width, height);
  fadeRect.fill(0);
  fadeRect.noStroke();
  fadeRect.rect(0, 0, width, height);
  
  // Update anchor positions
  updateAnchorPositions();
  
  // Regenerate background if needed
  if (finalBgLayer) {
    finalBgLayer = createGraphics(width, height);
    generateWatercolorBackground(finalBgLayer);
  }
}

// —————————————————————————————————————
// DRAW LOOP
// —————————————————————————————————————
function draw() {
  background(0);
  
  // Handle different fade states
  if (fadeState === 'fadingIn') {
    if (fadeStartTime === 0) {
      fadeStartTime = millis();
    }
    
    let elapsed = millis() - fadeStartTime;
    let fadeDuration = 2000; // 2 seconds
    
    if (elapsed < fadeDuration) {
      fadeAlpha = map(elapsed, 0, fadeDuration, 255, 0);
      fadeAlpha = constrain(fadeAlpha, 0, 255);
    } else {
      fadeAlpha = 0;
      fadeState = 'drawing';
      fadeStartTime = 0;
    }
  } else if (fadeState === 'viewing') {
    // Viewing period after composition is complete
    if (fadeStartTime === 0) {
      fadeStartTime = millis();
    }
    
    let elapsed = millis() - fadeStartTime;
    let viewingDuration = 10000; // 10 seconds
    
    if (elapsed >= viewingDuration) {
      // Show download modal instead of fading to black
      showDownloadModal = true;
      downloadModalStartTime = millis();
      fadeState = 'showingModal';
      
      // Capture pixel bitmap and save to Firebase
      captureAndSaveComposition();
    }
  } else if (fadeState === 'showingModal') {
    // Keep showing the composition while modal is up
    fadeAlpha = 0;
  }
  
  // Draw background
  if (finalBgLayer) {
    image(finalBgLayer, 0, 0, width, height);
  }
  
  // Draw all shapes
  for (let shape of skeletons) {
    shape.display();
  }
  for (let shape of ornaments) {
    shape.display();
  }
  
  // Draw all line animations
  for (let lineAnim of lineAnims) {
    lineAnim.step();
  }
  
  // Draw lattice animations
  for (let latticeAnim of latticeAnims) {
    latticeAnim.step();
  }
  
  // Draw foreground animations
  for (let anim of foregroundAnims) {
    anim.step();
  }
  
  // Check if composition is complete
  if (fadeState === 'drawing') {
    checkCompletion();
  }
  
  // Draw fade overlay
  if (fadeAlpha > 0) {
    tint(255, fadeAlpha);
    image(fadeRect, 0, 0, width, height);
    noTint();
  }
  
  // Handle modal display
  if (showDownloadModal) {
    updateModalVisibility();
  }
}

// —————————————————————————————————————
// COMPLETION LOGIC
// —————————————————————————————————————
function checkCompletion() {
  let allShapesDone = skeletons.every(s => s.t >= 1) && ornaments.every(s => s.t >= 1);
  let allLinesDone = lineAnims.every(l => l.isDone && l.isDone()) && 
                     latticeAnims.every(l => l.isDone && l.isDone()) &&
                     foregroundAnims.every(a => a.isDone && a.isDone());
  
  if (allShapesDone && allLinesDone && totalElementsCreated >= MAX_ELEMENTS && !compositionFinished) {
    compositionFinished = true;
    fadeState = 'viewing';
    fadeStartTime = 0;
    console.log('🎨 Composition complete! Starting viewing period...');
  }
}

// —————————————————————————————————————
// MODAL FUNCTIONALITY
// —————————————————————————————————————
function setupModalEventListeners() {
  // Create modal HTML if it doesn't exist
  if (!document.getElementById('download-modal')) {
    const modalHTML = `
      <div id="download-modal" class="download-modal" style="display: none;">
        <div class="modal-content">
          <div class="modal-header">
            <h2>Download Your Artwork</h2>
            <button class="close-button" onclick="closeDownloadModal()">&times;</button>
          </div>
          <div class="modal-body">
            <p>Your generative artwork is ready! Choose your download option:</p>
            <div class="download-buttons">
              <button id="download-standard" class="download-btn standard">
                Standard Resolution (1:1)
              </button>
              <button id="download-hires" class="download-btn hires">
                High Resolution (4:1)
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Add event listeners
    document.getElementById('download-standard').addEventListener('click', () => downloadArtwork(1, 'Standard'));
    document.getElementById('download-hires').addEventListener('click', () => downloadArtwork(4, 'Hi-Res'));
  }
}

function updateModalVisibility() {
  const modal = document.getElementById('download-modal');
  if (modal) {
    modal.style.display = 'flex';
  }
}

function closeDownloadModal() {
  showDownloadModal = false;
  const modal = document.getElementById('download-modal');
  if (modal) {
    modal.style.display = 'none';
  }
  
  // Start a new composition cycle
  setTimeout(() => {
    reset();
    fadeState = 'fadingIn';
    fadeStartTime = 0;
  }, 1000);
}

function downloadArtwork(scale, quality) {
  if (!currentPixelBitmap) {
    alert('No artwork data available for download');
    return;
  }
  
  console.log(`🖥️ Generating ${quality} download (${scale}x scale)...`);
  
  // Create download canvas
  const canvas = document.createElement('canvas');
  const originalWidth = width;
  const originalHeight = height;
  
  canvas.width = originalWidth * scale;
  canvas.height = originalHeight * scale;
  
  const ctx = canvas.getContext('2d');
  
  // Scale pixel bitmap
  const imageData = ctx.createImageData(canvas.width, canvas.height);
  
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const origX = Math.floor(x / scale);
      const origY = Math.floor(y / scale);
      const origIndex = origY * originalWidth + origX;
      
      if (origIndex < currentPixelBitmap.length) {
        const hex = currentPixelBitmap[origIndex];
        const rgba = hexToRgba(hex);
        
        const canvasIndex = (y * canvas.width + x) * 4;
        imageData.data[canvasIndex] = rgba.r;
        imageData.data[canvasIndex + 1] = rgba.g;
        imageData.data[canvasIndex + 2] = rgba.b;
        imageData.data[canvasIndex + 3] = rgba.a;
      }
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
  
  // Download
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kandinsky-${quality.toLowerCase()}-${canvas.width}x${canvas.height}-${Date.now()}.png`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
    console.log(`✅ ${quality} download complete`);
  }, 'image/png', 1.0);
}

// Utility function to convert hex to RGBA
function hexToRgba(hex) {
  if (!hex || typeof hex !== 'string') {
    return { r: 0, g: 0, b: 0, a: 255 };
  }
  
  // Remove # if present
  hex = hex.replace('#', '');
  
  // Handle 3-digit hex
  if (hex.length === 3) {
    hex = hex.split('').map(char => char + char).join('');
  }
  
  // Handle 6-digit hex
  if (hex.length === 6) {
    return {
      r: parseInt(hex.substr(0, 2), 16),
      g: parseInt(hex.substr(2, 2), 16),
      b: parseInt(hex.substr(4, 2), 16),
      a: 255
    };
  }
  
  // Handle 8-digit hex (with alpha)
  if (hex.length === 8) {
    return {
      r: parseInt(hex.substr(0, 2), 16),
      g: parseInt(hex.substr(2, 2), 16),
      b: parseInt(hex.substr(4, 2), 16),
      a: parseInt(hex.substr(6, 2), 16)
    };
  }
  
  // Default fallback
  return { r: 0, g: 0, b: 0, a: 255 };
}

// —————————————————————————————————————
// PIXEL CAPTURE AND FIREBASE SAVE
// —————————————————————————————————————
function captureAndSaveComposition() {
  console.log('📸 Capturing pixel bitmap for download and Firebase...');
  
  // Capture pixel bitmap
  currentPixelBitmap = capturePixelBitmap();
  
  // Generate scene report
  currentSceneReport = generateSceneReport();
  
  // Save to Firebase
  saveCompositionToFirebase();
}

function capturePixelBitmap() {
  loadPixels();
  const pixelBitmap = [];
  
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];
    
    // Convert to hex
    const hex = '#' + 
      r.toString(16).padStart(2, '0') +
      g.toString(16).padStart(2, '0') +
      b.toString(16).padStart(2, '0') +
      a.toString(16).padStart(2, '0');
    
    pixelBitmap.push(hex);
  }
  
  console.log(`✅ Captured ${pixelBitmap.length} pixels`);
  return pixelBitmap;
}

function generateSceneReport() {
  const report = {
    id: Date.now().toString(),
    createdAt: new Date(),
    canvasWidth: width,
    canvasHeight: height,
    pixelBitmap: currentPixelBitmap,
    pixelBitmapSize: {
      width: width,
      height: height
    },
    captureMethod: 'pixel_bitmap',
    version: '2.0',
    randomSeed: randomSeedValue,
    palette: palette.map(c => c.toString()),
    totalElements: totalElementsCreated,
    // Include shape reports for compatibility
    skeletons: skeletons.map(s => s.report()),
    ornaments: ornaments.map(s => s.report()),
    // Add other elements as needed
  };
  
  return report;
}

// —————————————————————————————————————
// MOUSE & KEYBOARD
// —————————————————————————————————————
function mouseDragged() {
  if (fadeState === 'drawing' && !showDownloadModal) {
    handleDrag();
  }
}

function mousePressed() {
  if (fadeState === 'drawing' && !showDownloadModal) {
    handleDrag();
  }
}

function keyPressed() {
  if (key === 'r' || key === 'R') {
    reset();
    fadeState = 'fadingIn';
    fadeStartTime = 0;
  }
}

function handleTouchMove(event) {
  if (fadeState === 'drawing' && !showDownloadModal) {
    event.preventDefault();
    
    if (event.touches && event.touches.length > 0) {
      mouseX = event.touches[0].clientX;
      mouseY = event.touches[0].clientY;
      handleDrag();
    }
  }
}

function handleTouchEnd(event) {
  if (fadeState === 'drawing' && !showDownloadModal) {
    event.preventDefault();
  }
}

// —————————————————————————————————————
// CORE GENERATIVE LOGIC
// —————————————————————————————————————
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

  let N1 = floor(random(1, maxDim + 1));  // Start from 1 instead of 2
  let N2 = floor(random(max(1, N1 - 2), min(maxDim, N1 + 2) + 1));  // Smaller range

  const options = {
    angle1, angle2,
    spacing: random(20, 40), // Reduced by half for better proportionality
    N1, N2,
    fillAlpha: random(0.8, 1.0),
    anchorId: anchor.id,
  };
  const lattice = new LatticeAnim(anchor.x, anchor.y, options);
  console.log(`  Lattice created with ${lattice.cells.length} cells at (${anchor.x}, ${anchor.y})`);
  latticeAnims.push(lattice);
  console.log(`  Total latticeAnims: ${latticeAnims.length}`);
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
        { value: 'concentricArc', weight: 6 },
        { value: 'squiggle', weight: 4 },
        { value: 'arc', weight: 4 },
      ]);
    }
  }

  createdShapeTypes.add(shapeType);
  console.log(`  Selected shapeType: ${shapeType}`);

  // Size calculation
  if (shapeCounter <= 2) {
    size = random(BASE_UNIT * 0.15, BASE_UNIT * 0.25);
  } else {
    let maxSize = map(shapeCounter, 3, MAX_ELEMENTS, BASE_UNIT * 0.12, BASE_UNIT * 0.03, true);
    size = random(BASE_UNIT * 0.03, maxSize);
  }

  const shape = new KandinskyShape(anchor.x, anchor.y, {
    size: size,
    angle: angle,
    shapeType: shapeType,
    anchorId: anchor.id,
  });

  if (shapeCounter <= 2) {
    skeletons.push(shape);
    console.log(`  Added skeleton shape. Total skeletons: ${skeletons.length}`);
  } else {
    ornaments.push(shape);
    console.log(`  Added ornament shape. Total ornaments: ${ornaments.length}`);
  }

  return true;
}

function createLineElement(anchor) {
  lineCounter++;
  console.log(`Creating line #${lineCounter}`);

  // Variety enforcement for lines
  const missingLineTypes = allLineTypes.filter(t => !createdLineTypes.has(t));
  let lineType;
  
  if (missingLineTypes.length > 0) {
    lineType = random(missingLineTypes);
    console.log(`  Enforcing line variety: selected missing type '${lineType}'`);
  } else {
    lineType = weightedRandom([
      { value: 'line', weight: 30 },
      { value: 'bezier', weight: 25 },
      { value: 'arc', weight: 25 },
      { value: 'spiral', weight: 20 },
    ]);
  }

  createdLineTypes.add(lineType);
  console.log(`  Selected lineType: ${lineType}`);

  // Check if this should be a thick line
  const isThick = thickLineSlots.includes(totalElementsCreated + 1);
  if (isThick) {
    console.log(`  This is a THICK line slot: ${totalElementsCreated + 1}`);
  }

  let lineCreated = false;

  if (lineType === 'line') {
    // Create straight line to another anchor or vanishing point
    let target;
    if (random() < 0.7) {
      // Line to another anchor
      let otherAnchors = anchors.filter(a => a !== anchor);
      if (otherAnchors.length > 0) {
        target = random(otherAnchors);
      } else {
        target = random(vanishingPoints);
      }
    } else {
      // Line to vanishing point
      target = random(vanishingPoints);
    }

    if (target) {
      const line = new LineAnim(anchor.x, anchor.y, target.x, target.y, LINE_STEPS, { isThick });
      lineAnims.push(line);
      foregroundAnims.push(line);
      lineCreated = true;
    }
  } else if (lineType === 'bezier') {
    // Create bezier curve
    let target = random(anchors.filter(a => a !== anchor)) || random(vanishingPoints);
    if (target) {
      let cp1 = createVector(random(width), random(height));
      let cp2 = createVector(random(width), random(height));
      const bezier = new BezierAnim(
        createVector(anchor.x, anchor.y),
        cp1, cp2,
        createVector(target.x, target.y),
        BEZ_STEPS,
        { isThick }
      );
      lineAnims.push(bezier);
      foregroundAnims.push(bezier);
      lineCreated = true;
    }
  } else if (lineType === 'arc') {
    // Create arc
    let radius = random(BASE_UNIT * 0.05, BASE_UNIT * 0.15);
    let startAngle = random(TWO_PI);
    let sweep = random(PI/3, PI);
    const arc = new ArcAnim(anchor.x, anchor.y, radius, startAngle, sweep, ARC_STEPS);
    lineAnims.push(arc);
    foregroundAnims.push(arc);
    lineCreated = true;
  } else if (lineType === 'spiral') {
    // Create spiral
    const spiral = new SpiralAnim(anchor.x, anchor.y, {
      steps: random(200, 400),
      revolutions: random(2, 5),
      radius: random(BASE_UNIT * 0.04, BASE_UNIT * 0.08)
    });
    lineAnims.push(spiral);
    foregroundAnims.push(spiral);
    lineCreated = true;
  }

  if (lineCreated) {
    console.log(`  Created ${lineType}. Total lineAnims: ${lineAnims.length}`);
  }

  return lineCreated;
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

    let g_context = g || window;
    g_context.push();
    g_context.translate(this.x, this.y);

    // Draw one cell with its outline
    let c = this.cells[this.cIdx++];
    g_context.fill(c.col);
    g_context.stroke(0); // Stark black outline
    g_context.strokeWeight(1.5); // Slightly thicker for more definition
    g_context.beginShape();
    c.poly.forEach(p => g_context.vertex(p.x, p.y));
    g_context.endShape(CLOSE);

    g_context.pop();

    // Return true if there are more cells to draw, false if done.
    return this.cIdx < this.cells.length;
  }
  
  isDone() {
    return this.cIdx >= this.cells.length;
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
  
  isDone() {
    return this.i >= this.steps;
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
    
    let g_context = g || window;
    g_context.stroke(this.col);
    g_context.strokeWeight(this.w);
    g_context.line(xA,yA, xB,yB);
    this.i++;
    return this.i < this.steps;
  }
  
  isDone() {
    return this.i >= this.steps;
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

    let g_context = g || window;
    g_context.push();
    g_context.translate(this.x, this.y);
    g_context.stroke(this.col);
    g_context.strokeWeight(this.w);
    g_context.noFill();

    if (this.progress < this.sv.length - 1) {
      let p1 = this.sv[this.progress];
      let p2 = this.sv[this.progress + 1];
      g_context.line(p1.x, p1.y, p2.x, p2.y);
      this.progress++;
    }

    g_context.pop();
    return !this.isDone();
  }

  isDone() {
    return this.progress >= this.sv.length - 1;
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
  
  step(g) {
    let t0 = this.i / this.steps;
    let t1 = (this.i + 1) / this.steps;
    
    let easedT0 = easeOutCubic(t0);
    let easedT1 = easeOutCubic(t1);
    
    let p0 = this.bezierPoint(easedT0);
    let p1 = this.bezierPoint(easedT1);
    
    let g_context = g || window;
    g_context.stroke(this.col);
    g_context.strokeWeight(this.w);
    g_context.line(p0.x, p0.y, p1.x, p1.y);
    
    this.i++;
    return this.i < this.steps;
  }
  
  bezierPoint(t) {
    let x = bezierPoint(this.pts[0].x, this.pts[1].x, this.pts[2].x, this.pts[3].x, t);
    let y = bezierPoint(this.pts[0].y, this.pts[1].y, this.pts[2].y, this.pts[3].y, t);
    return createVector(x, y);
  }
  
  isDone() {
    return this.i >= this.steps;
  }
}
