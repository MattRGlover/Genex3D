// Desktop Gallery JavaScript - Pinterest-style Masonry Layout
// Optimized for desktop viewing with responsive columns

console.log('🖥️ Desktop Gallery loading...');

// Firebase and gallery state
let db, storage;
let p5Instance = null;
let currentReport = null;
let galleryListener = null;
let isLoading = false;

// Desktop-specific settings
const DESKTOP_COLUMN_WIDTH = 300;
const DESKTOP_GAP = 20;
const DESKTOP_MODAL_MAX_WIDTH = '90vw';
const DESKTOP_MODAL_MAX_HEIGHT = '90vh';

// DOM elements
const galleryGrid = document.getElementById('gallery-grid');
const modal = document.getElementById('redraw-modal');
const modalContent = document.getElementById('redraw-canvas');
const closeButton = document.querySelector('.close-button');
const downloadStandardBtn = document.getElementById('download-hd');
const downloadHiResBtn = document.getElementById('download-4k');

// Initialize Firebase and load gallery
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Initialize Firebase
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    db = firebase.firestore();
    storage = firebase.storage();
    
    console.log('🔥 Firebase initialized for desktop gallery');
    setupRealtimeDesktopGallery();
  } catch (error) {
    console.error('❌ Error initializing desktop gallery:', error);
    galleryGrid.innerHTML = '<div class="error-item">Failed to load gallery. Please try again.</div>';
  }
});
  
