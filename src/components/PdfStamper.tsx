import React, { useState, useRef, useEffect } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { PDFDocument, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { 
  Upload, 
  Download, 
  Settings, 
  FileText, 
  Move, 
  Image as ImageIcon, 
  Plus, 
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Crosshair,
  Check,
  RotateCcw,
  AlignLeft,
  AlignRight,
  AlignCenter,
  ArrowUpDown,
  ArrowLeftRight,
  Sparkles,
  Sliders,
  Copy,
  Info,
  Layers,
  ShieldCheck
} from 'lucide-react';

// Configure the worker for pdf.js using a CDN to ensure compatibility
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

type QROverlay = {
  id: string;
  url: string;
  x: number; // percentage from left (0 - 100)
  y: number; // percentage from top (0 - 100)
};

type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

export default function PdfStamper() {
  const [fileType, setFileType] = useState<'pdf' | 'image' | null>(null);
  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null);
  const [originalImage, setOriginalImage] = useState<HTMLImageElement | null>(null);
  
  const [qrs, setQrs] = useState<QROverlay[]>([]);
  const [selectedQrId, setSelectedQrId] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState('');
  
  // QR appearance & resolution settings
  const [qrSize, setQrSize] = useState(24);
  const [fgColor, setFgColor] = useState('#000000');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [whiteBorderPadding, setWhiteBorderPadding] = useState(5); // Quiet zone
  const [ecLevel, setEcLevel] = useState<ErrorCorrectionLevel>('L');
  const [showPlayIcon, setShowPlayIcon] = useState(false); // Default false for maximum scannability on WhatsApp
  const [highResWhatsApp, setHighResWhatsApp] = useState(true); // 2x Super-Resolution export
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [fileName, setFileName] = useState('');
  const [nudgeStep, setNudgeStep] = useState<number>(0.5);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const PLAY_ICON_URL = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='12' fill='%23ef4444'/%3E%3Cpath d='M10 7.5l6 4.5-6 4.5v-9z' fill='%23ffffff'/%3E%3C/svg%3E";

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  };

  // Dragging state tracking using pointer capture
  const dragInfoRef = useRef<{
    id: string;
    startPointerX: number;
    startPointerY: number;
    startQrX: number;
    startQrY: number;
    containerWidth: number;
    containerHeight: number;
  } | null>(null);

  /**
   * Smart initial alignment:
   * When adding the first QR, place it at the right column (typical for workout/table sheets like the user's).
   * When adding subsequent QRs, automatically inherit the EXACT SAME X coordinate (column)
   * and space it uniformly downward based on previous spacing!
   */
  const handleAddQr = () => {
    if (!currentUrl.trim()) return;
    
    let initX = 90.5; // Default right column (ideal for tables with 'QR' column on right)
    let initY = 32.0;

    if (qrs.length > 0) {
      // Inherit the exact X of the selected QR or the last QR in the list
      const referenceQr = (selectedQrId ? qrs.find(q => q.id === selectedQrId) : null) || qrs[qrs.length - 1];
      initX = referenceQr.x;

      if (qrs.length >= 2) {
        // Compute the vertical step between the last two QRs to preserve row rhythm!
        const last = qrs[qrs.length - 1];
        const prev = qrs[qrs.length - 2];
        const step = Math.abs(last.y - prev.y);
        const validStep = step > 2 && step < 25 ? step : 8.5;
        initY = Math.min(94, Number((last.y + validStep).toFixed(2)));
      } else {
        // Second QR: placed 8.5% below the first one in the exact same column
        initY = Math.min(94, Number((referenceQr.y + 8.5).toFixed(2)));
      }
    }

    const newQr: QROverlay = {
      id: crypto.randomUUID(),
      url: currentUrl.trim(),
      x: Number(initX.toFixed(2)),
      y: Number(initY.toFixed(2)),
    };

    setQrs(prev => [...prev, newQr]);
    setSelectedQrId(newQr.id);
    setCurrentUrl('');
    showToast(`QR #${qrs.length + 1} añadido y alineado en la columna.`);
  };

  const removeQr = (id: string) => {
    setQrs(prev => prev.filter(q => q.id !== id));
    if (selectedQrId === id) {
      setSelectedQrId(null);
    }
  };

  const updateQrPosition = (id: string, newX: number, newY: number) => {
    setQrs(prev => prev.map(qr => {
      if (qr.id !== id) return qr;
      return {
        ...qr,
        x: Math.max(0, Math.min(96, Number(newX.toFixed(2)))),
        y: Math.max(0, Math.min(96, Number(newY.toFixed(2)))),
      };
    }));
  };

  const nudgeSelectedQr = (dx: number, dy: number) => {
    if (!selectedQrId) return;
    const qr = qrs.find(q => q.id === selectedQrId);
    if (!qr) return;
    updateQrPosition(qr.id, qr.x + dx, qr.y + dy);
  };

  // --- ALIGNMENT TOOLKIT FUNCTIONS ---

  // 1. Align all QRs vertically (Same X coordinate)
  const alignAllVertical = (customX?: number) => {
    if (qrs.length === 0) return;
    const targetX = customX !== undefined 
      ? customX 
      : (selectedQrId ? qrs.find(q => q.id === selectedQrId)?.x : null) ?? qrs[0].x;

    setQrs(prev => prev.map(q => ({
      ...q,
      x: Number(targetX.toFixed(2))
    })));
    showToast(`Todos los QRs alineados verticalmente a X: ${targetX.toFixed(1)}%`);
  };

  // 2. Distribute all QRs vertically (Equal vertical spacing between top and bottom)
  const distributeVertical = () => {
    if (qrs.length < 3) {
      showToast('Se necesitan al menos 3 códigos para distribuir.');
      return;
    }

    const sorted = [...qrs].sort((a, b) => a.y - b.y);
    const minY = sorted[0].y;
    const maxY = sorted[sorted.length - 1].y;
    const step = (maxY - minY) / (sorted.length - 1);

    const positionMap = new Map<string, number>();
    sorted.forEach((qr, idx) => {
      positionMap.set(qr.id, Number((minY + (idx * step)).toFixed(2)));
    });

    setQrs(prev => prev.map(q => ({
      ...q,
      y: positionMap.get(q.id) ?? q.y
    })));

    showToast('QRs distribuidos con espacio vertical exactamente igual.');
  };

  // 3. Align all QRs horizontally (Same Y coordinate)
  const alignAllHorizontal = (customY?: number) => {
    if (qrs.length === 0) return;
    const targetY = customY !== undefined 
      ? customY 
      : (selectedQrId ? qrs.find(q => q.id === selectedQrId)?.y : null) ?? qrs[0].y;

    setQrs(prev => prev.map(q => ({
      ...q,
      y: Number(targetY.toFixed(2))
    })));
    showToast(`Todos los QRs alineados horizontalmente a Y: ${targetY.toFixed(1)}%`);
  };

  // 4. Distribute all QRs horizontally (Equal horizontal spacing)
  const distributeHorizontal = () => {
    if (qrs.length < 3) {
      showToast('Se necesitan al menos 3 códigos para distribuir.');
      return;
    }

    const sorted = [...qrs].sort((a, b) => a.x - b.x);
    const minX = sorted[0].x;
    const maxX = sorted[sorted.length - 1].x;
    const step = (maxX - minX) / (sorted.length - 1);

    const positionMap = new Map<string, number>();
    sorted.forEach((qr, idx) => {
      positionMap.set(qr.id, Number((minX + (idx * step)).toFixed(2)));
    });

    setQrs(prev => prev.map(q => ({
      ...q,
      x: positionMap.get(q.id) ?? q.x
    })));

    showToast('QRs distribuidos horizontalmente de forma equidistante.');
  };

  // 5. Preset Column Alignments
  const presetRightColumn = () => {
    alignAllVertical(90.5);
    if (qrs.length >= 3) {
      distributeVertical();
    }
  };

  const presetLeftColumn = () => {
    alignAllVertical(8.5);
    if (qrs.length >= 3) {
      distributeVertical();
    }
  };

  const setPresetPosition = (preset: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center') => {
    if (!selectedQrId) return;
    let px = 5;
    let py = 5;
    switch (preset) {
      case 'top-left': px = 5; py = 5; break;
      case 'top-right': px = 88; py = 5; break;
      case 'bottom-left': px = 5; py = 88; break;
      case 'bottom-right': px = 88; py = 88; break;
      case 'center': px = 46; py = 46; break;
    }
    updateQrPosition(selectedQrId, px, py);
  };

  // Keyboard navigation for pixel-level precision
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedQrId) return;
      const tag = (document.activeElement?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const step = e.shiftKey ? 2.0 : (nudgeStep || 0.5);

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        nudgeSelectedQr(-step, 0);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nudgeSelectedQr(step, 0);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        nudgeSelectedQr(0, -step);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        nudgeSelectedQr(0, step);
      } else if (e.key === 'Escape') {
        setSelectedQrId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedQrId, nudgeStep, qrs]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>, qr: QROverlay) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedQrId(qr.id);

    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    dragInfoRef.current = {
      id: qr.id,
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      startQrX: qr.x,
      startQrY: qr.y,
      containerWidth: rect.width,
      containerHeight: rect.height,
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragInfoRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    const { id, startPointerX, startPointerY, startQrX, startQrY, containerWidth, containerHeight } = dragInfoRef.current;
    if (containerWidth <= 0 || containerHeight <= 0) return;

    const deltaPxX = e.clientX - startPointerX;
    const deltaPxY = e.clientY - startPointerY;

    const deltaPctX = (deltaPxX / containerWidth) * 100;
    const deltaPctY = (deltaPxY / containerHeight) * 100;

    const newX = Math.max(0, Math.min(96, Number((startQrX + deltaPctX).toFixed(2))));
    const newY = Math.max(0, Math.min(96, Number((startQrY + deltaPctY).toFixed(2))));

    setQrs(prev => prev.map(q => q.id === id ? { ...q, x: newX, y: newY } : q));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragInfoRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      dragInfoRef.current = null;
    }
  };

  const resetWorkspace = () => {
    setFileType(null);
    setPdfBuffer(null);
    setOriginalImage(null);
    setQrs([]);
    setSelectedQrId(null);
    setCurrentUrl('');
    setFileName('');
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setSelectedQrId(null);
    
    if (file.type.startsWith('image/')) {
      setFileType('image');
      setPdfBuffer(null);
      const fileUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        setOriginalImage(img);
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
      };
      img.src = fileUrl;
    } else if (file.type === 'application/pdf') {
      setFileType('pdf');
      setOriginalImage(null);
      const buffer = await file.arrayBuffer();
      setPdfBuffer(buffer);

      try {
        const loadingTask = pdfjsLib.getDocument({ data: buffer });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);

        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await (page as any).render({
          canvasContext: context,
          viewport: viewport
        }).promise;
      } catch (err) {
        console.error("Error rendering PDF preview:", err);
        alert("Error al cargar la vista previa del PDF.");
      }
    } else {
      alert("Formato de archivo no soportado. Sube un PDF o una Imagen.");
    }
  };

  /**
   * Final Document Generation:
   * Optimized for WhatsApp with Ultra-High Resolution (2x canvas scale)
   * and pixel-crisp rendering (nearest-neighbor without blurry gray anti-aliasing)
   */
  const generateDocument = async () => {
    if (!fileType || !containerRef.current || qrs.length === 0) return;
    setIsGenerating(true);

    try {
      const containerRect = containerRef.current.getBoundingClientRect();
      const padding = whiteBorderPadding;
      const totalBoxWidth = qrSize + (padding * 2);
      const totalBoxHeight = qrSize + (padding * 2);

      if (fileType === 'pdf' && pdfBuffer) {
        const pdfDoc = await PDFDocument.load(pdfBuffer);
        const pages = pdfDoc.getPages();
        const page = pages[0];
        
        const { width: pdfW, height: pdfH } = page.getSize();
        const scaleX = pdfW / containerRect.width;
        const scaleY = pdfH / containerRect.height;

        for (const qr of qrs) {
          const relX = (qr.x / 100) * containerRect.width;
          const relY = (qr.y / 100) * containerRect.height;
          
          const finalX = relX * scaleX;
          const finalWidth = totalBoxWidth * scaleX;
          const finalHeight = totalBoxHeight * scaleY;
          // PDF coordinate origin is bottom-left
          const finalY = pdfH - ((relY + totalBoxHeight) * scaleY);

          // Draw white quiet zone background with sharp borders
          page.drawRectangle({
            x: finalX,
            y: finalY,
            width: finalWidth,
            height: finalHeight,
            color: rgb(1, 1, 1),
          });

          const qrCanvas = document.getElementById(`qr-canvas-${qr.id}`) as HTMLCanvasElement | null;
          if (qrCanvas) {
            const qrFinalX = finalX + (padding * scaleX);
            const qrFinalY = finalY + (padding * scaleY);
            const qrFinalWidth = qrSize * scaleX;
            const qrFinalHeight = qrSize * scaleY;

            const qrDataUrl = qrCanvas.toDataURL('image/png');
            const qrImage = await pdfDoc.embedPng(qrDataUrl);
            page.drawImage(qrImage, {
              x: qrFinalX,
              y: qrFinalY,
              width: qrFinalWidth,
              height: qrFinalHeight,
              opacity: 1,
            });
          }
        }

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const objectUrl = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = `QR_${fileName}`;
        link.click();
        
        setIsGenerating(false);
        setTimeout(() => {
          URL.revokeObjectURL(objectUrl);
          if (window.confirm("¡Documento PDF descargado exitosamente con máxima nitidez!\n\n¿Deseas reiniciar para procesar otro documento?")) {
            resetWorkspace();
          }
        }, 1000);

      } else if (fileType === 'image' && originalImage) {
        // Ultra-High Resolution factor for WhatsApp scannability (2x scale)
        const exportScale = highResWhatsApp ? 2.0 : 1.0;

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(originalImage.width * exportScale);
        canvas.height = Math.round(originalImage.height * exportScale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        // Render base image at high quality
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(originalImage, 0, 0, canvas.width, canvas.height);
        
        const scaleX = canvas.width / containerRect.width;
        const scaleY = canvas.height / containerRect.height;
        
        for (const qr of qrs) {
          const relX = (qr.x / 100) * containerRect.width;
          const relY = (qr.y / 100) * containerRect.height;
          
          const finalX = relX * scaleX;
          const finalY = relY * scaleY;
          const finalWidth = totalBoxWidth * scaleX;
          const finalHeight = totalBoxHeight * scaleY;

          // 1. Draw solid white Quiet Zone background with crisp sharp edges
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(Math.round(finalX), Math.round(finalY), Math.round(finalWidth), Math.round(finalHeight));

          // 2. Draw QR code with image smoothing DISABLED so black & white pixels don't get blurred!
          const qrCanvas = document.getElementById(`qr-canvas-${qr.id}`) as HTMLCanvasElement | null;
          if (qrCanvas) {
            const qrFinalX = finalX + (padding * scaleX);
            const qrFinalY = finalY + (padding * scaleY);
            const qrFinalWidth = qrSize * scaleX;
            const qrFinalHeight = qrSize * scaleY;

            ctx.imageSmoothingEnabled = false; // Prevents blurry gray edges on QR modules!
            ctx.drawImage(
              qrCanvas, 
              Math.round(qrFinalX), 
              Math.round(qrFinalY), 
              Math.round(qrFinalWidth), 
              Math.round(qrFinalHeight)
            );
            ctx.imageSmoothingEnabled = true; // Restore for future operations
          }
        }
        
        // Export as Lossless PNG at 100% quality
        canvas.toBlob((blob) => {
          if (!blob) return;
          const objectUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = objectUrl;
          const baseName = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
          link.download = `QR_${baseName}_UltraHD.png`;
          link.click();
          
          setIsGenerating(false);

          setTimeout(() => {
            URL.revokeObjectURL(objectUrl);
            if (window.confirm("¡Imagen estampada con Súper-Resolución para WhatsApp descargada exitosamente!\n\nTip: Para que WhatsApp no comprima la imagen, envíala como 'Documento' (📎) en lugar de foto normal.\n\n¿Deseas reiniciar para procesar otra imagen?")) {
              resetWorkspace();
            }
          }, 1000);
        }, 'image/png', 1.0);
        
        return; 
      }
    } catch (err) {
      console.error("Error generating final document:", err);
      alert("Hubo un error al generar el archivo final.");
      setIsGenerating(false);
    }
  };

  const selectedQr = qrs.find(q => q.id === selectedQrId) || null;
  const selectedIndex = selectedQrId ? qrs.findIndex(q => q.id === selectedQrId) : -1;

  // Effective error correction level (must be H if play icon is shown)
  const effectiveEcLevel: ErrorCorrectionLevel = showPlayIcon ? 'H' : ecLevel;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-neutral-900 text-white px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 text-xs font-medium border border-neutral-700 animate-in fade-in duration-200">
          <Sparkles className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Configuration Panel */}
      <div className="lg:col-span-4 space-y-6">
        
        {/* Alignment Toolkit (Prominent & Quick) */}
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-neutral-200/60 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold flex items-center gap-2 text-neutral-900">
              <Layers className="w-5 h-5 text-emerald-600" />
              Herramientas de Alineación
            </h2>
            <span className="text-xs bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded-full">
              {qrs.length} QR{qrs.length !== 1 ? 's' : ''}
            </span>
          </div>

          <p className="text-xs text-neutral-600 leading-relaxed">
            Alinea automáticamente todos los códigos en una <strong>columna vertical recta</strong> o <strong>distribúyelos con separación idéntica</strong> en 1 clic.
          </p>

          {/* Quick Align Buttons Grid */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={() => alignAllVertical()}
              disabled={qrs.length < 2}
              className="px-3 py-2.5 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 border border-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed text-emerald-900 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-2xs"
              title="Alinea todos los QRs exactamente en la misma coordenada horizontal X (columna recta)"
            >
              <ArrowUpDown className="w-4 h-4 text-emerald-600" />
              <span>Alinear en Columna (Misma X)</span>
            </button>

            <button
              onClick={distributeVertical}
              disabled={qrs.length < 3}
              className="px-3 py-2.5 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 border border-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed text-emerald-900 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-2xs"
              title="Distribuye el espacio vertical de forma totalmente uniforme entre el primer y último QR"
            >
              <Sliders className="w-4 h-4 text-emerald-600" />
              <span>Distribuir Vertical</span>
            </button>

            <button
              onClick={() => alignAllHorizontal()}
              disabled={qrs.length < 2}
              className="px-3 py-2.5 bg-neutral-50 hover:bg-neutral-100 active:bg-neutral-200 border border-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed text-neutral-800 rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition-all"
              title="Alinea horizontalmente todos los QRs a la misma altura Y"
            >
              <ArrowLeftRight className="w-4 h-4 text-neutral-600" />
              <span>Alinear en Fila (Misma Y)</span>
            </button>

            <button
              onClick={distributeHorizontal}
              disabled={qrs.length < 3}
              className="px-3 py-2.5 bg-neutral-50 hover:bg-neutral-100 active:bg-neutral-200 border border-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed text-neutral-800 rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition-all"
              title="Distribuye el espacio horizontal de forma equidistante"
            >
              <AlignCenter className="w-4 h-4 text-neutral-600" />
              <span>Distribuir Horiz.</span>
            </button>
          </div>

          {/* Table Presets */}
          <div className="pt-2 border-t border-neutral-100 flex items-center justify-between gap-2 text-xs">
            <span className="text-neutral-500 font-medium">Presets tabla:</span>
            <div className="flex gap-1.5">
              <button
                onClick={presetRightColumn}
                disabled={qrs.length === 0}
                className="px-2.5 py-1 bg-white hover:bg-neutral-100 border border-neutral-300 disabled:opacity-40 text-neutral-700 rounded-lg font-medium text-[11px] flex items-center gap-1 transition-colors"
                title="Alinea todos los QRs en la columna derecha (90.5%) y los distribuye verticalmente"
              >
                <AlignRight className="w-3.5 h-3.5 text-emerald-600" />
                Columna Derecha (90%)
              </button>
              <button
                onClick={presetLeftColumn}
                disabled={qrs.length === 0}
                className="px-2.5 py-1 bg-white hover:bg-neutral-100 border border-neutral-300 disabled:opacity-40 text-neutral-700 rounded-lg font-medium text-[11px] flex items-center gap-1 transition-colors"
                title="Alinea todos los QRs en la columna izquierda (8.5%)"
              >
                <AlignLeft className="w-3.5 h-3.5 text-neutral-600" />
                Columna Izq. (8%)
              </button>
            </div>
          </div>
        </div>

        {/* QR Manager Panel */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200/60 space-y-5">
          <h2 className="text-base font-semibold flex items-center gap-2 text-neutral-900">
            <Settings className="w-5 h-5 text-emerald-600" />
            Códigos QR
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">Añadir Enlace QR</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="https://ejemplo.com o texto..."
                  value={currentUrl}
                  onChange={(e) => setCurrentUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddQr();
                  }}
                  className="flex-1 px-3 py-2 border border-neutral-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-emerald-500 text-sm"
                />
                <button
                  onClick={handleAddQr}
                  disabled={!currentUrl.trim()}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white rounded-xl transition-colors font-medium flex items-center justify-center shadow-sm"
                  title="Añadir este código QR (se alineará automáticamente con la columna de los anteriores)"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
              <p className="text-[11px] text-neutral-500 mt-1">
                Al añadir nuevos códigos, se colocarán <strong>alineados en la misma columna vertical</strong> automáticamente.
              </p>
            </div>

            {/* List of active QRs */}
            {qrs.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                    Códigos QR Añadidos ({qrs.length})
                  </label>
                  {selectedQrId && (
                    <button
                      onClick={() => alignAllVertical(selectedQr?.x)}
                      className="text-[11px] text-emerald-700 hover:text-emerald-800 font-semibold flex items-center gap-1 hover:underline"
                      title="Alinear todos los códigos a la coordenada X de este QR"
                    >
                      <Copy className="w-3 h-3" />
                      Igualar X a todos
                    </button>
                  )}
                </div>
                
                <div className="bg-neutral-50 rounded-xl border border-neutral-200 p-2.5 space-y-1.5 max-h-[170px] overflow-y-auto">
                  {qrs.map((qr, index) => {
                    const isSelected = qr.id === selectedQrId;
                    return (
                      <div 
                        key={qr.id} 
                        onClick={() => setSelectedQrId(qr.id)}
                        className={`flex items-center justify-between gap-2 p-2 rounded-lg border transition-all cursor-pointer text-sm ${
                          isSelected 
                            ? 'bg-emerald-50 border-emerald-300 ring-2 ring-emerald-500/30 shadow-sm' 
                            : 'bg-white border-neutral-200 hover:border-neutral-300 hover:bg-neutral-100/60'
                        }`}
                      >
                        <div className="truncate flex-1 flex items-center gap-2">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                            isSelected ? 'bg-emerald-600 text-white' : 'bg-neutral-200 text-neutral-700'
                          }`}>
                            {index + 1}
                          </span>
                          <div className="truncate flex flex-col">
                            <span className="truncate font-medium text-neutral-800 text-xs" title={qr.url}>{qr.url}</span>
                            <span className="text-[11px] text-neutral-500 font-mono">
                              X: {qr.x.toFixed(1)}% · Y: {qr.y.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {isSelected && (
                            <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">
                              Activo
                            </span>
                          )}
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              removeQr(qr.id);
                            }} 
                            className="text-neutral-400 hover:text-red-500 p-1 rounded-md hover:bg-neutral-100 transition-colors"
                            title="Eliminar este código"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Precision Position & Alignment Controls for Selected QR */}
            {selectedQr && (
              <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-emerald-900 font-semibold text-xs">
                    <Crosshair className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Control de Precisión (QR #{selectedIndex + 1})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => alignAllVertical(selectedQr.x)}
                      className="text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-0.5 rounded shadow-2xs font-medium"
                      title="Hacer que todos los demás QRs tengan esta misma X"
                    >
                      Copiar X a todos
                    </button>
                  </div>
                </div>

                {/* Direct Numeric Position Inputs */}
                <div className="grid grid-cols-2 gap-2 bg-white/90 p-2 rounded-lg border border-emerald-200/80">
                  <div>
                    <label className="block text-[10px] font-semibold text-neutral-600 uppercase">Posición X (%)</label>
                    <div className="flex items-center gap-1 mt-0.5">
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="96"
                        value={selectedQr.x}
                        onChange={(e) => updateQrPosition(selectedQr.id, Number(e.target.value) || 0, selectedQr.y)}
                        className="w-full px-2 py-1 text-xs border border-neutral-300 rounded font-mono font-medium focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                      />
                      <span className="text-[10px] text-neutral-400">%</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-neutral-600 uppercase">Posición Y (%)</label>
                    <div className="flex items-center gap-1 mt-0.5">
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="96"
                        value={selectedQr.y}
                        onChange={(e) => updateQrPosition(selectedQr.id, selectedQr.x, Number(e.target.value) || 0)}
                        className="w-full px-2 py-1 text-xs border border-neutral-300 rounded font-mono font-medium focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                      />
                      <span className="text-[10px] text-neutral-400">%</span>
                    </div>
                  </div>
                </div>

                {/* D-Pad Arrows for micro-movements */}
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <div className="grid grid-cols-3 gap-1 w-28 shrink-0">
                    <div></div>
                    <button
                      onClick={() => nudgeSelectedQr(0, -nudgeStep)}
                      className="p-1.5 bg-white hover:bg-emerald-100 active:bg-emerald-200 text-neutral-700 border border-emerald-200 rounded-lg shadow-2xs flex items-center justify-center transition-colors"
                      title="Mover Arriba"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <div></div>
                    <button
                      onClick={() => nudgeSelectedQr(-nudgeStep, 0)}
                      className="p-1.5 bg-white hover:bg-emerald-100 active:bg-emerald-200 text-neutral-700 border border-emerald-200 rounded-lg shadow-2xs flex items-center justify-center transition-colors"
                      title="Mover Izquierda"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setPresetPosition('center')}
                      className="p-1.5 bg-emerald-600 text-white rounded-lg shadow-2xs flex items-center justify-center text-[10px] font-bold"
                      title="Centrar QR"
                    >
                      C
                    </button>
                    <button
                      onClick={() => nudgeSelectedQr(nudgeStep, 0)}
                      className="p-1.5 bg-white hover:bg-emerald-100 active:bg-emerald-200 text-neutral-700 border border-emerald-200 rounded-lg shadow-2xs flex items-center justify-center transition-colors"
                      title="Mover Derecha"
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                    <div></div>
                    <button
                      onClick={() => nudgeSelectedQr(0, nudgeStep)}
                      className="p-1.5 bg-white hover:bg-emerald-100 active:bg-emerald-200 text-neutral-700 border border-emerald-200 rounded-lg shadow-2xs flex items-center justify-center transition-colors"
                      title="Mover Abajo"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <div></div>
                  </div>

                  {/* Step Selector */}
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-neutral-600">
                      <span>Paso:</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setNudgeStep(0.2)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${nudgeStep === 0.2 ? 'bg-emerald-600 text-white' : 'bg-white border text-neutral-600'}`}
                        >
                          0.2%
                        </button>
                        <button
                          onClick={() => setNudgeStep(0.5)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${nudgeStep === 0.5 ? 'bg-emerald-600 text-white' : 'bg-white border text-neutral-600'}`}
                        >
                          0.5%
                        </button>
                        <button
                          onClick={() => setNudgeStep(2.0)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${nudgeStep === 2.0 ? 'bg-emerald-600 text-white' : 'bg-white border text-neutral-600'}`}
                        >
                          2.0%
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1 text-[10px]">
                      <button
                        onClick={() => setPresetPosition('top-right')}
                        className="p-1 bg-white hover:bg-neutral-100 border border-emerald-200 rounded text-neutral-700 font-medium"
                      >
                        ↗ Sup. Der.
                      </button>
                      <button
                        onClick={() => setPresetPosition('bottom-right')}
                        className="p-1 bg-white hover:bg-neutral-100 border border-emerald-200 rounded text-neutral-700 font-medium"
                      >
                        ↘ Inf. Der.
                      </button>
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-emerald-900/80 leading-snug">
                  💡 Flechas de teclado <strong>(← ↑ → ↓)</strong> para ajustar en tiempo real (mantén Shift para salto 2%).
                </p>
              </div>
            )}

            {/* RESOLUTION & WHATSAPP OPTIMIZATIONS */}
            <div className="p-4 bg-emerald-50/50 border border-emerald-200/90 rounded-xl space-y-3.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-emerald-950 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Calidad y Escaneo WhatsApp
                </h3>
                <span className="text-[10px] bg-emerald-600 text-white font-semibold px-2 py-0.5 rounded-full shadow-2xs">
                  Alta Definición
                </span>
              </div>

              {/* Super Resolution Toggle */}
              <div className="flex items-start gap-2.5 bg-white p-2.5 rounded-lg border border-emerald-200/80">
                <input
                  type="checkbox"
                  id="high-res-toggle"
                  checked={highResWhatsApp}
                  onChange={(e) => setHighResWhatsApp(e.target.checked)}
                  className="w-4 h-4 mt-0.5 text-emerald-600 rounded border-neutral-300 focus:ring-emerald-600 cursor-pointer shrink-0"
                />
                <label htmlFor="high-res-toggle" className="text-xs text-neutral-800 cursor-pointer">
                  <span className="font-semibold block text-emerald-900">Súper-Resolución 2x (Para WhatsApp)</span>
                  <span className="text-neutral-500 text-[11px] leading-relaxed block mt-0.5">
                    Exporta la imagen al doble de densidad para que los puntos del QR tengan más píxeles y no se borren con la compresión de WhatsApp.
                  </span>
                </label>
              </div>

              {/* QR Size and Resolution controls */}
              <div>
                <div className="flex justify-between items-center mb-1.5 text-xs font-medium text-neutral-700">
                  <span>Tamaño del QR</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="12"
                      max="70"
                      value={qrSize}
                      onChange={(e) => setQrSize(Math.max(10, Math.min(80, Number(e.target.value) || 20)))}
                      className="w-12 px-1.5 py-0.5 border border-neutral-300 rounded text-center text-xs font-mono font-bold"
                    />
                    <span className="text-neutral-500">px</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="14"
                  max="60"
                  value={qrSize}
                  onChange={(e) => setQrSize(Number(e.target.value))}
                  className="w-full accent-emerald-600"
                />
                <div className="flex justify-between text-[10px] text-neutral-400 mt-0.5">
                  <span>14px (Pequeño)</span>
                  <span className="font-semibold text-emerald-700">20-25px (Recomendado)</span>
                  <span>60px (Grande)</span>
                </div>
              </div>

              {/* Quiet zone (White border padding) */}
              <div>
                <div className="flex justify-between items-center mb-1 text-xs font-medium text-neutral-700">
                  <span>Margen Blanco Protector (Quiet Zone)</span>
                  <span className="text-neutral-500 font-mono text-[11px]">{whiteBorderPadding}px</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="10"
                  value={whiteBorderPadding}
                  onChange={(e) => setWhiteBorderPadding(Number(e.target.value))}
                  className="w-full accent-emerald-600"
                />
                <p className="text-[10px] text-neutral-500 mt-0.5">
                  Protege el QR contra fondos oscuros o de color para que la cámara del celular detecte los bordes fácilmente.
                </p>
              </div>

              {/* Error correction level selector */}
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Tamaño de Módulos (Legibilidad)
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => {
                      setEcLevel('L');
                      setShowPlayIcon(false);
                    }}
                    className={`px-2 py-1.5 rounded-lg border text-left text-xs transition-all ${
                      ecLevel === 'L' && !showPlayIcon
                        ? 'bg-emerald-600 text-white border-emerald-600 font-semibold shadow-2xs' 
                        : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    <div className="font-bold text-[11px]">Puntos Grandes (Nivel L)</div>
                    <div className={`text-[10px] ${ecLevel === 'L' && !showPlayIcon ? 'text-emerald-100' : 'text-neutral-500'}`}>
                      Óptimo para WhatsApp
                    </div>
                  </button>

                  <button
                    onClick={() => setEcLevel('M')}
                    className={`px-2 py-1.5 rounded-lg border text-left text-xs transition-all ${
                      ecLevel === 'M' && !showPlayIcon
                        ? 'bg-emerald-600 text-white border-emerald-600 font-semibold shadow-2xs' 
                        : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    <div className="font-bold text-[11px]">Estándar (Nivel M)</div>
                    <div className={`text-[10px] ${ecLevel === 'M' && !showPlayIcon ? 'text-emerald-100' : 'text-neutral-500'}`}>
                      Balanceado (15% rec.)
                    </div>
                  </button>
                </div>
              </div>

              {/* Center Play Icon Toggle */}
              <div className="flex items-center gap-2 pt-1 border-t border-emerald-100">
                <input
                  type="checkbox"
                  id="play-icon-toggle"
                  checked={showPlayIcon}
                  onChange={(e) => setShowPlayIcon(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded border-neutral-300 focus:ring-emerald-600 cursor-pointer"
                />
                <label htmlFor="play-icon-toggle" className="text-xs text-neutral-700 font-medium cursor-pointer">
                  Añadir icono "Play" central
                </label>
              </div>

              {/* WhatsApp Pro-Tip Banner */}
              <div className="bg-white/80 p-2.5 rounded-lg border border-emerald-200 flex gap-2 text-[11px] text-emerald-950">
                <Info className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="leading-snug">
                  <strong>Consejo para enviar por WhatsApp:</strong> Al compartir la imagen en un chat, selecciónala como <strong>"Documento" (icono 📎)</strong> en lugar de foto normal. WhatsApp la enviará con el 100% de calidad sin comprimir nada.
                </div>
              </div>
            </div>

            {/* Colors */}
            <div className="grid grid-cols-2 gap-4 pt-1 border-t border-neutral-100">
              <div>
                <label className="block text-xs font-semibold text-neutral-600 uppercase mb-1.5">Color Trazos</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={fgColor}
                    onChange={(e) => setFgColor(e.target.value)}
                    className="w-8 h-8 rounded-lg cursor-pointer border border-neutral-300 p-0"
                  />
                  <span className="text-xs text-neutral-600 font-mono uppercase">{fgColor}</span>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-600 uppercase mb-1.5">Color Fondo</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={bgColor}
                    onChange={(e) => setBgColor(e.target.value)}
                    className="w-8 h-8 rounded-lg cursor-pointer border border-neutral-300 p-0"
                  />
                  <span className="text-xs text-neutral-600 font-mono uppercase">{bgColor}</span>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Upload Document Panel */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200/60">
          <h2 className="text-base font-semibold mb-4 flex items-center gap-2 text-neutral-900">
            <FileText className="w-5 h-5 text-emerald-600" />
            Cargar Documento
          </h2>
          <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-neutral-300 border-dashed rounded-xl cursor-pointer bg-neutral-50 hover:bg-neutral-100 transition-colors">
            <div className="flex flex-col items-center justify-center pt-4 pb-5 text-center px-4">
              <Upload className="w-7 h-7 mb-2 text-neutral-400" />
              <p className="mb-1 text-xs text-neutral-600">
                <span className="font-semibold text-emerald-700">Haz clic para subir</span> o arrastra aquí
              </p>
              <p className="text-[11px] text-neutral-400">PDF, JPG o PNG soportados</p>
            </div>
            <input type="file" className="hidden" accept="application/pdf,image/*" onChange={handleFileUpload} />
          </label>

          {fileName && (
            <div className="mt-3 p-2.5 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center justify-between text-emerald-700 text-xs">
              <div className="flex items-center gap-2 truncate">
                {fileType === 'pdf' ? <FileText className="w-4 h-4 shrink-0" /> : <ImageIcon className="w-4 h-4 shrink-0" />}
                <span className="truncate font-medium">{fileName}</span>
              </div>
              <button 
                onClick={resetWorkspace} 
                className="text-neutral-400 hover:text-red-500 p-1 transition-colors"
                title="Quitar archivo"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Preview Panel */}
      <div className="lg:col-span-8 flex flex-col">
        <div className="bg-neutral-200/50 border border-neutral-200 rounded-2xl p-4 flex-1 flex flex-col items-center overflow-auto min-h-[520px]">
          
          {!fileType ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center max-w-sm">
              <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-4">
                <FileText className="w-8 h-8 text-neutral-300" />
              </div>
              <h3 className="text-neutral-700 font-medium mb-2">No hay archivo cargado</h3>
              <p className="text-neutral-500 text-sm">
                Sube tu imagen (como la rutina de gimnasio) o un PDF. Luego, añade los códigos QR para colocarlos y alinearlos en su columna.
              </p>
            </div>
          ) : (
            <div className="relative w-full flex flex-col items-center">
              {/* Top helper status & quick alignment bar */}
              <div className="w-full flex items-center justify-between mb-3 text-xs text-neutral-700 bg-white/90 backdrop-blur-xs px-4 py-2.5 rounded-xl border border-neutral-200/90 shadow-2xs">
                <div className="flex items-center gap-2">
                  <Move className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    {qrs.length === 0 
                      ? 'Añade tu primer código QR desde el panel izquierdo.'
                      : selectedQrId 
                        ? `Arrastra el QR #${selectedIndex + 1} o muévelo con las flechas del teclado.`
                        : `${qrs.length} QR${qrs.length !== 1 ? 's' : ''} cargados. Haz clic en cualquiera para moverlo o alinearlo.`}
                  </span>
                </div>

                {/* Quick alignment shortcuts directly on preview canvas */}
                <div className="flex items-center gap-2">
                  {qrs.length >= 2 && (
                    <button
                      onClick={() => alignAllVertical()}
                      className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
                      title="Alinear todos los QRs en una columna recta (misma X)"
                    >
                      <ArrowUpDown className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Alinear Columna</span>
                    </button>
                  )}
                  {qrs.length >= 3 && (
                    <button
                      onClick={distributeVertical}
                      className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
                      title="Distribuir verticalmente de forma equidistante"
                    >
                      <Sliders className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Distribuir</span>
                    </button>
                  )}
                  {selectedQrId && (
                    <button
                      onClick={() => setSelectedQrId(null)}
                      className="text-neutral-400 hover:text-neutral-700 underline text-xs font-medium ml-1"
                    >
                      Deseleccionar
                    </button>
                  )}
                </div>
              </div>

              {/* Canvas Document Container */}
              <div 
                ref={containerRef} 
                className="relative inline-block shadow-xl max-w-full bg-white select-none rounded-lg overflow-hidden"
                onClick={() => setSelectedQrId(null)}
              >
                <canvas 
                  ref={canvasRef} 
                  className="block w-full h-auto pointer-events-none"
                  style={{ maxWidth: '100%' }}
                />
                
                {/* Robust Draggable QR Code Overlays */}
                {qrs.map((qr, index) => {
                  const isSelected = qr.id === selectedQrId;
                  const totalBoxSize = qrSize + (whiteBorderPadding * 2);

                  return (
                    <div
                      key={qr.id}
                      id={`qr-container-${qr.id}`}
                      onPointerDown={(e) => handlePointerDown(e, qr)}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={handlePointerUp}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedQrId(qr.id);
                      }}
                      className={`absolute cursor-grab active:cursor-grabbing select-none transition-shadow duration-150 ${
                        isSelected 
                          ? 'z-40 ring-2 ring-emerald-500 ring-offset-2 ring-offset-white shadow-2xl scale-105' 
                          : 'z-20 hover:ring-2 hover:ring-neutral-400/80 shadow-md'
                      }`}
                      style={{ 
                        left: `${qr.x}%`, 
                        top: `${qr.y}%`,
                        touchAction: 'none'
                      }}
                    >
                      {/* Numbered badge */}
                      <div 
                        className={`absolute -top-3 -left-3 w-5 h-5 rounded-full flex items-center justify-center shadow-md text-[10px] font-bold z-10 pointer-events-none transition-colors ${
                          isSelected ? 'bg-emerald-600 text-white ring-2 ring-white' : 'bg-neutral-900 text-white'
                        }`}
                      >
                        {index + 1}
                      </div>

                      {/* Move icon indicator */}
                      <div 
                        className={`absolute -top-3 -right-3 w-5 h-5 rounded-full flex items-center justify-center shadow-md z-10 pointer-events-none transition-opacity ${
                          isSelected ? 'bg-emerald-600 text-white opacity-100' : 'bg-neutral-700 text-white opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        <Move className="w-2.5 h-2.5" />
                      </div>

                      {/* Coordinates tooltip on selected */}
                      {isSelected && (
                        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 bg-neutral-900/90 text-white text-[9px] font-mono px-1.5 py-0.5 rounded shadow whitespace-nowrap pointer-events-none z-10">
                          X: {qr.x.toFixed(1)}% | Y: {qr.y.toFixed(1)}%
                        </div>
                      )}
                      
                      {/* Crisp white border (Quiet zone) wrapper around the QR canvas */}
                      <div 
                        className="bg-white rounded-xs overflow-hidden flex items-center justify-center shadow-xs"
                        style={{
                          padding: `${whiteBorderPadding}px`,
                          width: `${totalBoxSize}px`,
                          height: `${totalBoxSize}px`,
                        }}
                      >
                        <QRCodeCanvas 
                          id={`qr-canvas-${qr.id}`}
                          value={qr.url} 
                          size={1024} // High-resolution internal rendering
                          level={effectiveEcLevel}
                          fgColor={fgColor} 
                          bgColor={bgColor}
                          includeMargin={false}
                          className="block pointer-events-none"
                          style={{
                            width: `${qrSize}px`,
                            height: `${qrSize}px`,
                            imageRendering: 'pixelated', // Crisp rendering without blur
                          }}
                          imageSettings={showPlayIcon ? {
                            src: PLAY_ICON_URL,
                            height: 1024 * 0.24,
                            width: 1024 * 0.24,
                            excavate: true,
                          } : undefined}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>

        {/* Action Download Bar */}
        <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-neutral-200/80 shadow-2xs">
          <div className="text-xs text-neutral-600 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>
              {highResWhatsApp ? (
                <>Modo exportación: <strong>Súper-Resolución 2x Ultra HD</strong> (Listo para escanear en WhatsApp)</>
              ) : (
                <>Modo exportación: Resolución Original (1x)</>
              )}
            </span>
          </div>

          <button
            onClick={generateDocument}
            disabled={!fileType || qrs.length === 0 || isGenerating}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-neutral-300 disabled:cursor-not-allowed text-white py-3 px-6 rounded-xl font-semibold text-sm transition-colors shadow-sm"
          >
            {isGenerating ? (
              <span className="animate-pulse flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                Estampando con Ultra Nitidez...
              </span>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Descargar Documento Estampado ({qrs.length} QR{qrs.length !== 1 ? 's' : ''})
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
