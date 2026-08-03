// sketch.js


let brushImage; // A pre-rendered brush stamp for performance

// —————————————————————————————————————
// CONFIGURATION & STATE
// —————————————————————————————————————
const N_ANCHORS         = 300;  // per user preference
const TRIGGER_DIST      = 25;   // per user preference
const ANCHOR_VIS_RADIUS = 0;

const LINE_STEPS        = 900;
const ARC_STEPS         = 540;
const BEZ_STEPS         = 360;
const SHAPE_SPEED_MIN   = 0.001;
const SHAPE_SPEED_MAX   = 0.004;

let shapeCounter      = 0;
let currentElementCount = 0;    // NEW: To track total elements globally
let bgGradientStops = [];    // NEW VARIABLE TO STORE INITIAL BACKGROUND COLORS
let latticesCompleted = 0;      // cap at 2 full lattices
let finalBgLayer; // NEW: Holds the complete background gradient
let paintedBgLayer; // NEW: The background that gets "painted" onto


let anchors           = [];
let skeletons         = [];
let ornaments         = [];
       // NEW ARRAY TO STORE PERSISTENT GEOMETRIES
let lineAnims         = [];
let latticeAnims      = [];

let lastDragTime      = 0;
let vanishingPoints   = [];
let thickStrokeCount  = 0;
let foregroundAnims   = [];
let firstTwoShapeColors = [];
let compositionFinished = false;

let palette, bgColor, bgTransparent;
let bgLayer, lineLayer, foregroundLayer;

// Global scaling variable
let BASE_UNIT; // All visual parameters will be relative to this

// —————————————————————————————————————
// P5 SETUP
// —————————————————————————————————————
function setup(){
  let w = windowWidth,
      h = windowHeight;

  pixelDensity(1); // Mobile optimization
  let canvas = createCanvas(w, h);
  canvas.elt.addEventListener('touchstart', handleTouchStart, { passive: false });
  canvas.elt.addEventListener('touchmove', handleTouchMove, { passive: false });

  smooth();
  colorMode(HSL, 360,100,100,1);

  vanishingPoints = [
    createVector(width / 2, -height * 0.5), // Top
    createVector(width * 1.5, height / 2),  // Right
    createVector(-width * 0.5, height / 2), // Left
  ];

  // pastel background color + transparent string
  let H = random(360),
      S = random(15,35),
      L = random(85,97),
      A = 0.94;
  bgColor = color(H, S, L, A);
  let r = red(bgColor),
      g = green(bgColor),
      b = blue(bgColor);
  bgTransparent = `rgba(${floor(r)},${floor(g)},${floor(b)},0)`;

  // Create all the graphics layers
  const d = pixelDensity();
  bgLayer = createGraphics(w, h);
  bgLayer.pixelDensity(d);
  paintedBgLayer = createGraphics(w, h);
  paintedBgLayer.pixelDensity(d);
  finalBgLayer = createGraphics(w, h);
  finalBgLayer.pixelDensity(d);
  // finalBgLayer.drawingContext.willReadFrequently = true; // Removed due to mobile performance issues
  lineLayer = createGraphics(w, h);
  lineLayer.pixelDensity(d);
  foregroundLayer = createGraphics(w, h);
  foregroundLayer.pixelDensity(d);

  // Set drawing properties for layers
  lineLayer.strokeCap(ROUND);
  foregroundLayer.strokeCap(ROUND);

  calculateBaseUnitAndAssets();
  reset(); // Initial reset of all state
}

function calculateBaseUnitAndAssets() {
  BASE_UNIT = min(width, height);
  updateAnchorPositions();
  createBrush();
  prepareBackgrounds();
}

// —————————————————————————————————————
// DRAW LOOP
// —————————————————————————————————————
function draw(){
  currentElementCount = skeletons.length + ornaments.length + lineAnims.length + latticeAnims.length + foregroundAnims.length;
  // 1) Draw background layers
  image(finalBgLayer, 0, 0);
  image(paintedBgLayer, 0, 0);
  image(bgLayer, 0, 0);

  // 2) persistent lines & arcs from the background layer
  image(lineLayer, 0, 0);

  // 3) draw anchors
  noStroke(); fill(0,0,0,0.07);
  anchors.forEach(a => ellipse(a.x, a.y, ANCHOR_VIS_RADIUS));

  // 4) draw all shapes (skeletons and ornaments)
  skeletons.forEach(s => s.display());
  ornaments.forEach(o => o.display());

  // 4.5) Draw the foreground layer on top of the shapes
  image(foregroundLayer, 0, 0);

  // 5) animate BACKGROUND lines & arcs (drawing to the offscreen buffer)
  for(let i=lineAnims.length-1; i>=0; i--){
    if(!lineAnims[i].step(lineLayer)){
      lineAnims.splice(i,1);
    }
  }

  // 6) animate lattices (drawing to the offscreen buffer)
  for(let i=latticeAnims.length-1; i>=0; i--){
    if(!latticeAnims[i].step(lineLayer)){
      latticeAnims.splice(i,1);
    }
  }

  // 7) animate FOREGROUND lines & arcs (drawing directly to the main canvas)
  for(let i=foregroundAnims.length-1; i>=0; i--){
    if(!foregroundAnims[i].step(foregroundLayer)){ // Draw to the foreground layer
      foregroundAnims.splice(i,1);
    }
  }

  checkCompletion();
}

