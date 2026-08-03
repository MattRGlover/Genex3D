/**
 * Gallery Renderer - Intermediary layer for reconstructing and rendering scene reports
 * Provides a unified interface for drawing all elements (shapes, lines, lattices) from scene reports
 */

class GalleryRenderer {
  constructor(p5Instance) {
    this.p = p5Instance;
  }

  /**
   * Main entry point for rendering a scene report
   * Automatically detects pixel bitmap data and uses it for perfect fidelity
   */
  async renderSceneReport(report, scaleFactor) {
    console.log('🎨 GalleryRenderer: Starting scene report rendering');
    
    // Debug: Log what's in the report
    console.log('🔍 Report structure:', {
      captureMethod: report.captureMethod,
      version: report.version,
      hasPixelBitmap: !!report.pixelBitmap,
      hasPixelBitmapUrl: !!report.pixelBitmapUrl,
      pixelBitmapSize: report.pixelBitmapSize,
      id: report.id
    });
    
    // Check if this is a pixel bitmap composition (version 2.0+)
    if (report.captureMethod === 'pixel_bitmap') {
      
      // Check if pixel bitmap data is directly available (legacy format)
      if (report.pixelBitmap) {
        console.log('🎯 Detected inline pixel bitmap data - using pixel-perfect rendering');
        console.log(`📊 Pixel bitmap: ${report.pixelBitmap.width}x${report.pixelBitmap.height} pixels`);
        
        this.renderFromPixelBitmap(report.pixelBitmap, this.p.width, this.p.height);
        return;
      }
      
      // Check if pixel bitmap is stored in Firebase Storage (new format)
      if (report.pixelBitmapUrl) {
        console.log('🎯 Detected pixel bitmap URL - loading from Firebase Storage');
        console.log(`📊 Expected size: ${report.pixelBitmapSize.width}x${report.pixelBitmapSize.height} pixels`);
        console.log(`📥 Loading from: ${report.pixelBitmapUrl}`);
        
        try {
          // Load pixel bitmap from Firebase Storage
          const response = await fetch(report.pixelBitmapUrl);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          const pixelBitmapData = await response.json();
          console.log(`✅ Pixel bitmap loaded: ${pixelBitmapData.width}x${pixelBitmapData.height} = ${pixelBitmapData.pixels.length} pixels`);
          
          this.renderFromPixelBitmap(pixelBitmapData, this.p.width, this.p.height);
          return;
          
        } catch (error) {
          console.error('❌ Failed to load pixel bitmap from Storage:', error);
          console.log('⚠️ Falling back to legacy shape reconstruction');
        }
      }
    }
    
    // Fallback to legacy shape-based rendering for older compositions or errors
    console.log('⚠️ No pixel bitmap data found - falling back to legacy shape reconstruction');
    console.log('📋 This composition was created with the old shape-based system');
    
    this.renderLegacyShapeReport(report, scaleFactor);
  }
  
