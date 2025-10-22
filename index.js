const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Tesseract = require('tesseract.js');
const { execSync } = require('child_process');
const pdfParse = require('pdf-parse');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Multer setup for file uploads
const upload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, JPG, PNG allowed.'));
    }
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'tesseract-ocr',
    features: ['ocr', 'pdf-support', 'page-extraction']
  });
});

/**
 * Main OCR endpoint - Supports PDFs with page extraction
 * POST /ocr
 * Multipart form:
 *   - file: <binary PDF/JPG/PNG>
 *   - page: <optional page number for PDFs>
 */
app.post('/ocr', upload.single('file'), async (req, res) => {
  let filePath = null;
  let tempImagePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    filePath = req.file.path;
    const pageNumber = req.body.page ? parseInt(req.body.page) : null;

    console.log(`[OCR] Processing file: ${req.file.originalname}`);
    console.log(`[OCR] MIME type: ${req.file.mimetype}`);
    console.log(`[OCR] Page requested: ${pageNumber || 'all'}`);

    let imagePathToOcr = filePath;
    let pdfPageCount = null;
    let processedPage = null;

    // Handle PDF files
    if (req.file.mimetype === 'application/pdf') {
      console.log(`[PDF] Converting PDF to image for OCR...`);
      
      try {
        const result = await convertPdfPageToImage(filePath, pageNumber);
        tempImagePath = result.imagePath;
        pdfPageCount = result.totalPages;
        processedPage = result.pageNumber;
        imagePathToOcr = tempImagePath;
        
        console.log(`[PDF] ✓ Successfully converted page ${processedPage} of ${pdfPageCount}`);
      } catch (pdfError) {
        console.error('[PDF Error]', pdfError.message);
        cleanupFiles(filePath, null);
        return res.status(400).json({
          success: false,
          error: 'Failed to process PDF: ' + pdfError.message
        });
      }
    }

    // Run Tesseract.js on the image
    console.log(`[Tesseract] Processing image: ${path.basename(imagePathToOcr)}`);
    
    const { data: { text } } = await Tesseract.recognize(
      imagePathToOcr,
      'eng',
      {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            console.log(`[Tesseract] Progress: ${Math.round(m.progress * 100)}%`);
          }
        }
      }
    );

    if (!text || text.trim().length === 0) {
      console.log('[OCR] No text detected');
      cleanupFiles(filePath, tempImagePath);
      
      return res.json({
        success: true,
        text: '',
        length: 0,
        warning: 'No text detected in document',
        page_processed: processedPage,
        total_pages: pdfPageCount
      });
    }

    console.log(`[OCR] ✓ Successfully extracted ${text.length} characters`);

    // Clean up
    cleanupFiles(filePath, tempImagePath);

    res.json({
      success: true,
      text: text,
      length: text.length,
      confidence: calculateConfidence(text),
      page_processed: processedPage,
      total_pages: pdfPageCount
    });

  } catch (error) {
    console.error('[OCR Error]', error.message);
    console.error(error.stack);

    cleanupFiles(filePath, tempImagePath);

    res.status(500).json({
      success: false,
      error: error.message || 'OCR processing failed'
    });
  }
});

/**
 * Convert PDF page to PNG image for OCR processing
 * Uses ghostscript (must be installed on server)
 * 
 * @param {string} pdfPath - Path to PDF file
 * @param {number|null} pageNumber - Specific page to convert (1-indexed), null for first page
 * @returns {object} - { imagePath, pageNumber, totalPages }
 */
async function convertPdfPageToImage(pdfPath, pageNumber = null) {
  try {
    // First, get total page count
    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfData = await pdfParse(pdfBuffer);
    const totalPages = pdfData.numpages || 1;

    console.log(`[PDF] Total pages: ${totalPages}`);

    // Determine which page to process
    let pageToProcess = pageNumber || 1;
    if (pageToProcess < 1 || pageToProcess > totalPages) {
      throw new Error(`Invalid page number: ${pageToProcess}. PDF has ${totalPages} pages.`);
    }

    // Generate output path
    const outputFile = `/tmp/uploads/pdf-page-${Date.now()}.png`;
    
    // Build ghostscript command
    // gs -q -dNOPAUSE -dBATCH -sDEVICE=png16m -dGraphicsAlphaBits=4 -r150 -dFirstPage=X -dLastPage=X -sOutputFile=OUTPUT INPUT.pdf
    const cmd = `gs -q -dNOPAUSE -dBATCH -sDEVICE=png16m -dGraphicsAlphaBits=4 -r150 -dFirstPage=${pageToProcess} -dLastPage=${pageToProcess} -sOutputFile="${outputFile}" "${pdfPath}"`;
    
    console.log(`[GS] Running: ${cmd}`);
    
    const output = execSync(cmd, { encoding: 'utf8' });
    console.log(`[GS] Output: ${output}`);

    // Check if image was created
    if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size === 0) {
      throw new Error('Ghostscript failed to generate image');
    }

    console.log(`[GS] Generated image: ${outputFile} (${fs.statSync(outputFile).size} bytes)`);

    return {
      imagePath: outputFile,
      pageNumber: pageToProcess,
      totalPages: totalPages
    };

  } catch (error) {
    console.error('[PDF Conversion Error]', error.message);
    
    // Check if ghostscript is installed
    try {
      execSync('which gs', { encoding: 'utf8' });
    } catch (e) {
      throw new Error('Ghostscript not installed on server. Please install with: apt-get install ghostscript');
    }
    
    throw error;
  }
}

/**
 * Clean up temporary files
 */
function cleanupFiles(filePath, tempImagePath) {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      console.log(`[Cleanup] Deleted: ${filePath}`);
    } catch (e) {
      console.error('[Cleanup Error]', e.message);
    }
  }
  
  if (tempImagePath && fs.existsSync(tempImagePath)) {
    try {
      fs.unlinkSync(tempImagePath);
      console.log(`[Cleanup] Deleted: ${tempImagePath}`);
    } catch (e) {
      console.error('[Cleanup Error]', e.message);
    }
  }
}

/**
 * Quick confidence estimation based on text quality
 */
function calculateConfidence(text) {
  if (!text) return 0;

  // Base score on text length
  let score = Math.min(100, (text.length / 50));

  // Penalize for too many special characters (OCR noise)
  const specialCharRatio = (text.match(/[^a-zA-Z0-9\s@.,-]/g) || []).length / (text.length || 1);
  score -= specialCharRatio * 30;

  // Bonus for common words found
  const commonWords = [
    'the', 'and', 'member', 'application', 'name', 'email', 
    'address', 'phone', 'date', 'signature', 'form', 'employer'
  ];
  const foundWords = commonWords.filter(word => 
    text.toLowerCase().includes(word)
  ).length;
  score += (foundWords * 3);

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Error handler
 */
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

/**
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Tesseract OCR Service running on port ${PORT}`);
  console.log(`📝 POST /ocr - Upload PDF/JPG/PNG for OCR processing`);
  console.log(`💚 GET /health - Health check`);
});
