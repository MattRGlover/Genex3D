// Kandinsky-Inspired Generative Art for Mobile
// sketchIOS2.0.js: Merges the generative engine from sketch.js with the watercolor background.

// —————————————————————————————————————
// CONFIGURATION & STATE
// —————————————————————————————————————
const N_ANCHORS = 300;
const TRIGGER_DIST = 25;
const ANCHOR_VIS_RADIUS = 0;

const LINE_STEPS = 900;
const ARC_STEPS = 540;
const BEZ_STEPS = 360;
const SHAPE_SPEED_MIN = 0.001;
const SHAPE_SPEED_MAX = 0.004;

let shapeCounter = 0;
let currentElementCount = 0;
let latticesCompleted = 0;

let finalBgLayer;
let randomSeedValue;

let anchors = [];
let skeletons = [];
let ornaments = [];
let lineAnims = [];
let latticeAnims = [];

let lastDragTime = 0;
let vanishingPoints = [];
let thickStrokeCount = 0;
let foregroundAnims = [];
let firstTwoShapeColors = [];
let compositionFinished = false;

let palette;
let lineLayer, foregroundLayer;
let prevTouch = null; // For native touch handling

let BASE_UNIT;

// —————————————————————————————————————
// P5 SETUP
// —————————————————————————————————————
function setup() {
  let w = windowWidth, h = windowHeight;

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

  lineLayer.strokeCap(ROUND);
  foregroundLayer.strokeCap(ROUND);

  calculateBaseUnitAndAssets();
  reset();

  randomSeedValue = int(random(1000000));
  randomSeed(randomSeedValue);
  generateWatercolorBackground(finalBgLayer);
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
  lineLayer.strokeCap(ROUND);
  foregroundLayer.strokeCap(ROUND);

  calculateBaseUnitAndAssets();
  reset();

  randomSeed(randomSeedValue);
  generateWatercolorBackground(finalBgLayer);
}

// —————————————————————————————————————
// DRAW LOOP
// —————————————————————————————————————
function draw() {
  currentElementCount = skeletons.length + ornaments.length + lineAnims.length + latticeAnims.length + foregroundAnims.length;
  image(finalBgLayer, 0, 0);
  image(lineLayer, 0, 0);

  noStroke();
  fill(0, 0, 0, 0.07);
  anchors.forEach(a => ellipse(a.x, a.y, ANCHOR_VIS_RADIUS));

  skeletons.forEach(s => s.display());
  ornaments.forEach(o => o.display());

  image(foregroundLayer, 0, 0);

  for (let i = lineAnims.length - 1; i >= 0; i--) {
    if (!lineAnims[i].step(lineLayer)) {
      lineAnims.splice(i, 1);
    }
  }



  for (let i = foregroundAnims.length - 1; i >= 0; i--) {
    if (!foregroundAnims[i].step(foregroundLayer)) {
      foregroundAnims.splice(i, 1);
    }
  }

  checkCompletion();
}

// —————————————————————————————————————
// COMPLETION LOGIC
// —————————————————————————————————————
function checkCompletion() {
  if (compositionFinished) return;
  if (currentElementCount >= 50) {
    if (!compositionFinished) {
      console.log(`Composition finished after ${currentElementCount} elements.`);
      compositionFinished = true;
    }
  }
}

// —————————————————————————————————————
// MOUSE & KEYBOARD
// —————————————————————————————————————
function mouseDragged() {
    handleDrag();
}
  
function mousePressed() {
    handleDrag();
}
  