  /**
   * Legacy shape-based rendering for older compositions
   */
  renderLegacyShapeReport(report, scaleFactor) {
    console.log('🔄 Using legacy shape-based rendering');
    
    // Render background if available
    if (report.backgroundImageData) {
      this.renderBackground(report.backgroundImageData, scaleFactor);
    }

    // Render all shapes (skeletons + ornaments)
    const allShapes = [...(report.skeletons || []), ...(report.ornaments || [])];
    console.log(`🎨 Rendering ${allShapes.length} shapes`);
    allShapes.forEach((shapeReport, index) => {
      this.renderShape(shapeReport, scaleFactor, index);
    });

    // Render all lines
    if (report.lines && report.lines.length > 0) {
      console.log(`🎨 Rendering ${report.lines.length} lines`);
      report.lines.forEach((lineReport, index) => {
        this.renderLine(lineReport, scaleFactor, index);
      });
    }

    // Render beziers
    if (report.beziers && report.beziers.length > 0) {
      console.log(`🎨 Rendering ${report.beziers.length} beziers`);
      report.beziers.forEach((bezierReport, index) => {
        this.renderBezier(bezierReport, scaleFactor, index);
      });
    }

    // Render arcs
    if (report.arcs && report.arcs.length > 0) {
      console.log(`🎨 Rendering ${report.arcs.length} arcs`);
      report.arcs.forEach((arcReport, index) => {
        this.renderArc(arcReport, scaleFactor, index);
      });
    }

    // Render spirals
    if (report.spirals && report.spirals.length > 0) {
      console.log(`🎨 Rendering ${report.spirals.length} spirals`);
      report.spirals.forEach((spiralReport, index) => {
        this.renderSpiral(spiralReport, scaleFactor, index);
      });
    }

    // Render lattices
    if (report.lattices && report.lattices.length > 0) {
      console.log(`🎨 Rendering ${report.lattices.length} lattices`);
      report.lattices.forEach((latticeReport, index) => {
        this.renderLattice(latticeReport, scaleFactor, index);
      });
    }

    console.log('✅ Legacy shape-based rendering complete');
  }

  /**
   * Render composition from pixel bitmap data for perfect fidelity
   */
  renderFromPixelBitmap(pixelBitmap, targetWidth, targetHeight) {
    console.log(`🖼️ Rendering pixel bitmap: ${pixelBitmap.width}x${pixelBitmap.height} to canvas: ${this.p.width}x${this.p.height}`);
    
    // Don't resize canvas - respect the existing canvas size set by the caller
    // Create a temporary canvas at full resolution for high-quality rendering
    const tempCanvas = this.p.createGraphics(pixelBitmap.width, pixelBitmap.height);
    tempCanvas.loadPixels();
    
    // Render each pixel from bitmap at full resolution on temp canvas
    for (let sourceY = 0; sourceY < pixelBitmap.height; sourceY++) {
      for (let sourceX = 0; sourceX < pixelBitmap.width; sourceX++) {
        const sourceIndex = sourceY * pixelBitmap.width + sourceX;
        const hexColor = pixelBitmap.pixels[sourceIndex];
        
        if (!hexColor) continue;
        
        // Parse hex color (format: #rrggbbaa)
        const rgba = this.hexToRgba(hexColor);
        
        // Set pixel on temp canvas
        const targetIndex = (sourceY * pixelBitmap.width + sourceX) * 4;
        
        if (targetIndex >= 0 && targetIndex < tempCanvas.pixels.length - 3) {
          tempCanvas.pixels[targetIndex] = rgba.r;     // R
          tempCanvas.pixels[targetIndex + 1] = rgba.g; // G
          tempCanvas.pixels[targetIndex + 2] = rgba.b; // B
          tempCanvas.pixels[targetIndex + 3] = rgba.a; // A
        }
      }
    }
    
    // Update temp canvas pixels
    tempCanvas.updatePixels();
    
    // Calculate scaling to maintain aspect ratio
    const sourceAspect = pixelBitmap.width / pixelBitmap.height;
    const targetAspect = this.p.width / this.p.height;
    
    let drawWidth, drawHeight, drawX, drawY;
    
    if (sourceAspect > targetAspect) {
      // Source is wider - fit to width
      drawWidth = this.p.width;
      drawHeight = this.p.width / sourceAspect;
      drawX = 0;
      drawY = (this.p.height - drawHeight) / 2;
    } else {
      // Source is taller - fit to height
      drawHeight = this.p.height;
      drawWidth = this.p.height * sourceAspect;
      drawX = (this.p.width - drawWidth) / 2;
      drawY = 0;
    }
    
    // Clear canvas and draw the temp canvas with proper aspect ratio
    this.p.background(255);
    this.p.image(tempCanvas, drawX, drawY, drawWidth, drawHeight);
    
    console.log('✅ Scaled pixel bitmap rendering complete');
  }
  
