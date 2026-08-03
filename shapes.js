// Shape classes for gallery reproduction
// Extracted from main sketch for live composition recreation

console.log('🎨 shapes.js loading...');

// Wait for p5.js to load if not available yet
function waitForP5() {
  if (typeof p5 === 'undefined' || typeof window.p5 === 'undefined') {
    console.log('⏳ Waiting for p5.js to load...');
    setTimeout(waitForP5, 100);
    return;
  }
  console.log('✅ p5.js library available in shapes.js');
  initializeShapes();
}

// Initialize shapes after p5.js is ready
function initializeShapes() {

class KandinskyShape {
  constructor(report) {
    // Reconstruct from saved report data
    this.x = report.x;
    this.y = report.y;
    this.anchorId = report.anchorId;
    this.index = report.index;
    this.targetSize = report.targetSize;
    this.t = 1; // Set to complete for static display
    this.speed = report.speed;
    // Store color data as raw values, will be converted to p5 colors in display method
    this.cData = report.c;
    this.c2Data = report.c2;
    this.rot = report.rot;
    this.sw = report.sw;
    this.rawType = report.rawType;
    this.type = report.type;
    this.style = report.style;
    this.useAdditiveBlend = report.useAdditiveBlend;
    
    // Reconstruct type-specific properties
    if (this.type === "concentricCircle") {
      this.rings = report.rings;
      this.diff = report.diff;
      this.concentricColorsData = report.concentricColors;
    } else if (this.type === "concentricArc") {
      this.rings = report.rings;
      this.diff = report.diff;
      this.arcStart = report.arcStart;
      this.arcSweep = report.arcSweep;
      this.concentricColorsData = report.concentricColors;
    } else if (this.style === "halo") {
      this.rings = report.rings;
      this.haloColorsData = report.haloColors;
      this.haloGradientAngles = report.haloGradientAngles;
    } else if (this.style === "open") {
      this.gradientAngle = report.gradientAngle;
    } else if (this.type === "squiggle") {
      this.sv = report.sv;
    }
  }

  display(graphics, scaleFactor = 1) {
    const g = graphics || window;
    
    // Convert stored color data to p5 colors for this render
    this.c = this.convertColor(g, this.cData);
    this.c2 = this.convertColor(g, this.c2Data);
    
    if (this.concentricColorsData) {
      this.concentricColors = this.concentricColorsData.map(c => this.convertColor(g, c));
    }
    if (this.haloColorsData) {
      this.haloColors = this.haloColorsData.map(c => this.convertColor(g, c));
    }
    
    g.push();
    g.translate(this.x * scaleFactor, this.y * scaleFactor);
    g.rotate(this.rot);
    
    const size = this.targetSize * this.t * scaleFactor;
    
    if (this.type === "circle") {
      if (this.style === "halo") {
        this.drawHaloCircle(g, size);
      } else {
        this.drawCircle(g, size);
      }
    } else if (this.type === "rect") {
      this.drawRect(g, size);
    } else if (this.type === "triangle") {
      this.drawTriangle(g, size);
    } else if (this.type === "semiCircle") {
      this.drawSemiCircle(g, size);
    } else if (this.type === "concentricCircle") {
      this.drawConcentricCircle(g, size);
    } else if (this.type === "concentricArc") {
      this.drawConcentricArc(g, size);
    } else if (this.type === "squiggle") {
      this.drawSquiggle(g, size);
    }
    
    g.pop();
  }
  
  convertColor(g, colorData) {
    if (!colorData) return g.color(255);
    if (colorData.levels) {
      // Color data with levels array (RGBA)
      return g.color(colorData.levels[0], colorData.levels[1], colorData.levels[2], colorData.levels[3] || 255);
    } else if (typeof colorData === 'object' && colorData.r !== undefined) {
      // Color data with r,g,b properties
      return g.color(colorData.r, colorData.g, colorData.b, colorData.a || 255);
    } else {
      // Fallback for other formats
      return g.color(colorData);
    }
  }

  drawHaloCircle(g, size) {
    const numCircles = this.rings;
    const baseRadius = size / 2;
    
    for (let i = 0; i < numCircles; i++) {
      const radius = baseRadius * (1 - i * 0.15);
      
      if (i === 0) {
        // Outermost circle with subtle radial gradient
        const gradientSteps = 20;
        for (let j = 0; j < gradientSteps; j++) {
          const alpha = map(j, 0, gradientSteps - 1, 40, 10);
          const currentRadius = radius * (1 + j * 0.02);
          g.fill(red(this.haloColors[i]), green(this.haloColors[i]), blue(this.haloColors[i]), alpha);
          g.noStroke();
          g.ellipse(0, 0, currentRadius * 2);
        }
      } else {
        // Inner rings - solid muted colors
        const mutedColor = color(
          hue(this.haloColors[i]),
          saturation(this.haloColors[i]) * 0.6,
          brightness(this.haloColors[i]) * 0.8
        );
        g.fill(mutedColor);
        g.stroke(0);
        g.strokeWeight(this.sw);
        g.ellipse(0, 0, radius * 2);
      }
    }
  }

  drawCircle(g, size) {
    g.fill(this.c);
    g.stroke(0);
    g.strokeWeight(this.sw);
    g.ellipse(0, 0, size);
  }

  drawRect(g, size) {
    if (this.style === "open") {
      this.drawOpenRect(g, size);
    } else {
      g.fill(this.c);
      g.stroke(0);
      g.strokeWeight(this.sw);
      g.rect(-size/2, -size/2, size, size);
    }
  }

  drawTriangle(g, size) {
    if (this.style === "open") {
      this.drawOpenTriangle(g, size);
    } else {
      g.fill(this.c);
      g.stroke(0);
      g.strokeWeight(this.sw);
      g.triangle(-size/2, size/2, size/2, size/2, 0, -size/2);
    }
  }

  drawSemiCircle(g, size) {
    if (this.style === "open") {
      this.drawOpenSemiCircle(g, size);
    } else {
      g.fill(this.c);
      g.stroke(0);
      g.strokeWeight(this.sw);
      g.arc(0, 0, size, size, 0, PI);
    }
  }

  drawConcentricCircle(g, size) {
    for (let i = 0; i < this.rings; i++) {
      const radius = size - i * this.diff;
      if (radius > 0) {
        g.fill(this.concentricColors[i]);
        g.stroke(0);
        g.strokeWeight(this.sw);
        g.ellipse(0, 0, radius);
      }
    }
  }

  drawConcentricArc(g, size) {
    for (let i = 0; i < this.rings; i++) {
      const radius = size - i * this.diff;
      if (radius > 0) {
        g.fill(this.concentricColors[i]);
        g.stroke(0);
        g.strokeWeight(this.sw);
        g.arc(0, 0, radius, radius, this.arcStart, this.arcStart + this.arcSweep);
      }
    }
  }

  drawOpenRect(g, size) {
    // Create gradient from solid to transparent
    const steps = 20;
    for (let i = 0; i < steps; i++) {
      const alpha = map(i, 0, steps - 1, 255, 0);
      g.fill(red(this.c), green(this.c), blue(this.c), alpha);
      g.noStroke();
      const currentSize = size * (1 - i * 0.02);
      g.rect(-currentSize/2, -currentSize/2, currentSize, currentSize);
    }
    g.stroke(0);
    g.strokeWeight(this.sw);
    g.noFill();
    g.rect(-size/2, -size/2, size, size);
  }

  drawOpenTriangle(g, size) {
    // Create gradient from solid to transparent
    const steps = 20;
    for (let i = 0; i < steps; i++) {
      const alpha = map(i, 0, steps - 1, 255, 0);
      g.fill(red(this.c), green(this.c), blue(this.c), alpha);
      g.noStroke();
      const currentSize = size * (1 - i * 0.02);
      g.triangle(-currentSize/2, currentSize/2, currentSize/2, currentSize/2, 0, -currentSize/2);
    }
    g.stroke(0);
    g.strokeWeight(this.sw);
    g.noFill();
    g.triangle(-size/2, size/2, size/2, size/2, 0, -size/2);
  }

  drawOpenSemiCircle(g, size) {
    // Create gradient from solid to transparent
    const steps = 20;
    for (let i = 0; i < steps; i++) {
      const alpha = map(i, 0, steps - 1, 255, 0);
      g.fill(red(this.c), green(this.c), blue(this.c), alpha);
      g.noStroke();
      const currentSize = size * (1 - i * 0.02);
      g.arc(0, 0, currentSize, currentSize, 0, PI);
    }
    g.stroke(0);
    g.strokeWeight(this.sw);
    g.noFill();
    g.arc(0, 0, size, size, 0, PI);
  }

  drawSquiggle(g, size) {
    g.stroke(this.c);
    g.strokeWeight(this.sw);
    g.noFill();
    g.beginShape();
    for (let i = 0; i < this.sv.length; i++) {
      g.vertex(this.sv[i].x * size, this.sv[i].y * size);
    }
    g.endShape();
  }
}

// Verify KandinskyShape is available globally
console.log('🔍 KandinskyShape class defined:', typeof KandinskyShape);
console.log('🔍 KandinskyShape available in window:', typeof window.KandinskyShape);

// Animation classes for lines/lattices (simplified for static display)
class LatticeAnim {
  constructor(report) {
    this.x = report.x;
    this.y = report.y;
    this.cells = report.cells;
  }

  display(graphics, scaleFactor = 1) {
    const g = graphics || window;
    
    g.push();
    g.translate(this.x * scaleFactor, this.y * scaleFactor);
    
    // Draw all cells
    this.cells.forEach(cell => {
      g.fill(color(cell.color));
      g.stroke(0);
      g.strokeWeight(2 * scaleFactor);
      g.beginShape();
      cell.points.forEach(pt => {
        g.vertex(pt.x * scaleFactor, pt.y * scaleFactor);
      });
      g.endShape(CLOSE);
    });
    
    g.pop();
  }
}

class LineAnim {
  constructor(report) {
    this.x1 = report.x1;
    this.y1 = report.y1;
    this.x2 = report.x2;
    this.y2 = report.y2;
    this.c = color(report.c);
    this.sw = report.sw;
  }

  display(graphics, scaleFactor = 1) {
    const g = graphics || window;
    g.stroke(this.c);
    g.strokeWeight(this.sw * scaleFactor);
    g.line(this.x1 * scaleFactor, this.y1 * scaleFactor, 
           this.x2 * scaleFactor, this.y2 * scaleFactor);
  }
}

class BezierAnim {
  constructor(report) {
    this.pts = report.points.map(p => ({x: p.x, y: p.y}));
    this.c = color(report.c);
    this.sw = report.sw;
  }

  display(graphics, scaleFactor = 1) {
    const g = graphics || window;
    g.stroke(this.c);
    g.strokeWeight(this.sw * scaleFactor);
    g.noFill();
    
    if (this.pts.length >= 4) {
      g.bezier(
        this.pts[0].x * scaleFactor, this.pts[0].y * scaleFactor,
        this.pts[1].x * scaleFactor, this.pts[1].y * scaleFactor,
        this.pts[2].x * scaleFactor, this.pts[2].y * scaleFactor,
        this.pts[3].x * scaleFactor, this.pts[3].y * scaleFactor
      );
    }
  }
}

class ArcAnim {
  constructor(report) {
    this.x = report.x;
    this.y = report.y;
    this.radius = report.radius;
    this.startAngle = report.startAngle;
    this.endAngle = report.endAngle;
    this.c = color(report.c);
    this.sw = report.sw;
  }

  display(graphics, scaleFactor = 1) {
    const g = graphics || window;
    g.stroke(this.c);
    g.strokeWeight(this.sw * scaleFactor);
    g.noFill();
    g.arc(this.x * scaleFactor, this.y * scaleFactor, 
          this.radius * 2 * scaleFactor, this.radius * 2 * scaleFactor,
          this.startAngle, this.endAngle);
  }
}

class SpiralAnim {
  constructor(report) {
    this.x = report.x;
    this.y = report.y;
    this.points = report.points;
    this.c = color(report.c);
    this.sw = report.sw;
  }

  display(graphics, scaleFactor = 1) {
    const g = graphics || window;
    g.stroke(this.c);
    g.strokeWeight(this.sw * scaleFactor);
    g.noFill();
    g.beginShape();
    this.points.forEach(pt => {
      g.vertex(pt.x * scaleFactor, pt.y * scaleFactor);
    });
    g.endShape();
  }
}

  // Make all classes globally available
  window.KandinskyShape = KandinskyShape;
  window.LatticeAnim = LatticeAnim;
  window.LineAnim = LineAnim;
  window.BezierAnim = BezierAnim;
  window.ArcAnim = ArcAnim;
  window.SpiralAnim = SpiralAnim;

  // Final verification that all classes are loaded
  console.log('🎨 shapes.js fully loaded!');
  console.log('🔍 Available shape classes:', {
    KandinskyShape: typeof KandinskyShape,
    LatticeAnim: typeof LatticeAnim,
    LineAnim: typeof LineAnim,
    BezierAnim: typeof BezierAnim,
    ArcAnim: typeof ArcAnim,
    SpiralAnim: typeof SpiralAnim
  });
  console.log('🔍 KandinskyShape available in window:', typeof window.KandinskyShape);
}

// Start the initialization process
waitForP5();