function keyPressed() {
    if (key === 's' || key === 'S') {
      saveCanvas(`kandinsky-${randomSeedValue}`, 'png');
    }
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
function handleDrag() {
  if (compositionFinished) return;
  let now = millis();
  if (now - lastDragTime < 300) return;
  lastDragTime = now;

  let near = anchors
    .map(a => ({ a, d: dist(mouseX, mouseY, a.x, a.y) }))
    .filter(o => o.d < TRIGGER_DIST);
  if (!near.length) return;

  let A = near.sort((a, b) => a.d - b.d)[0].a;

  if (skeletons.length < 2) {
    let size = random(BASE_UNIT * 0.3, BASE_UNIT * 0.45);
    let angle = atan2(mouseY - pmouseY, mouseX - pmouseX);
    skeletons.push(new KandinskyShape(A.x, A.y, { size, angle }));
    return;
  }

  if (thickStrokeCount < 2 && random() < 0.2) {
    const options = {
      strokeWeight: random(BASE_UNIT * 0.02, BASE_UNIT * 0.05),
      color: color(0, 0, 15, 0.85)
    };
    const anims = foregroundAnims;
    if (random() < 0.5) {
      let B = random(anchors);
      anims.push(new LineAnim(A.x, A.y, B.x, B.y, LINE_STEPS, options));
    } else {
      let C1 = random(anchors), C2 = random(anchors), D = random(anchors);
      anims.push(new BezierAnim(A, C1, C2, D, BEZ_STEPS, options));
    }
    thickStrokeCount++;
    return;
  }

  const r = random();
  if (r < 0.35) {
    const anims = random() < 0.3 ? foregroundAnims : lineAnims;
    if (random() < 0.4 && vanishingPoints.length > 0) {
      let vp = random(vanishingPoints);
      let pA = createVector(A.x, A.y);
      let dir = p5.Vector.sub(vp, pA).setMag(width * 2);
      let B = p5.Vector.add(pA, dir);
      anims.push(new LineAnim(A.x, A.y, B.x, B.y, LINE_STEPS, {}));
    } else {
      let B = random(anchors);
      anims.push(new LineAnim(A.x, A.y, B.x, B.y, LINE_STEPS, {}));
    }
  } else if (r < 0.45) {
    let R = random(BASE_UNIT * 0.1, BASE_UNIT * 0.3), st = random(TWO_PI), sw = random(PI * 0.3, PI * 0.8);
    lineAnims.push(new ArcAnim(A.x, A.y, R, st, sw, ARC_STEPS));
  } else if (r < 0.50) {
    const anims = random() < 0.3 ? foregroundAnims : lineAnims;
    if (random() < 0.4 && vanishingPoints.length > 0) {
      let vp = random(vanishingPoints), C1 = random(anchors), D = random(anchors);
      anims.push(new BezierAnim(A, C1, D, vp, BEZ_STEPS, {}));
    } else {
      let C1 = random(anchors), C2 = random(anchors), D = random(anchors);
      anims.push(new BezierAnim(A, C1, C2, D, BEZ_STEPS, {}));
    }
  } else if (r < 0.55 && latticesCompleted < 2) {
    const angle1 = random(TWO_PI);
    let angle_diff = random(PI/6, 2*PI/3); // 30 to 120 degrees
    if(random() < 0.5) angle_diff *= -1;
    const angle2 = angle1 + angle_diff;
    const isSmallScreen = min(width, height) < 600;
    const validPairs = isSmallScreen ? [[1, 1], [1, 2], [2, 1]] : [[1, 2], [1, 3], [1, 4], [2, 2], [2, 3]];
    let pair = random(validPairs);
    if(random() < 0.5) [pair[0], pair[1]] = [pair[1], pair[0]];
    const spacing = random(BASE_UNIT * 0.02, BASE_UNIT * 0.05);
    foregroundAnims.push(new LatticeAnim(A.x, A.y, {
      N1: pair[0],
      N2: pair[1],
      angle1: angle1,
      angle2: angle2,
      spacing: spacing,
      fillAlpha: random(0.6, 0.9)
    }));
    latticesCompleted++;
  } else if (r < 0.6) {
    const anims = lineAnims;
    anims.push(new SpiralAnim(A.x, A.y, {}));
  } else {
    ornaments.push(new KandinskyShape(A.x, A.y, {}));
  }
}

// —————————————————————————————————————
// ANIMATION CLASSES
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
    // For shapes after the first two, 50% of the time, spawn the shape tangent to the anchor point
    if (this.index > 2 && random() < 0.5) {
      const radius = this.targetSize / 2;
      const angle = random(TWO_PI);
      // The shape's center is offset from the anchor point (x, y)
      // so that the anchor point lies on the shape's final circumference.
      this.x = x + radius * cos(angle);
      this.y = y + radius * sin(angle);
    }

    this.t     = 0;
    // Speed up animation for later shapes, which are smaller and would otherwise feel too slow.
    const maxSpeed = map(this.index, 3, 50, SHAPE_SPEED_MAX, SHAPE_SPEED_MAX * 2.5, true);
    this.speed = random(SHAPE_SPEED_MIN, maxSpeed);
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
            // The second shape's color MUST be unrelated to the first.
            // We'll force a significant hue shift to ensure high contrast.
            let firstColor = firstTwoShapeColors[0];
            let hueShift = random(90, 270); // Force a shift of at least a triad (90) up to almost complementary (270)
            let newHue = (hue(firstColor) + hueShift) % 360;

            // Keep saturation and lightness high for vibrancy
            let newSaturation = random(70, 100);
            let newLightness = random(50, 85);

            selectedColor = color(newHue, newSaturation, newLightness);
        }
        this.c = selectedColor;
        this.c2 = selectedColor; // c2 isn't used in open shapes, but keep it consistent.
        firstTwoShapeColors.push(this.c);

    } else {
        // For all other shapes, introduce much more color variety.
        if (colorfulPalette.length > 0) {
            this.c = generateShapeColor(colorfulPalette);
            this.c2 = generateShapeColor(colorfulPalette, this.c);
        } else {
            // Failsafe: generate two random vibrant colors if the filtered palette is empty.
            this.c = generateShapeColor(null);
            this.c2 = generateShapeColor(null, this.c);
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
        "openRect", "openTriangle", "openSemiCircle", "openSemiCircle", "openSemiCircle",
        // Weight the 'halo' style to make it appear.
        "halo", "halo",
        "concentricCircle", "concentricArc", "squiggle",
        "arc"
      ];
      this.rawType = random(styles);
    }
        this.useAdditiveBlend = false; // FEATURE DISABLED: Additive blend mode was causing disruptive glowing.

    // normalize type/style
    if (this.rawType === "concentricCircle" || this.rawType === "concentricArc") {
      this.type = this.rawType;
      this.style = "normal";
      this.rings = floor(this.targetSize / (this.diff * 2));
      this.concentricColors = [];
      for (let i = 0; i < this.rings; i++) {
        this.concentricColors.push(generateShapeColor(this.palette, i > 0 ? this.concentricColors[i-1] : null));
      }
    } else if(this.rawType==="halo"){
      this.type="circle"; 
      this.style="halo";
      this.useAdditiveBlend = false; // <-- KEY CHANGE: Disable glowing effect.
      this.rings = floor(random(3, 6));
      this.haloColors = [];
      this.haloGradientAngles = [];

      const haloPalette = this.palette.filter(c => brightness(c) < 75 && saturation(c) > 30);
      const colorSource = haloPalette.length > 0 ? haloPalette : this.palette;

      for (let i = 0; i < this.rings; i++) {
        // Use the global, dynamic color generator for maximum variety
        const newColor = generateShapeColor(colorSource, this.haloColors[i-1]);
        this.haloColors.push(newColor);
        this.haloGradientAngles.push(random(TWO_PI));
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
    else if(this.rawType==="openSemiCircle"){
      this.type="semiCircle"; this.style="open";
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
function reset() {
  skeletons = [];
  ornaments = [];
  lineAnims = [];
  latticeAnims = [];
  foregroundAnims = [];
  thickStrokeCount = 0;
  latticesCompleted = 0;
  compositionFinished = false;
  shapeCounter = 0;
  currentElementCount = 0;
  firstTwoShapeColors = [];
  palette = getPalette();
  if (lineLayer) lineLayer.clear();
  if (foregroundLayer) foregroundLayer.clear();

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
    let r = random();

    // 80% chance of a completely random "rogue" color
    if (!palette || r < 0.8) {
        newColor = color(random(360), random(50, 100), random(40, 90));
    }
    // 20% chance of picking directly from the palette
    else {
        newColor = random(palette);
    }

    // If the generated color matches the one to avoid, deterministically change it.
    // This is much faster than a loop and guarantees no performance hit.
    if (colorToAvoid && newColor.toString() === colorToAvoid.toString()) {
        return color((hue(newColor) + 80) % 360, constrain(saturation(newColor) * 0.85, 40, 100), constrain(lightness(newColor) * 1.15, 30, 90));
    }

    return newColor;
}

function getPalette() {
  let baseHue = random(360);
  let scheme = random(['mono', 'comp', 'split', 'triad', 'analog']);
  let p = [];
  
  // Expanded saturation and lightness ranges for more variety
  const satMin = 40, satMax = 95;
  const lightMin = 30, lightMax = 90;

  if (scheme === 'mono') {
    for (let i = 0; i < 5; i++) p.push(color(baseHue, random(satMin, satMax), random(lightMin, lightMax)));
  } else if (scheme === 'comp') {
    for (let i = 0; i < 5; i++) p.push(color((baseHue + (i % 2) * 180) % 360, random(satMin, satMax), random(lightMin, lightMax)));
  } else if (scheme === 'split') {
    for (let i = 0; i < 5; i++) p.push(color((baseHue + (i % 3 > 0 ? 150 : 0) + (i % 3 === 2 ? 60 : 0)) % 360, random(satMin, satMax), random(lightMin, lightMax)));
  } else if (scheme === 'triad') {
    for (let i = 0; i < 5; i++) p.push(color((baseHue + (i % 3) * 120) % 360, random(satMin, satMax), random(lightMin, lightMax)));
  } else { // Analogous
    for (let i = 0; i < 5; i++) p.push(color((baseHue + (i - 2) * 30 + 360) % 360, random(satMin, satMax), random(lightMin, lightMax)));
  }
  return p;
}

// —————————————————————————————————————
// BACKGROUND GENERATION (from sketchIOS2.0)
// —————————————————————————————————————

function generateWatercolorBackground(pg) {
  pg.push();
  pg.colorMode(HSB, 360, 100, 100, 100);
  pg.angleMode(DEGREES);

  pg.blendMode(pg.BLEND);
  pg.background(40, 20, 90);
  pg.blendMode(pg.MULTIPLY);

  const numSplotches = pg.floor(pg.random(4, 10));
  const arr_num = 150; // Number of shapes per splotch for texture
  
  const placedSplotches = [];
  const maxAttempts = 20; // Max attempts to find a non-overlapping spot

  const boldCount = floor(random(1)); // 1 or 2
  let boldIndices = [];
  for (let j = 0; j < boldCount; j++) {
    let index;
    do {
      index = floor(random(numSplotches));
    } while (boldIndices.includes(index));
    boldIndices.push(index);
  }

  for (let i = 0; i < numSplotches; i++) {
    // Inverse size scaling: more splotches = smaller radius.
    // Map number of splotches (4-10) to a radius range.
    const baseRadius = pg.map(numSplotches, 4, 10, BASE_UNIT * 0.22, BASE_UNIT * 0.08);
    const radius = pg.random(baseRadius * 0.85, baseRadius * 1.15); // Add variation

    let zone_x, zone_y;

    // Attempt to find a good position that doesn't overlap too much
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      zone_x = pg.random(radius, pg.width - radius); // Stay within bounds
      zone_y = pg.random(radius, pg.height - radius);
      let isOverlapping = false;
      for (const s of placedSplotches) {
        const d = pg.dist(zone_x, zone_y, s.x, s.y);
        // Allow some overlap, but prevent major collisions.
        if (d < (radius + s.radius) * 0.65) { 
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

    pg.push();
    pg.translate(zone_x, zone_y);
    
    for (let k = 0; k < arr_num; k++) {
      let angle_sep = pg.int(3, pg.noise(k) * 7);
      let points = createShape(radius, angle_sep, pg); // Use the new dynamic radius
      let form = transformShape(points, 4, 0.5, pg);
      arr.push(form);
    }
    
    for (let form of arr) {
      let std = radius / 10;
      pg.push();
      pg.translate(pg.randomGaussian(0, std), pg.randomGaussian(0, std));
      let alpha = (100 / arr_num) * 2;
      let saturation = 80;

      if (boldIndices.includes(i)) {
        // This is a 'bold' splotch
        alpha *= 2.5; // Make it more opaque
        saturation = 100; // Max saturation
      }

      drawShape(form, pg.color(pg.randomGaussian(zone_hue, 5), saturation, 90, alpha), pg);
      pg.pop();
    }
    pg.pop();
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
    pg.fill(col);
    pg.noStroke();
    pg.beginShape();
    for (let p of points) {
        pg.vertex(p.x, p.y);
    }
    pg.endShape(pg.CLOSE);
}