  /**
   * Convert hex color string to RGBA values
   */
  hexToRgba(hex) {
    if (!hex || !hex.startsWith('#')) {
      return { r: 255, g: 255, b: 255, a: 255 };
    }
    
    const cleanHex = hex.slice(1);
    
    if (cleanHex.length === 8) {
      // #rrggbbaa format
      return {
        r: parseInt(cleanHex.slice(0, 2), 16),
        g: parseInt(cleanHex.slice(2, 4), 16),
        b: parseInt(cleanHex.slice(4, 6), 16),
        a: parseInt(cleanHex.slice(6, 8), 16)
      };
    } else if (cleanHex.length === 6) {
      // #rrggbb format
      return {
        r: parseInt(cleanHex.slice(0, 2), 16),
        g: parseInt(cleanHex.slice(2, 4), 16),
        b: parseInt(cleanHex.slice(4, 6), 16),
        a: 255
      };
    }
    
    return { r: 255, g: 255, b: 255, a: 255 };
  }

  /**
   * Render background image
   */
  renderBackground(backgroundImageData, scaleFactor) {
    // Background rendering is handled by the main gallery code
    // This is a placeholder for consistency
  }

  /**
   * Render a shape from its report data - matches original display logic
   */
  renderShape(shapeReport, scaleFactor, index) {
    console.log(`🎨 Rendering shape ${index + 1}:`, shapeReport.type, shapeReport.style);
    
    try {
      this.p.push();
      
      // Apply transformations exactly like original
      this.p.translate(shapeReport.x * scaleFactor, shapeReport.y * scaleFactor);
      this.p.rotate(shapeReport.rot || 0);
      
      // Handle additive blending if specified
      if (shapeReport.useAdditiveBlend) {
        this.p.blendMode(this.p.ADD);
      }
      
      // Set stroke properties first (matches original order)
      this.p.stroke(0); // Always black stroke like original
      this.p.strokeWeight((shapeReport.sw || 2) * scaleFactor);
      
      const size = (shapeReport.targetSize || 50) * scaleFactor;
      
      // Render based on shape type and style - matches original logic
      if (shapeReport.type === 'concentricCircle') {
        this.renderConcentricCircle(shapeReport, size, scaleFactor);
      } else if (shapeReport.type === 'concentricArc') {
        this.renderConcentricArc(shapeReport, size, scaleFactor);
      } else if (shapeReport.style === 'halo') {
        this.renderHaloShape(shapeReport, size, scaleFactor);
      } else if (shapeReport.style === 'open') {
        this.renderOpenShape(shapeReport, size, scaleFactor);
      } else if (shapeReport.type === 'squiggle') {
        this.renderSquiggle(shapeReport, size, scaleFactor);
      } else {
        // Default shape rendering
        this.renderBasicShape(shapeReport, size, scaleFactor);
      }
      
      // Reset blend mode
      if (shapeReport.useAdditiveBlend) {
        this.p.blendMode(this.p.BLEND);
      }
      
      this.p.pop();
      console.log(`✅ Successfully rendered shape ${index + 1}`);
      
    } catch (error) {
      console.error(`❌ Error rendering shape ${index + 1}:`, error);
    }
  }

  /**
   * Render basic shapes (triangle, square, rectangle, circle) - matches original
   */
  renderBasicShape(shapeReport, size, scaleFactor) {
    const type = shapeReport.rawType || shapeReport.type;
    
    // Set fill color for basic shapes
    const fillColor = this.parseColor(shapeReport.c);
    this.p.fill(fillColor);
    
    switch (type) {
      case 'triangle':
        this.p.triangle(-size/2, size/2, size/2, size/2, 0, -size/2);
        break;
      case 'square':
        this.p.rect(-size/2, -size/2, size, size);
        break;
      case 'rectangle':
        this.p.rect(-size/2, -size/2, size, size * 0.6);
        break;
      case 'circle':
        this.p.circle(0, 0, size);
        break;
      case 'halfCircle':
      case 'semiCircle':
        this.p.arc(0, 0, size, size, 0, this.p.PI);
        break;
      default:
        // Fallback to circle
        this.p.circle(0, 0, size);
    }
  }