// Set up real-time Firebase listener for desktop gallery
function setupRealtimeDesktopGallery() {
  console.log('🖥️ Setting up real-time desktop gallery sync...');
  
  try {
    // Try multiple collection names for compatibility
    const collectionNames = ['sceneReports', 'scene_reports'];
    const orderFields = ['createdAt', 'timestamp'];
    
    for (const collectionName of collectionNames) {
      console.log(`🖥️ Trying real-time listener for collection: ${collectionName}`);
      
      for (const orderField of orderFields) {
        try {
          galleryListener = db.collection(collectionName)
            .orderBy(orderField, 'desc')
            .limit(100) // More items for desktop masonry
            .onSnapshot((querySnapshot) => {
              console.log('🔄 Desktop gallery data changed - reorganizing masonry...');
              
              if (querySnapshot.empty) {
                galleryGrid.innerHTML = '<div class="error-item">No artwork found in the gallery yet. Go create some!</div>';
                return;
              }
              
              console.log(`✅ Desktop masonry sync active - processing ${querySnapshot.docs.length} compositions`);
              renderDesktopMasonryGallery(querySnapshot);
            }, (error) => {
              console.error('⚠️ Real-time listener failed:', error);
              throw error;
            });
          
          console.log(`✅ Successfully connected to ${collectionName} with ${orderField}`);
          return; // Success, exit loops
          
        } catch (orderError) {
          console.log(`⚠️ Failed to order by ${orderField}:`, orderError.message);
          continue;
        }
      }
    }
    
    throw new Error('All collection and order field combinations failed');
    
  } catch (error) {
    console.error('❌ Error setting up real-time desktop gallery sync:', error);
    // Fallback to sample data
    createSampleDesktopThumbnails();
  }
}
  
  // Render desktop gallery from Firebase snapshot
  async function renderDesktopGallery(querySnapshot) {
    if (!galleryGrid) {
      console.error('Gallery grid element not found.');
      return;
    }
    
    if (isLoading) {
      console.log('Gallery already loading, skipping...');
      return;
    }
    
    isLoading = true;
    galleryGrid.innerHTML = ''; // Clear existing content
    
    try {
      console.log(`🖥️ Rendering desktop gallery with ${querySnapshot.docs.length} compositions...`);
      
      // Stronger deduplication by composition ID and URL
    }
    
    if (isLoading) {
      console.log('Gallery already loading, skipping...');
      return;
    }
    
    isLoading = true;
    galleryGrid.innerHTML = ''; // Clear existing content

    try {
      console.log("Fetching scene reports from Firestore...");
      const snapshot = await db.collection('sceneReports').orderBy('createdAt', 'desc').get();
      
      if (snapshot.empty) {
        galleryGrid.innerHTML = '<p>No artwork found in the gallery yet. Go create some!</p>';
        console.log('No documents found in sceneReports collection.');
        return;
      }

      console.log(`Found ${snapshot.docs.length} documents.`);
      
      // Stronger deduplication by composition ID and URL
      const seenIds = new Set();
      const seenUrls = new Set();
      const uniqueDocs = [];
      
      snapshot.forEach((doc) => {
        const report = doc.data();
        const reportUrl = report.pixelBitmapUrl || report.snapshotUrl;
        
        // Use both ID and URL for deduplication
        const uniqueKey = report.id || reportUrl || doc.id;
        
        if (uniqueKey && !seenIds.has(uniqueKey) && (!reportUrl || !seenUrls.has(reportUrl))) {
          seenIds.add(uniqueKey);
          if (reportUrl) seenUrls.add(reportUrl);
          uniqueDocs.push({doc, report});
        }
      });
      
      console.log(`Found ${snapshot.docs.length} documents, ${uniqueDocs.length} unique compositions.`);
      
      uniqueDocs.forEach(({doc, report}, index) => {
        
        // Clean gallery item creation
        
        const galleryItem = document.createElement('div');
        galleryItem.className = 'gallery-item';
        galleryItem.setAttribute('data-report', JSON.stringify(report)); // Store full report

        // Check if this is a pixel bitmap composition
        if (report.captureMethod === 'pixel_bitmap' && report.pixelBitmapUrl) {
          // Create a canvas thumbnail for pixel bitmap data
          const canvas = document.createElement('canvas');
          canvas.width = 400;
          canvas.height = 300;
          canvas.style.cursor = 'pointer';
          canvas.style.display = 'block';
          canvas.style.margin = '0 auto';
          canvas.style.borderRadius = '8px';
          canvas.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
          
          // Load and render pixel bitmap as thumbnail
          loadPixelBitmapThumbnail(canvas, report.pixelBitmapUrl, report.pixelBitmapSize);
          
          // Add click event directly to canvas for modal preview
          canvas.addEventListener('click', () => {
            console.log('🎨 Canvas thumbnail clicked!');
            console.log('📊 Report data:', report);
            modal.style.display = 'flex';
            redrawArtwork(report, modalContent);
          });
          
          galleryItem.appendChild(canvas);
        } else {
          // Legacy: Use image URL directly (for old compositions)
          const img = document.createElement('img');
          img.src = reportUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="100%" height="100%" fill="%23f0f0f0"/><text x="50%" y="50%" text-anchor="middle" dy=".3em">No Image</text></svg>';
          img.alt = `Artwork generated on ${new Date(report.createdAt.seconds * 1000).toLocaleDateString()}`;
          
          galleryItem.appendChild(img);
        }
        galleryGrid.appendChild(galleryItem);
      });
      
      // Gallery loading complete
    } catch (error) {
      console.error('Error loading gallery:', error);
      galleryGrid.innerHTML = '<p>Error loading gallery. Please try again later.</p>';
    } finally {
      isLoading = false; // Reset loading flag
    }
  }

  // Function to load pixel bitmap data and render as thumbnail
  async function loadPixelBitmapThumbnail(canvas, pixelBitmapUrl, pixelBitmapSize) {
    const ctx = canvas.getContext('2d');
    
    try {
      // Loading pixel bitmap thumbnail
      
      // Show loading state
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#666';
      ctx.font = '14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Loading...', canvas.width / 2, canvas.height / 2);
      
      // Fetch pixel bitmap JSON from Firebase Storage
      const response = await fetch(pixelBitmapUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch pixel bitmap: ${response.status}`);
      }
      
      const pixelBitmap = await response.json();
      console.log(`✅ Loaded pixel bitmap: ${pixelBitmap.width}x${pixelBitmap.height}`);
      
      // Set canvas to fixed 16:9 thumbnail dimensions for consistent grid layout
      const thumbnailWidth = 400;
      const thumbnailHeight = 225; // 400 * (9/16) = 225 for 16:9 ratio
      canvas.width = thumbnailWidth;
      canvas.height = thumbnailHeight;
      
      // Calculate scale to fill thumbnail completely (crop if necessary)
      const scaleX = thumbnailWidth / pixelBitmap.width;
      const scaleY = thumbnailHeight / pixelBitmap.height;
      const scale = Math.max(scaleX, scaleY); // Use max to fill completely
      
      // Calculate actual rendered dimensions (may be larger than thumbnail)
      const scaledWidth = Math.floor(pixelBitmap.width * scale);
      const scaledHeight = Math.floor(pixelBitmap.height * scale);
      const offsetX = (thumbnailWidth - scaledWidth) / 2;
      const offsetY = (thumbnailHeight - scaledHeight) / 2;
      
      // No background fill - let the image fill the entire space
      
      // Create high-resolution intermediate canvas
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = pixelBitmap.width;
      tempCanvas.height = pixelBitmap.height;
      const tempCtx = tempCanvas.getContext('2d');
      
      // Render pixel bitmap at full original resolution on temp canvas
      const imageData = tempCtx.createImageData(pixelBitmap.width, pixelBitmap.height);
      const data = imageData.data;
      
      for (let i = 0; i < pixelBitmap.pixels.length; i++) {
        const hexColor = pixelBitmap.pixels[i];
        const r = parseInt(hexColor.slice(1, 3), 16);
        const g = parseInt(hexColor.slice(3, 5), 16);
        const b = parseInt(hexColor.slice(5, 7), 16);
        const a = parseInt(hexColor.slice(7, 9), 16);
        
        const dataIndex = i * 4;
        data[dataIndex] = r;     // R
        data[dataIndex + 1] = g; // G
        data[dataIndex + 2] = b; // B
        data[dataIndex + 3] = a; // A
      }
      
      tempCtx.putImageData(imageData, 0, 0);
      
      // Enable high-quality scaling
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      // Draw the full-resolution temp canvas scaled and centered in thumbnail
      ctx.drawImage(tempCanvas, offsetX, offsetY, scaledWidth, scaledHeight);
      
      console.log(`✅ Thumbnail rendered successfully`);
      
    } catch (error) {
      console.error('❌ Error loading pixel bitmap thumbnail:', error);
      
      // Show error state
      ctx.fillStyle = '#ffebee';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#c62828';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Error loading', canvas.width / 2, canvas.height / 2 - 10);
      ctx.fillText('thumbnail', canvas.width / 2, canvas.height / 2 + 10);
    }
  }

  // --- Modal & Redraw Logic (variables already declared at top) ---

  function redrawArtwork(report, targetElement) {
    // Clear any previous sketch
    if (p5Instance) {
      p5Instance.remove();
    }
    targetElement.innerHTML = '';

      const sketch = (p) => {
        const originalWidth = report.canvasWidth || 1920;
        const originalHeight = report.canvasHeight || 1080;
        let allShapes = [];
        let backgroundImg = null;

        p.setup = () => {
          const aspectRatio = originalWidth / originalHeight;
          let canvasWidth, canvasHeight;

          // Set a moderate canvas size for the modal preview
          const maxWidth = Math.min(window.innerWidth * 0.6, 800);
          const maxHeight = Math.min(window.innerHeight * 0.5, 600);
          
          // Calculate canvas size to fit within max dimensions while maintaining aspect ratio
          if ((maxWidth / maxHeight) > aspectRatio) {
            canvasHeight = maxHeight;
            canvasWidth = canvasHeight * aspectRatio;
          } else {
            canvasWidth = maxWidth;
            canvasHeight = canvasWidth / aspectRatio;
          }

          console.log(`🎨 Creating canvas: ${canvasWidth}x${canvasHeight} (original: ${originalWidth}x${originalHeight})`);
          p.createCanvas(canvasWidth, canvasHeight);
          
          // Load background image if available (new backgroundUrl format)
          if (report.backgroundUrl) {
            console.log('🎨 Loading background from Firebase Storage URL:', report.backgroundUrl);
            backgroundImg = p.loadImage(report.backgroundUrl, () => {
              console.log('🎨 Background image loaded from URL, redrawing...');
              p.redraw(); // Trigger redraw once background is loaded
            }, (error) => {
              console.error('❌ Failed to load background image:', error);
              p.redraw(); // Still redraw with fallback background
            });
          } else if (report.backgroundImageData) {
            // Fallback for old format (base64 data)
            console.log('🎨 Loading background from base64 data (old format)');
            backgroundImg = p.loadImage(report.backgroundImageData, () => {
              console.log('🎨 Background image loaded from base64, redrawing...');
              p.redraw();
            });
          }
          
          p.noLoop(); // We only need to draw once for a static image
        };

        p.draw = async () => {
          // Use captured background image for pixel-perfect reproduction
          if (backgroundImg) {
            // Draw the exact background from the original composition
            p.image(backgroundImg, 0, 0, p.width, p.height);
            console.log('🎨 Using captured background for pixel-perfect reproduction');
          } else {
            // Fallback to solid background if no image data available
            const bg = report.bgColor?.levels ? p.color(report.bgColor.levels) : p.color(255);
            p.background(bg);
            console.log('⚠️ No background image data found, using fallback');
          }

          // Determine the scale factor
          const scaleFactor = p.width / originalWidth;

          // Debug: Check what's in the report
          console.log('🔍 Gallery Debug - Scene Report Structure:');
          console.log('  ID:', report.id);
          console.log('  Version:', report.version);
          console.log('  Capture Method:', report.captureMethod);
          console.log('  Has pixelBitmap:', !!report.pixelBitmap);
          console.log('  Has pixelBitmapUrl:', !!report.pixelBitmapUrl);
          console.log('  Pixel Bitmap Size:', report.pixelBitmapSize);
          console.log('  Skeletons:', report.skeletons ? report.skeletons.length : 'undefined');
          console.log('  Ornaments:', report.ornaments ? report.ornaments.length : 'undefined');
          console.log('  Lines:', report.lines ? report.lines.length : 'undefined');
          console.log('  Beziers:', report.beziers ? report.beziers.length : 'undefined');
          console.log('  Arcs:', report.arcs ? report.arcs.length : 'undefined');
          console.log('  Spirals:', report.spirals ? report.spirals.length : 'undefined');
          console.log('  Lattices:', report.lattices ? report.lattices.length : 'undefined');
          
          // Use the new GalleryRenderer for unified rendering
          console.log('🎨 Using GalleryRenderer for scene reconstruction');
          
          if (typeof window.GalleryRenderer === 'undefined') {
            console.error('❌ GalleryRenderer not available - gallery-renderer.js may not be loaded');
            return;
          }
          
          // Create renderer instance
          const renderer = new window.GalleryRenderer(p);
          
          // Render the complete scene using the intermediary layer
          try {
            await renderer.renderSceneReport(report, scaleFactor);
            console.log('✅ Scene rendered successfully using GalleryRenderer');
          } catch (error) {
            console.error('❌ Error rendering scene with GalleryRenderer:', error);
          }
        };
      };

      p5Instance = new p5(sketch, targetElement);
    }

    galleryGrid.addEventListener('click', (e) => {
      const item = e.target.closest('.gallery-item');
      if (item) {
        const reportString = item.getAttribute('data-report');
        const report = JSON.parse(reportString);
        console.log("Redrawing report:", report);
        modal.style.display = 'flex';
        redrawArtwork(report, modalContent);
      }
    });

    function closeModal() {
      if (p5Instance) {
        p5Instance.remove();
        p5Instance = null;
      }
      modal.style.display = 'none';
    }

  closeButton.addEventListener('click', closeModal);

  galleryGrid.addEventListener('click', (e) => {
    console.log('🖱️ Gallery click detected:', e.target);
    const item = e.target.closest('.gallery-item');
    if (item) {
      console.log('✅ Gallery item found:', item);
      const reportString = item.getAttribute('data-report');
      const report = JSON.parse(reportString);
      console.log("🎨 Redrawing report:", report);
      modal.style.display = 'flex';
      redrawArtwork(report, modalContent);
    } else {
      console.log('❌ No gallery item found for click target');
    }
  });

  function closeModal() {
    if (p5Instance) {
      p5Instance.remove();
      p5Instance = null;
    }
    modal.style.display = 'none';
  }

  // Modal close event listeners
  closeButton.addEventListener('click', closeModal);

  // Close modal when clicking outside
  window.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Close modal with Escape key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display === 'flex') {
      closeModal();
    }
  });

  // HD/4K Download functionality - currentReport already declared at top

  // Standard Resolution Download (1:1 scaling)
  document.getElementById('download-hd').addEventListener('click', () => {
    if (currentReport) {
      generateHighResDownload(currentReport, null, null, 'Standard');
    }
  });

  // Hi Resolution Download (4:1 scaling)
  document.getElementById('download-4k').addEventListener('click', () => {
    if (currentReport) {
      generateHighResDownload(currentReport, null, null, 'Hi-Res');
    }
  });

  // Generate download with specified scaling mode
  async function generateHighResDownload(report, targetWidth, targetHeight, quality) {
    console.log(`🎨 Generating ${quality} download`);
    
    // Check if we have pixel bitmap data (new format) or need to use legacy shape rendering
    if (report.captureMethod === 'pixel_bitmap' && (report.pixelBitmap || report.pixelBitmapUrl)) {
      // Determine scaling mode based on quality parameter
      if (quality === 'Standard') {
        await generateStandardResDownload(report, quality);
      } else if (quality === 'Hi-Res') {
        await generateHiResDownload(report, quality);
      }
    } else {
      console.log('⚠️ Legacy compositions not supported for downloads - pixel bitmap required');
      alert('This composition was created with an older version and cannot be downloaded.');
    }
  }
  
  // Generate standard resolution download (1:1 scaling - original size)
  async function generateStandardResDownload(report, quality) {
    let pixelBitmapData = null;
    
    // Load pixel bitmap data
    if (report.pixelBitmap) {
      pixelBitmapData = report.pixelBitmap;
    } else if (report.pixelBitmapUrl) {
      try {
        const response = await fetch(report.pixelBitmapUrl);
        pixelBitmapData = await response.json();
      } catch (error) {
        console.error('❌ Failed to load pixel bitmap for download:', error);
        return;
      }
    }
    
    if (!pixelBitmapData) {
      console.error('❌ No pixel bitmap data available for download');
      return;
    }
    
    const sourceWidth = pixelBitmapData.width;
    const sourceHeight = pixelBitmapData.height;
    
    console.log(`📐 Standard Res: ${sourceWidth}x${sourceHeight} (1:1 scaling)`);
    
    // Create canvas at original size
    const canvas = document.createElement('canvas');
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const ctx = canvas.getContext('2d');
    
    // Create ImageData for original size output
    const imageData = ctx.createImageData(sourceWidth, sourceHeight);
    const data = imageData.data;
    
    // Copy pixels directly (1:1)
    for (let y = 0; y < sourceHeight; y++) {
      for (let x = 0; x < sourceWidth; x++) {
        const sourceIndex = y * sourceWidth + x;
        const hexColor = pixelBitmapData.pixels[sourceIndex];
        
        if (!hexColor) continue;
        
        // Parse hex color
        const r = parseInt(hexColor.slice(1, 3), 16);
        const g = parseInt(hexColor.slice(3, 5), 16);
        const b = parseInt(hexColor.slice(5, 7), 16);
        const a = parseInt(hexColor.slice(7, 9), 16);
        
        // Set pixel directly
        const targetIndex = (y * sourceWidth + x) * 4;
        data[targetIndex] = r;     // R
        data[targetIndex + 1] = g; // G
        data[targetIndex + 2] = b; // B
        data[targetIndex + 3] = a; // A
      }
    }
    
    // Put the image data on the canvas
    ctx.putImageData(imageData, 0, 0);
    
    // Download the standard res image
    downloadCanvas(canvas, quality, `${sourceWidth}x${sourceHeight}`);
  }
  
  // Generate hi-resolution download (4:1 scaling - each pixel becomes 4x4 block)
  async function generateHiResDownload(report, quality) {
    let pixelBitmapData = null;
    
    // Load pixel bitmap data
    if (report.pixelBitmap) {
      pixelBitmapData = report.pixelBitmap;
    } else if (report.pixelBitmapUrl) {
      try {
        const response = await fetch(report.pixelBitmapUrl);
        pixelBitmapData = await response.json();
      } catch (error) {
        console.error('❌ Failed to load pixel bitmap for download:', error);
        return;
      }
    }
    
    if (!pixelBitmapData) {
      console.error('❌ No pixel bitmap data available for download');
      return;
    }
    
    const sourceWidth = pixelBitmapData.width;
    const sourceHeight = pixelBitmapData.height;
    
    // Calculate 4x scaled dimensions
    const scaledWidth = sourceWidth * 4;
    const scaledHeight = sourceHeight * 4;
    
    console.log(`📐 Hi Res: ${sourceWidth}x${sourceHeight} → ${scaledWidth}x${scaledHeight} (4:1 scaling)`);
    
    // Create canvas for 4x scaled output
    const canvas = document.createElement('canvas');
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;
    const ctx = canvas.getContext('2d');
    
    // Create ImageData for the scaled output
    const imageData = ctx.createImageData(scaledWidth, scaledHeight);
    const data = imageData.data;
    
    // Scale each pixel to a 4x4 block
    for (let sourceY = 0; sourceY < sourceHeight; sourceY++) {
      for (let sourceX = 0; sourceX < sourceWidth; sourceX++) {
        const sourceIndex = sourceY * sourceWidth + sourceX;
        const hexColor = pixelBitmapData.pixels[sourceIndex];
        
        if (!hexColor) continue;
        
        // Parse hex color
        const r = parseInt(hexColor.slice(1, 3), 16);
        const g = parseInt(hexColor.slice(3, 5), 16);
        const b = parseInt(hexColor.slice(5, 7), 16);
        const a = parseInt(hexColor.slice(7, 9), 16);
        
        // Fill 4x4 block for this source pixel
        for (let blockY = 0; blockY < 4; blockY++) {
          for (let blockX = 0; blockX < 4; blockX++) {
            const targetX = sourceX * 4 + blockX;
            const targetY = sourceY * 4 + blockY;
            const targetIndex = (targetY * scaledWidth + targetX) * 4;
            
            data[targetIndex] = r;     // R
            data[targetIndex + 1] = g; // G
            data[targetIndex + 2] = b; // B
            data[targetIndex + 3] = a; // A
          }
        }
      }
    }
    
    // Put the scaled image data on the canvas
    ctx.putImageData(imageData, 0, 0);
    
    // Download the hi-res image
    downloadCanvas(canvas, quality, `${scaledWidth}x${scaledHeight}`);
  }
  
  // Simple download function for 4x scaled canvas
  function downloadCanvas(canvas, quality, dimensions) {
    // Convert canvas to blob
    canvas.toBlob((blob) => {
      // Create download link
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const filename = `kandinsky-${quality.toLowerCase()}-4x-${dimensions}-${timestamp}.png`;
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      
      // Trigger download
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Cleanup
      URL.revokeObjectURL(link.href);
      
      console.log(`📥 ${quality} 4x scaled download complete: ${filename}`);
      console.log(`📐 Final resolution: ${canvas.width}x${canvas.height} pixels (4x scaling)`);
    }, 'image/png', 1.0); // Maximum quality
  }
}

  // Clean up Firebase listener when page unloads
  window.addEventListener('beforeunload', () => {
    if (galleryListener) {
      console.log('🧹 Cleaning up desktop gallery Firebase listener');
      galleryListener();
    }
  });

}); // End of DOMContentLoaded