// —————————————————————————————————————
// SPAWN ON DRAG
// —————————————————————————————————————
function checkCompletion() {
  if (compositionFinished) return;

  // Use the global element count
  if (currentElementCount >= 33) {
    if (!compositionFinished) { // Log only once
      console.log(`Composition finished after ${currentElementCount} elements. No new elements will be generated.`);
      compositionFinished = true;
    }
  }
}

// —————————————————————————————————————
// SPAWN ON DRAG
// —————————————————————————————————————


function handleDrag(x, y, px, py) {
  // On mobile, prevent multi-touch from creating multiple strokes
  if (touches.length > 1) {
    return;
  }

  // --- 1. Reveal background by "stamping" a pre-rendered soft brush ---
  const brushDiameter = BASE_UNIT * 0.25;
  const brushRadius = brushDiameter / 2;
  const from = createVector(px, py);
  const to = createVector(x, y);
  const distance = from.dist(to);
  // Use a smaller step size to ensure a continuous line, especially on fast drags.
  const stepSize = brushRadius / 12; // Further reduced for mobile smoothness

  paintedBgLayer.push();
  paintedBgLayer.blendMode(REMOVE);
  paintedBgLayer.imageMode(CENTER);

  // Stamp along the drag path
  for (let i = 0; i <= distance; i += stepSize) {
    const curX = lerp(from.x, to.x, i / distance);
    const curY = lerp(from.y, to.y, i / distance);
    // Draw the high-res brush texture at the correct logical size
    paintedBgLayer.image(brushImage, curX, curY, brushDiameter, brushDiameter);
  }
  // Ensure the final position is stamped
  paintedBgLayer.image(brushImage, to.x, to.y, brushDiameter, brushDiameter);

  paintedBgLayer.pop();

  // --- 2. Generate new art elements ---
  if (compositionFinished) return;
  let now = millis();
  if (now - lastDragTime < 300) return; // Debounce
  lastDragTime = now;

  // Find the nearest anchor to the mouse position
  let near = anchors
    .map(a => ({ a, d: dist(x, y, a.x, a.y) }))
    .filter(o => o.d < TRIGGER_DIST);
  if (!near.length) return; // Exit if no anchor is close enough


  let A = near.sort((a, b) => a.d - b.d)[0].a;

  // Generate the first two large 'skeleton' shapes
  if (skeletons.length < 2) {
    let size = random(BASE_UNIT * 0.3, BASE_UNIT * 0.45);
    let angle = atan2(y - py, x - px);
    skeletons.push(new KandinskyShape(A.x, A.y, { size, angle }));
    return;
  }

  // After the first two, generate a mix of other elements

  // FIRST, check for a special thick stroke event (rare)
  if (thickStrokeCount < 2 && random() < 0.2) { // 20% chance, max twice
    const options = {
      strokeWeight: random(BASE_UNIT * 0.02, BASE_UNIT * 0.05),
      color: color(0, 0, 15, 0.85) // Almost opaque black
    };
    const anims = foregroundAnims; // Always draw these in the foreground
    if (random() < 0.5) { // 50% chance for a line
      let B = random(anchors);
      anims.push(new LineAnim(A.x, A.y, B.x, B.y, LINE_STEPS, options));
    } else { // 50% chance for a bezier curve
      let C1 = random(anchors), C2 = random(anchors), D = random(anchors);
      anims.push(new BezierAnim(A, C1, C2, D, BEZ_STEPS, options));
    }
    thickStrokeCount++;
    return; // Don't draw anything else this drag
  }

  // Main generation logic for all other elements
  const r = random();
  if (r < 0.35) { // 35% chance for a line
    const anims = random() < 0.3 ? foregroundAnims : lineAnims;
    if (random() < 0.4 && vanishingPoints.length > 0) { // Perspective line
      let vp = random(vanishingPoints);
      let pA = createVector(A.x, A.y);
      let dir = p5.Vector.sub(vp, pA).setMag(width * 2);
      let B = p5.Vector.add(pA, dir);
      anims.push(new LineAnim(A.x, A.y, B.x, B.y, LINE_STEPS, {}));
    } else { // Standard random line
      let B = random(anchors);
      anims.push(new LineAnim(A.x, A.y, B.x, B.y, LINE_STEPS, {}));
    }
  } else if (r < 0.45) { // 10% chance for an arc
    let R = random(BASE_UNIT * 0.1, BASE_UNIT * 0.3), st = random(TWO_PI), sw = random(PI * 0.3, PI * 0.8);
    lineAnims.push(new ArcAnim(A.x, A.y, R, st, sw, ARC_STEPS));
  } else if (r < 0.50) { // 5% chance for a bezier
    const anims = random() < 0.3 ? foregroundAnims : lineAnims;
    if (random() < 0.4 && vanishingPoints.length > 0) { // Perspective bezier
      let vp = random(vanishingPoints), C1 = random(anchors), D = random(anchors);
      anims.push(new BezierAnim(A, C1, D, vp, BEZ_STEPS, {}));
    } else { // Standard random bezier
      let C1 = random(anchors), C2 = random(anchors), D = random(anchors);
      anims.push(new BezierAnim(A, C1, C2, D, BEZ_STEPS, {}));
    }
  } else if (r < 0.55 && latticesCompleted < 2) { // 5% chance for a lattice (max twice)
    let angle1, angle2, diff;
    const minAngleDiff = 35 * PI / 180;
    angle1 = random(TWO_PI);
    do {
      angle2 = random(TWO_PI);
      diff = abs(angle1 - angle2);
      if (diff > PI) diff = TWO_PI - diff;
    } while (diff < minAngleDiff);
    // Responsive lattice sizing
    const isSmallScreen = min(width, height) < 600;
    
    // Use smaller grids on small screens
    const validPairs = isSmallScreen 
      ? [[1, 1], [1, 2], [2, 1]] 
      : [[1, 2], [1, 3], [1, 4], [2, 2], [2, 3]];
    // Use the validPairs system for varied lattice structures
    let pair = random(validPairs);
    if(random() < 0.5) [pair[0], pair[1]] = [pair[1], pair[0]]; // shuffle

    // Scale spacing relative to BASE_UNIT and reduce cell count
    const spacing = random(BASE_UNIT * 0.02, BASE_UNIT * 0.05);

    latticeAnims.push(new LatticeAnim(A.x, A.y, {
      N1: pair[0],
      N2: pair[1],
      angle1: angle1,
      angle2: angle2,
      spacing: spacing,
      fillAlpha: random(0.6, 0.9)
    }));
    latticesCompleted++; // Correctly increment the counter
  } else if (r < 0.6) { // 5% chance for a spiral
    const anims = lineAnims;
    anims.push(new SpiralAnim(A.x, A.y, {}));
  } else { // Remaining chance for an 'ornament' shape
    ornaments.push(new KandinskyShape(A.x, A.y, {}));
  }
}