  /**
   * Render concentric circles - matches original logic
   */
  renderConcentricCircle(shapeReport, size, scaleFactor) {
    const rings = shapeReport.rings || 3;
    const diff = (shapeReport.diff || 10) * scaleFactor;
    const colors = shapeReport.concentricColors || [];
    
    for (let i = 0; i < rings; i++) {
      const ringSize = size - (i * diff);
      if (ringSize > 0) {
        if (colors[i]) {
          this.p.fill(this.parseColor(colors[i]));
        } else {
          // Fallback to main color if no concentric color available
          this.p.fill(this.parseColor(shapeReport.c));
        }
        this.p.stroke(0);
        this.p.strokeWeight((shapeReport.sw || 2) * scaleFactor);
        this.p.circle(0, 0, ringSize);
      }
    }
  }

  /**
   * Render concentric arcs
   */
  renderConcentricArc(shapeReport, size) {
    const rings = shapeReport.rings || 3;
    const diff = shapeReport.diff || 10;
    const colors = shapeReport.concentricColors || [];
    const arcStart = shapeReport.arcStart || 0;
    const arcSweep = shapeReport.arcSweep || this.p.PI;
    
    for (let i = 0; i < rings; i++) {
      const ringSize = size - (i * diff);
      if (ringSize > 0) {
        if (colors[i]) {
          this.p.fill(this.parseColor(colors[i]));
        }
        this.p.arc(0, 0, ringSize, ringSize, arcStart, arcStart + arcSweep);
      }
    }
  }

  /**
   * Render halo shapes
   */
  renderHaloShape(shapeReport, size) {
    // Simplified halo rendering - draw the base shape with a gradient effect
    this.renderBasicShape(shapeReport, size);
    
    // Add halo rings if available
    if (shapeReport.haloColors && shapeReport.rings) {
      const rings = shapeReport.rings;
      const haloColors = shapeReport.haloColors;
      
      for (let i = 0; i < rings; i++) {
        const ringSize = size + (i * 15);
        if (haloColors[i]) {
          this.p.fill(this.parseColor(haloColors[i]));
          this.p.circle(0, 0, ringSize);
        }
      }
    }
  }

  /**
   * Render open shapes with gradients
   */
  renderOpenShape(shapeReport, size) {
    // For open shapes, render the basic shape but with modified fill
    this.renderBasicShape(shapeReport, size);
  }

  /**
   * Render squiggle shapes
   */
  renderSquiggle(shapeReport, size) {
    // Simplified squiggle - draw a wavy line
    this.p.noFill();
    this.p.beginShape();
    for (let i = 0; i < 20; i++) {
      const x = (i / 19) * size - size/2;
      const y = this.p.sin(i * 0.5) * (size * 0.2);
      this.p.vertex(x, y);
    }
    this.p.endShape();
  }

  /**
   * Render a line from its report data
   */
  renderLine(lineReport, scaleFactor, index) {
    console.log(`🎨 Rendering line ${index + 1}:`, lineReport.lineType);
    
    try {
      this.p.push();
      
      // Set line properties
      const color = this.parseColor(lineReport.color);
      this.p.stroke(color);
      this.p.strokeWeight((lineReport.strokeWeight || 2) * scaleFactor);
      
      // Render based on line type
      if (lineReport.lineType === 'LineAnim' && lineReport.points) {
        const p1 = lineReport.points[0];
        const p2 = lineReport.points[1];
        this.p.line(
          p1.x * scaleFactor, p1.y * scaleFactor,
          p2.x * scaleFactor, p2.y * scaleFactor
        );
      }
      
      this.p.pop();
      console.log(`✅ Successfully rendered line ${index + 1}`);
      
    } catch (error) {
      console.error(`❌ Error rendering line ${index + 1}:`, error);
    }
  }

