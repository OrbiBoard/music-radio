  function extractColor(img) {
    // Simple color extraction
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 50;
        canvas.height = 50;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 50, 50);
        const data = ctx.getImageData(0, 0, 50, 50).data;
        let r=0, g=0, b=0, count=0;
        for (let i=0; i<data.length; i+=4) {
            r += data[i];
            g += data[i+1];
            b += data[i+2];
            count++;
        }
        r = Math.floor(r/count);
        g = Math.floor(g/count);
        b = Math.floor(b/count);
        
        // Boost saturation/brightness if too dull
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max - min < 30) { // Grayscale-ish
             // Add some tint? or just leave it
        }
        
        return `rgb(${r},${g},${b})`;
    } catch (e) { return null; }
  }

  function applyCoverColor(imgUrl) {
    if (!imgUrl) return;
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = imgUrl;
    img.onload = () => {
        const color = extractColor(img);
        if (color) {
            document.documentElement.style.setProperty('--extracted-color', color);
            // Also generate a darker/lighter version for gradients if needed
        }
    };
  }