// —————————————————————————————————————
// NATIVE TOUCH EVENT HANDLERS
// —————————————————————————————————————

let prevTouch = null; // To store the last touch position

function handleTouchStart(event) {
  event.preventDefault();
  const d = pixelDensity();
  const touch = event.touches[0];
  const x = touch.clientX * d;
  const y = touch.clientY * d;
  prevTouch = { x, y };
  handleDrag(x, y, x, y); // Draw a single point on tap
}

function handleTouchMove(event) {
  event.preventDefault();
  if (!prevTouch) return;

  const d = pixelDensity();
  const touch = event.touches[0];
  const x = touch.clientX * d;
  const y = touch.clientY * d;

  handleDrag(x, y, prevTouch.x, prevTouch.y);
  prevTouch = { x, y };
}

// —————————————————————————————————————
// LINE ANIMATION
// —————————————————————————————————————
class LineAnim {
  constructor(x0,y0,x1,y1,steps, opts={}){
    Object.assign(this,{x0,y0,x1,y1,steps,i:0});
    this.col = opts.color || color(0,0,15,0.8);
    this.w   = opts.strokeWeight || random(BASE_UNIT * 0.001, BASE_UNIT * 0.005);
  }
  step(g){
    let t0 = this.i/this.steps,
        t1 = (this.i+1)/this.steps;
    let xA = lerp(this.x0,this.x1,t0),
        yA = lerp(this.y0,this.y1,t0),
        xB = lerp(this.x0,this.x1,t1),
        yB = lerp(this.y0,this.y1,t1);
    if(g){
      g.stroke(this.col);
      g.strokeWeight(this.w);
      if (this.col === color(0,0,15,0.8)) {
        g.noFill();
        g.stroke(0);
        g.strokeWeight(this.w);
      }
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

// —————————————————————————————————————
// ARC ANIMATION
// —————————————————————————————————————
class ArcAnim {
  constructor(cx,cy,r,start,sweep,steps){
    Object.assign(this,{cx,cy,r,start,sweep,steps,i:0});
    this.col = color(0,0,15,0.6);
    this.w   = random(BASE_UNIT * 0.001, BASE_UNIT * 0.005);
  }
  step(g){
    let t0 = this.i/this.steps,
        t1 = (this.i+1)/this.steps;
    let a0 = this.start + this.sweep*t0,
        a1 = this.start + this.sweep*t1;
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

// —————————————————————————————————————
// SPIRAL ANIMATION
// —————————————————————————————————————
class SpiralAnim {
  constructor(x, y, opts) {
    this.x = x;
    this.y = y;
    this.steps = opts.steps || 100;
    this.progress = 0; // Use a float for smooth slowdown
    this.sv = [];
    const colorfulPalette = palette.filter(c => brightness(c) >= 15 && brightness(c) < 85);
    const colorSource = colorfulPalette.length > 0 ? colorfulPalette : palette;
    const baseColor = random(colorSource);
    this.col = opts.color || color(hue(baseColor), saturation(baseColor), lightness(baseColor), 0.8);
    this.w = opts.strokeWeight || random(BASE_UNIT * 0.0005, BASE_UNIT * 0.0015);

    const revolutions = opts.revolutions || random(2, 5);
    const endRadius = opts.radius || random(BASE_UNIT * 0.02, BASE_UNIT * 0.05);

    // Pre-calculate all points of the spiral
    for (let i = 0; i <= this.steps; i++) {
      const angle = map(i, 0, this.steps, 0, TWO_PI * revolutions);
      const radius = map(i, 0, this.steps, 0, endRadius);
      const sx = cos(angle) * radius;
      const sy = sin(angle) * radius;
      this.sv.push(createVector(sx, sy)); // Store as p5.Vector for lerp
    }
  }

  step(g) {
    if (this.isDone()) {
      return false; // Animation is finished
    }

    // Calculate a speed modifier based on the total number of elements
    const slowdownStart = 16;
    let speedModifier = 1.0;
    if (currentElementCount > slowdownStart) {
      // Slow down, but not as much as shapes. e.g., to 0.4 instead of 0.1
      speedModifier = map(currentElementCount, slowdownStart, 33, 1.0, 0.4, true);
    }
    this.progress += speedModifier;

    g.push();
    g.translate(this.x, this.y);
    g.noFill();
    g.stroke(this.col);
    g.strokeWeight(this.w);
    g.beginShape();

    const numPoints = floor(this.progress);
    // Draw the full segments
    for (let j = 0; j <= numPoints && j < this.sv.length; j++) {
      g.vertex(this.sv[j].x, this.sv[j].y);
    }

    // Draw the partial segment for a smooth animation
    const partial = this.progress - numPoints;
    if (numPoints < this.steps) {
      const lastPoint = this.sv[numPoints];
      const nextPoint = this.sv[numPoints + 1];
      const interpolatedPoint = p5.Vector.lerp(lastPoint, nextPoint, partial);
      g.vertex(interpolatedPoint.x, interpolatedPoint.y);
    }
    
    g.endShape();
    g.pop();

    this.i++;
    return true; // Animation is still running
  }

  isDone() {
    return this.i >= this.sv.length - 1;
  }
}

// —————————————————————————————————————
// BEZIER ANIMATION
// —————————————————————————————————————
class BezierAnim {
  constructor(p0,p1,p2,p3,steps, opts={}){
    this.pts   = [p0,p1,p2,p3];
    this.steps = steps;
    this.i     = 0;
    this.col   = opts.color || color(0,0,15,0.8);
    this.w     = opts.strokeWeight || random(BASE_UNIT * 0.0005, BASE_UNIT * 0.0015);
  }
  step(g){
    let t0 = this.i/this.steps,
        t1 = (this.i+1)/this.steps;
    let [p0,p1,p2,p3] = this.pts;
    let ax = bezierPoint(p0.x,p1.x,p2.x,p3.x,t0),
        ay = bezierPoint(p0.y,p1.y,p2.y,p3.y,t0),
        bx = bezierPoint(p0.x,p1.x,p2.x,p3.x,t1),
        by = bezierPoint(p0.y,p1.y,p2.y,p3.y,t1);
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

// LATTICE ANIMATION
// —————————————————————————————————————
class LatticeAnim {
  constructor(x,y,opts){
    this.x = x; this.y = y;
    Object.assign(this, opts);
    // basis vectors
    this.v1 = p5.Vector.fromAngle(this.angle1).mult(this.spacing);
    this.v2 = p5.Vector.fromAngle(this.angle2).mult(this.spacing);

    // build cells
    this.cells = [];
    for(let i=-this.N1;i<=this.N1;i++){
      for(let j=-this.N2;j<=this.N2;j++){
        let p00 = p5.Vector.add(this.v1.copy().mult(i),
                                this.v2.copy().mult(j)),
            p10 = p5.Vector.add(this.v1.copy().mult(i+1),
                                this.v2.copy().mult(j)),
            p11 = p5.Vector.add(this.v1.copy().mult(i+1),
                                this.v2.copy().mult(j+1)),
            p01 = p5.Vector.add(this.v1.copy().mult(i),
                                this.v2.copy().mult(j+1));
        let base = random(palette);
        let col  = color(
          hue(base),
          saturation(base),
          lightness(base),
          this.fillAlpha
        );
        this.cells.push({ poly:[p00,p10,p11,p01], col });
      }
    }

    this.stage = 0;  // 0=cells,1=lines1,2=lines2
    this.cIdx  = 0;
    this.l1    = -this.N1;
    this.l2    = -this.N2;
    this.delay = 12;
    this.lastF = 0;
  }

  step(g){
    if(frameCount - this.lastF < this.delay) return true;
    this.lastF = frameCount;

    g.push(); g.translate(this.x, this.y);

    if(this.stage===0){
      // fill one cell this frame
      let c = this.cells[this.cIdx++];
      g.noStroke(); g.fill(c.col);
      g.beginShape();
      c.poly.forEach(p=> g.vertex(p.x, p.y));
      g.endShape(CLOSE);
      if(this.cIdx >= this.cells.length){
        this.stage = 1;
      }
    }
    else if(this.stage===1){
      // draw one family-θ1 line
      let off = this.l1 * this.spacing,
          dx  = cos(this.angle1),
          dy  = sin(this.angle1),
          nx  = -dy, ny = dx;
      let p1 = createVector(nx,ny).mult(-max(this.w,this.h)*1.2)
               .add(createVector(dx,dy).mult(off)),
          p2 = createVector(nx,ny).mult( max(this.w,this.h)*1.2)
               .add(createVector(dx,dy).mult(off));
      g.stroke(0,0,15); g.strokeWeight(1);
      g.line(p1.x,p1.y, p2.x,p2.y);
      this.l1++;
      if(this.l1 > this.N1) this.stage = 2;
    }
    else {
      // draw one family-θ2 line
      let off = this.l2 * this.spacing,
          dx  = cos(this.angle2),
          dy  = sin(this.angle2),
          nx  = -dy, ny = dx;
      let p1 = createVector(nx,ny).mult(-max(this.w,this.h)*1.2)
               .add(createVector(dx,dy).mult(off)),
          p2 = createVector(nx,ny).mult( max(this.w,this.h)*1.2)
               .add(createVector(dx,dy).mult(off));
      g.stroke(0,0,15); g.strokeWeight(1);
      g.line(p1.x,p1.y, p2.x,p2.y);
      this.l2++;
    }

    g.pop();

    if(this.stage>=2 && this.l2 > this.N2){
      latticesCompleted++;
      return false;
    }
    return true;
  }
}

// —————————————————————————————————————
// KANDINSKY SHAPE (all variants + gradients)
// —————————————————————————————————————
class KandinskyShape {
  constructor(x,y,opts={}){
    this.x = x; this.y = y;
    this.index      = ++shapeCounter;
    let base        = opts.size || random(BASE_UNIT * 0.05, BASE_UNIT * 0.25);
    let sf;
    if (this.index <= 2) {
      // The first two shapes remain large
      sf = random(1.8, 2.5);
    } else {
      // Subsequent shapes are smaller and scale down gradually
      sf = map(this.index, 3, 100, 1.2, 0.5, true);
    }
    this.targetSize = base * sf;

    // New tangent spawning logic
    // 50% of the time, spawn the shape tangent to the anchor point
    if (random() < 0.5) {
      const radius = this.targetSize / 2;
      const angle = random(TWO_PI);
      // The shape's center is offset from the anchor point (x, y)
      // so that the anchor point lies on the shape's final circumference.
      this.x = x + radius * cos(angle);
      this.y = y + radius * sin(angle);
    }

    this.t     = 0;
    this.speed = random(SHAPE_SPEED_MIN,SHAPE_SPEED_MAX);
                            // Create a palette that excludes black/white extremes for all shapes.
        const colorfulPalette = palette.filter(c => brightness(c) >= 15 && brightness(c) < 85);
    this.palette = colorfulPalette;

    if (this.index <= 2) {
        let selectedColor;
        // This is the first of the two main shapes
        if (firstTwoShapeColors.length === 0) {
            if (colorfulPalette.length > 0) {
                selectedColor = random(colorfulPalette);
            } else { // Failsafe
                let c1 = random(palette);
                selectedColor = color(hue(c1), saturation(c1), random(40, 70));
            }
        } 
        // This is the second of the two main shapes
        else {
            // Find a color different from the first one
            let availableColors = colorfulPalette.filter(c => c.toString() !== firstTwoShapeColors[0].toString());
            if (availableColors.length > 0) {
                selectedColor = random(availableColors);
            } else { // Failsafe
                let otherColor = random(palette.filter(c => c.toString() !== firstTwoShapeColors[0].toString()));
                // Super failsafe if only one color exists in the entire palette
                if (!otherColor) {
                    let baseColor = firstTwoShapeColors[0];
                    let newHue = (hue(baseColor) + 180) % 360; // Get complementary hue
                    selectedColor = color(newHue, saturation(baseColor), brightness(baseColor));
                } else {
                    selectedColor = color(hue(otherColor), saturation(otherColor), random(40, 70));
                }
            }
        }
        this.c = selectedColor;
        this.c2 = selectedColor; // c2 isn't used in open shapes, but keep it consistent.
        firstTwoShapeColors.push(this.c);

    } else {
        // For all other shapes, pick from the colorful palette, with a fallback.
        if (colorfulPalette.length > 0) {
            this.c = random(colorfulPalette);
            this.c2 = random(colorfulPalette);
        } else {
            // Failsafe: generate a random vibrant color if the filtered palette is empty.
            this.c = color(random(360), random(70, 100), random(40, 70));
            this.c2 = color(random(360), random(70, 100), random(40, 70));
        }
    }
    this.rot   = opts.angle || random(TWO_PI);
    // Make stroke weight and thickness proportional to the shape's size for visual consistency
    this.sw    = this.targetSize * random(0.005, 0.02);
    this.diff  = this.targetSize * random(0.01, 0.035);
    
    if (this.index <= 2) {
      this.rawType = random(['openRect', 'openTriangle']);
    } else {
      let styles = opts.styleSet || [
        "circle", "rect", "triangle", "semiCircle",
        "openRect", "openTriangle",
        // Weight the 'halo' style to make it appear.
        "halo", "halo",
        "concentricCircle", "concentricArc", "squiggle",
        "arc"
      ];
      this.rawType = random(styles);
    }
        this.useAdditiveBlend = false; // FEATURE DISABLED: Additive blend mode was causing disruptive glowing.

    // normalize type/style
                                    if(this.rawType==="halo"){
      this.type="circle"; 
      this.style="halo";
      this.useAdditiveBlend = false; // <-- KEY CHANGE: Disable glowing effect.
      this.rings = floor(random(3, 6));
      this.haloColors = [];
      this.haloGradientAngles = [];

      // Use a palette for halos that excludes very bright colors.
            // Use a palette for halos that excludes very bright or low-saturation colors.
      const haloPalette = this.palette.filter(c => brightness(c) < 75 && saturation(c) > 30);
      const colorSource = haloPalette.length > 0 ? haloPalette : this.palette;

      let lastColor = null;
      for (let i = 0; i < this.rings; i++) {
        let availableColors = colorSource.filter(c => c.toString() !== (lastColor ? lastColor.toString() : ''));
        if (availableColors.length === 0) availableColors = colorSource; // Fallback
        let newColor = random(availableColors);
        this.haloColors.push(newColor);
        this.haloGradientAngles.push(random(TWO_PI));
        lastColor = newColor;
      }
    }
    else if(this.rawType==="openRect"){
      this.type="rect"; this.style="open";
      this.gradientAngle = random(TWO_PI);
    }
    else if(this.rawType==="openTriangle"){
      this.type="triangle"; this.style="open";
      this.gradientAngle = random(TWO_PI);
    }
    else {
      this.type  = this.rawType;
      this.style = "filled";
    }

    // Prevent small shapes from being 'open' style, as the effect is lost
        if ((this.type === 'openTriangle' || this.type === 'openRect') && this.targetSize < BASE_UNIT * 0.06) {
          this.type = this.type.replace('open', '').toLowerCase();
        }

    if(this.type==="concentricCircle"){
      this.rings = floor(random(3,6));
    }
    if(this.type==="concentricArc"){
      this.rings    = floor(random(3,6));
      this.arcStart = random(TWO_PI);
      this.arcSweep = random(PI/3, TWO_PI);
    }
    if(this.type==="squiggle"){
      let segs=15,len=this.targetSize*2;
      this.sv=[];
      for(let i=0;i<=segs;i++){
        let xx=map(i,0,segs,-len/2,len/2),
            yy=sin(i/segs*PI)*this.targetSize*0.2;
        this.sv.push({x:xx,y:yy});
      }
    }
    if(this.type==="arc"){
      this.arcStart = random(TWO_PI);
      this.arcSweep = random(PI/3, PI);
    }
  }

  display() {
    // Calculate a speed modifier based on the total number of elements
    const slowdownStart = 16;
    let speedModifier = 1.0;
    if (currentElementCount > slowdownStart) {
      speedModifier = map(currentElementCount, slowdownStart, 33, 1.0, 0.1, true);
    }

    // Grow the shape to its target size, applying the modifier
    if (this.t < 1) {
      this.t += this.speed * speedModifier;
    }
    let s = this.targetSize * (1 - pow(1 - this.t, 3));

    push();
    translate(this.x, this.y);
    rotate(this.rot);
    let ctx = drawingContext;
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
                    const finalColor = color(hue(circleColor), saturation(circleColor), lightness(circleColor), 0.85);

                    // The outermost circle (i=0) fades to transparent.
                    if (i === 0) {
                        const transparentColor = color(hue(finalColor), saturation(finalColor), lightness(finalColor), 0);
                        let grad = ctx.createRadialGradient(0, 0, radius * 0.7, 0, 0, radius);
                        grad.addColorStop(0, finalColor.toString());
                        grad.addColorStop(1, transparentColor.toString());
                        ctx.fillStyle = grad;
                                        } else {
                        // Inner circles get a subtle linear gradient to avoid the central hot spot.
                        const darkerColor = color(hue(finalColor), saturation(finalColor), lightness(finalColor) * 0.8, alpha(finalColor));
                        const angle = this.haloGradientAngles[i];
                        const x1 = cos(angle) * radius;
                        const y1 = sin(angle) * radius;
                        let grad = ctx.createLinearGradient(-x1, -y1, x1, y1);
                        grad.addColorStop(0, finalColor.toString());
                        grad.addColorStop(1, darkerColor.toString());
                        ctx.fillStyle = grad;
                    }

                    noStroke();
                    circle(0, 0, radius * 2);
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
            if (this.style === "filled") {
                stroke(0);
                strokeWeight(this.sw);
                fill(this.c);
            } else { // Legacy style, keep for now
                noFill();
                stroke(0, 0, 15);
                strokeWeight(this.sw);
            }
            arc(0, 0, s, s, 0, PI);
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
                rect(-w / 2, -h / 2, w, h);
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
            noFill(); stroke(this.c); strokeWeight(this.sw);
            for (let i = 1; i <= this.rings; i++) { ellipse(0, 0, s * (i / this.rings) * 2); }
        }
        else if (this.type === "concentricArc") {
            noFill(); stroke(this.c); strokeWeight(this.sw);
            for (let i = 1; i <= this.rings; i++) { let r = s * (i / this.rings) * 2; arc(0, 0, r, r, this.arcStart, this.arcStart + this.arcSweep); }
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
// RESIZE
// —————————————————————————————————————
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  
  // Re-create all layers and assets, explicitly setting pixel density for robustness.
  const d = pixelDensity();
  bgLayer = createGraphics(width, height);
  bgLayer.pixelDensity(d);
  paintedBgLayer = createGraphics(width, height);
  paintedBgLayer.pixelDensity(d);
  finalBgLayer = createGraphics(width, height);
  finalBgLayer.pixelDensity(d);
  finalBgLayer.drawingContext.willReadFrequently = true;
  lineLayer = createGraphics(width, height);
  lineLayer.pixelDensity(d);
  foregroundLayer = createGraphics(width, height);
  foregroundLayer.pixelDensity(d);
  lineLayer.strokeCap(ROUND);
  foregroundLayer.strokeCap(ROUND);

  // Recalculate everything. We don't preserve old content on resize.
  reset(); // reset() already calls calculateBaseUnitAndAssets()
}

function generateHarmoniousPalette() {
  let newPalette = [];

  // Always add black and a slightly off-white for contrast and highlights
  newPalette.push(color(0, 0, 10));       // Near-black
  newPalette.push(color(random(360), 10, 90)); // Off-white with a random hint of hue

  // Define vibrant color ranges
  const vibrantSaturation = () => random(75, 95);
  const vibrantLightness = () => random(40, 65);

  // --- FINAL, MOST ROBUST LOGIC FOR A RICH & VARIED PALETTE ---
  const numBaseHues = floor(random(5, 8)); // 5 to 7 base hues
  const minHueSeparation = 45; // Minimum degrees of separation
  let baseHues = [];

  // 1. Generate the distinct base hues
  for (let i = 0; i < numBaseHues; i++) {
    let newHue;
    let attempts = 0;
    while (attempts < 100) { // Failsafe
      newHue = random(360);
      let isFarEnough = true;
      for (const existingHue of baseHues) {
        let diff = abs(newHue - existingHue);
        if (diff > 180) diff = 360 - diff; // Wraparound distance
        if (diff < minHueSeparation) {
          isFarEnough = false;
          break;
        }
      }
      if (isFarEnough) {
        baseHues.push(newHue);
        break; // Found a good hue
      }
      attempts++;
    }
  }

  // 2. Generate a larger palette with variations from the base hues
  for (const hue of baseHues) {
    const numVariations = floor(random(5, 8)); // 5-7 variations per hue
    for (let i = 0; i < numVariations; i++) {
      // Add random jitter to saturation and brightness for variety
      const s = vibrantSaturation() + random(-10, 10);
      const b = vibrantLightness() + random(-10, 10);
      newPalette.push(color(hue, constrain(s, 65, 100), constrain(b, 30, 75)));
    }
  }

  return newPalette;
}

function reset() {
  // Clear all element and animation arrays
  skeletons = [];
  ornaments = [];
  lineAnims = [];
  foregroundAnims = [];
  latticeAnims = [];
  anchors = [];
  palette = [];
  vanishingPoints = [];
  firstTwoShapeColors = [];

  // Reset all state counters and flags
  shapeCounter = 0;
  latticesCompleted = 0;
  thickStrokeCount = 0;
  lastDragTime = 0;
  compositionFinished = false;
  dragCount = 0;

  // Clear the graphics layers
  if (lineLayer) lineLayer.clear();
  if (foregroundLayer) foregroundLayer.clear();
  
  // Generate a new visual setup
  palette = generateHarmoniousPalette();
  calculateBaseUnitAndAssets(); // This now includes prepareBackgrounds and createBrush

  // Create new anchor points with relative coordinates for resize persistence
  for(let i=0; i<N_ANCHORS; i++){
    anchors.push({
      rx: random(TRIGGER_DIST, width - TRIGGER_DIST) / width,
      ry: random(TRIGGER_DIST, height - TRIGGER_DIST) / height,
      x: 0, y: 0
    });
  }
  updateAnchorPositions();
  
  // Ensure vanishing points are recreated
  if (random() < 0.5) {
    vanishingPoints = [createVector(random(width), random(height))];
    if (random() < 0.3) {
      vanishingPoints.push(createVector(random(width), random(height)));
    }
  }

  // Restart the draw loop if it was stopped
  loop();
}

function updateAnchorPositions(){
  for(const a of anchors){
    a.x = a.rx * width;
    a.y = a.ry * height;
  }
}
//

//

function prepareBackgrounds() {
  // This function prepares the background layers at the start or on reset
  const noiseScale = BASE_UNIT * 0.0000025; // Reduced scale for a larger, less granular noise pattern
  const rOffset = random(1000), gOffset = random(1000), bOffset = random(1000);

  // Generate the colorful, splotchy texture on the finalBgLayer
  const d = pixelDensity();
  finalBgLayer.loadPixels();
  // Iterate over the density-scaled pixel dimensions
  for (let y = 0; y < finalBgLayer.height; y++) {
    for (let x = 0; x < finalBgLayer.width; x++) {
      // Un-scale the coordinates for the noise function to prevent stretching
      const r = noise((x / d) * noiseScale + rOffset, (y / d) * noiseScale + rOffset) * 255;
      const g = noise((x / d) * noiseScale + gOffset, (y / d) * noiseScale + gOffset) * 255;
      const b = noise((x / d) * noiseScale + bOffset, (y / d) * noiseScale + bOffset) * 255;
      const index = (x + y * finalBgLayer.width) * 4;
      finalBgLayer.pixels[index] = r;
      finalBgLayer.pixels[index + 1] = g;
      finalBgLayer.pixels[index + 2] = b;
      finalBgLayer.pixels[index + 3] = 255;
    }
  }
  finalBgLayer.updatePixels();

  // Prepare the other layers
  paintedBgLayer.background(230, 220, 200); // Start with a tan "canvas" color
  bgLayer.clear(); // Clear the ornament layer, making it transparent
}

function createBrush() {
  const brushDiameter = BASE_UNIT * 0.25;
  const d = pixelDensity();
  const pixelBrushDiameter = floor(brushDiameter * d);

  if (pixelBrushDiameter <= 0) return; // Failsafe

  brushImage = createGraphics(pixelBrushDiameter, pixelBrushDiameter);
  const center = pixelBrushDiameter / 2;

  brushImage.loadPixels();
  for (let y = 0; y < pixelBrushDiameter; y++) {
    for (let x = 0; x < pixelBrushDiameter; x++) {
      let distFromCenter = dist(x, y, center, center);
      let alpha = 0;
      if (distFromCenter < center) {
        let t = map(distFromCenter, 0, center, 1, 0);
        alpha = (cos(t * PI - PI) + 1) / 2 * 255;
      }
      let index = (x + y * pixelBrushDiameter) * 4;
      brushImage.pixels[index] = 0;
      brushImage.pixels[index + 1] = 0;
      brushImage.pixels[index + 2] = 0;
      brushImage.pixels[index + 3] = alpha;
    }
  }
  brushImage.updatePixels();
}