  /**
   * Render a bezier curve from its report data
   */
  renderBezier(bezierReport, scaleFactor, index) {
    console.log(`🎨 Rendering bezier ${index + 1}`);
    
    try {
      this.p.push();
      
      const color = this.parseColor(bezierReport.color);
      this.p.stroke(color);
      this.p.strokeWeight((bezierReport.strokeWeight || 2) * scaleFactor);
      this.p.noFill();
      
      if (bezierReport.points && bezierReport.points.length >= 4) {
        const pts = bezierReport.points;
        this.p.bezier(
          pts[0].x * scaleFactor, pts[0].y * scaleFactor,
          pts[1].x * scaleFactor, pts[1].y * scaleFactor,
          pts[2].x * scaleFactor, pts[2].y * scaleFactor,
          pts[3].x * scaleFactor, pts[3].y * scaleFactor
        );
      }
      
      this.p.pop();
      console.log(`✅ Successfully rendered bezier ${index + 1}`);
      
    } catch (error) {
      console.error(`❌ Error rendering bezier ${index + 1}:`, error);
    }
  }

  /**
   * Render an arc from its report data
   */
  renderArc(arcReport, scaleFactor, index) {
    console.log(`🎨 Rendering arc ${index + 1}`);
    
    try {
      this.p.push();
      
      const color = this.parseColor(arcReport.color);
      this.p.stroke(color);
      this.p.strokeWeight((arcReport.strokeWeight || 2) * scaleFactor);
      this.p.noFill();
      
      this.p.arc(
        arcReport.cx * scaleFactor,
        arcReport.cy * scaleFactor,
        arcReport.r * 2 * scaleFactor,
        arcReport.r * 2 * scaleFactor,
        arcReport.start,
        arcReport.start + arcReport.sweep
      );
      
      this.p.pop();
      console.log(`✅ Successfully rendered arc ${index + 1}`);
      
    } catch (error) {
      console.error(`❌ Error rendering arc ${index + 1}:`, error);
    }
  }

  /**
   * Render a spiral from its report data
   */
  renderSpiral(spiralReport, scaleFactor, index) {
    console.log(`🎨 Rendering spiral ${index + 1}`);
    
    try {
      this.p.push();
      
      const color = this.parseColor(spiralReport.color);
      this.p.stroke(color);
      this.p.strokeWeight((spiralReport.strokeWeight || 2) * scaleFactor);
      this.p.noFill();
      
      // Draw spiral
      this.p.beginShape();
      const coils = spiralReport.coils || 3;
      const maxRadius = spiralReport.maxRadius * scaleFactor;
      const centerX = spiralReport.x * scaleFactor;
      const centerY = spiralReport.y * scaleFactor;
      
      for (let i = 0; i <= coils * 20; i++) {
        const angle = (i / 20) * this.p.TWO_PI;
        const radius = (i / (coils * 20)) * maxRadius;
        const x = centerX + this.p.cos(angle) * radius;
        const y = centerY + this.p.sin(angle) * radius;
        this.p.vertex(x, y);
      }
      this.p.endShape();
      
      this.p.pop();
      console.log(`✅ Successfully rendered spiral ${index + 1}`);
      
    } catch (error) {
      console.error(`❌ Error rendering spiral ${index + 1}:`, error);
    }
  }

