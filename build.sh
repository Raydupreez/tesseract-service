#!/usr/bin/env bash
set -e

echo "🔧 Installing system dependencies for Tesseract OCR Service..."

# Update package manager
apt-get update

# Install ghostscript for PDF processing
echo "📥 Installing Ghostscript for PDF-to-image conversion..."
apt-get install -y ghostscript

# Verify installation
if command -v gs &> /dev/null; then
    echo "✓ Ghostscript installed successfully"
    gs --version
else
    echo "✗ Ghostscript installation failed"
    exit 1
fi

# Install npm dependencies
echo "📦 Installing Node.js dependencies..."
npm install

echo "✓ Build complete! Service ready for PDF processing."