  /**
   * Render a lattice from its report data
   */
  renderLattice(latticeReport, scaleFactor, index) {
    console.log(`🎨 Rendering lattice ${index + 1}`);
    
    try {
      this.p.push();
      
      // Lattice rendering logic would go here
      // For now, render a placeholder grid
      this.p.stroke(0);
      this.p.strokeWeight(1 * scaleFactor);
      
      const x = latticeReport.x * scaleFactor;
      const y = latticeReport.y * scaleFactor;
      // Use new cellColors and flattened cellPolygonData format for perfect reproduction
      if (latticeReport.cellColors && latticeReport.cellPolygonData && latticeReport.cellCount) {
        console.log(`🎨 Rendering lattice with ${latticeReport.cellColors.length} individual cells`);
        
        // Reconstruct polygons from flattened data (each cell has 4 points)
        const pointsPerCell = 4;
        
        // Render each cell with its exact color and polygon shape
        for (let i = 0; i < latticeReport.cellColors.length; i++) {
          const cellColor = latticeReport.cellColors[i];
          
          // Extract the 4 points for this cell from flattened data
          const startIdx = i * pointsPerCell;
          const cellPoints = latticeReport.cellPolygonData.slice(startIdx, startIdx + pointsPerCell);
          
          if (cellColor && cellPoints.length === pointsPerCell) {
            this.p.fill(this.parseColor(cellColor));
            this.p.stroke(0);
            this.p.strokeWeight(1.5 * scaleFactor);
            
            this.p.beginShape();
            cellPoints.forEach(point => {
              this.p.vertex(
                (x + point.x) * scaleFactor,
                (y + point.y) * scaleFactor
              );
            });
            this.p.endShape(this.p.CLOSE);
          }
        }
      } else {
        // Fallback to old grid method if new format not available
        const w = latticeReport.w * scaleFactor;
        const h = latticeReport.h * scaleFactor;
        const cols = latticeReport.cols || 5;
        const rows = latticeReport.rows || 5;
        
        const cellW = w / cols;
        const cellH = h / rows;
        
        for (let i = 0; i < cols; i++) {
          for (let j = 0; j < rows; j++) {
            const cellX = x + i * cellW;
            const cellY = y + j * cellH;
            
            this.p.fill(this.p.random(255), this.p.random(255), this.p.random(255));
            this.p.rect(cellX, cellY, cellW, cellH);
          }
        }
      }
      
      this.p.pop();
      console.log(`✅ Successfully rendered lattice ${index + 1}`);
      
    } catch (error) {
      console.error(`❌ Error rendering lattice ${index + 1}:`, error);
    }
  }

  /**
   * Parse color data to p5.js color - matches original convertColor method
   */
  parseColor(colorData) {
    if (!colorData) {
      return this.p.color(255);
    }
    
    try {
      // Handle color data with levels array (RGBA) - matches original
      if (colorData.levels) {
        return this.p.color(
          colorData.levels[0], 
          colorData.levels[1], 
          colorData.levels[2], 
          colorData.levels[3] || 255
        );
      } 
      // Handle color data with r,g,b properties - matches original
      else if (typeof colorData === 'object' && colorData.r !== undefined) {
        return this.p.color(
          colorData.r, 
          colorData.g, 
          colorData.b, 
          colorData.a || 255
        );
      }
      // Handle hex colors with alpha (8 characters: #rrggbbaa)
      else if (typeof colorData === 'string' && colorData.startsWith('#')) {
        if (colorData.length === 9) {
          const r = parseInt(colorData.substr(1, 2), 16);
          const g = parseInt(colorData.substr(3, 2), 16);
          const b = parseInt(colorData.substr(5, 2), 16);
          const a = parseInt(colorData.substr(7, 2), 16);
          return this.p.color(r, g, b, a);
        } else {
          return this.p.color(colorData);
        }
      }
      // Fallback for other formats - matches original
      else {
        return this.p.color(colorData);
      }
    } catch (error) {
      console.warn('🎨 parseColor: Failed to parse color:', colorData, error);
      return this.p.color(255, 0, 0); // Red for debugging
    }
  }
}

// Make GalleryRenderer available globally
window.GalleryRenderer = GalleryRenderer;
