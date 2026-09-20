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
  RotateCcw
} from 'lucide-react';

// Configure the worker for pdf.js using a CDN to ensure compatibility
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

type QROverlay = {
  id: string;
  url: string;
  x: number; // percentage from left (0 - 100)
  y: number; // percentage from top (0 - 100)
};

export default function PdfStamper() {
  const [fileType, setFileType] = useState<'pdf' | 'image' | null>(null);
  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null);
  const [originalImage, setOriginalImage] = useState<HTMLImageElement | null>(null);
  
  const [qrs, setQrs] = useState<QROverlay[]>([]);
  const [selectedQrId, setSelectedQrId] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState('');
  
  const [qrSize, setQrSize] = useState(30);
  const [fgColor, setFgColor] = useState('#000000');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [isGenerating, setIsGenerating] = useState(false);
  const [fileName, setFileName] = useState('');
  const [showPlayIcon, setShowPlayIcon] = useState(true);
  const [nudgeStep, setNudgeStep] = useState<number>(0.5);

  const PLAY_ICON_URL = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='12' fill='%23ef4444'/%3E%3Cpath d='M10 7.5l6 4.5-6 4.5v-9z' fill='%23ffffff'/%3E%3C/svg%3E";

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const handleAddQr = () => {
    if (!currentUrl.trim()) return;
    
    // Smart distributed positioning for each additional QR code
    const count = qrs.length;
    let initX = 10;
    let initY = 10;
    if (count === 1) {
      initX = 70;
      initY = 10;
    } else if (count === 2) {
      initX = 10;
      initY = 70;
    } else if (count === 3) {
      initX = 70;
      initY = 70;
    } else {
      initX = (15 + (count * 14)) % 75;
      initY = (15 + (count * 12)) % 75;
    }

    const newQr: QROverlay = {
      id: crypto.randomUUID(),
      url: currentUrl.trim(),
      x: initX,
      y: initY,
    };

    setQrs(prev => [...prev, newQr]);
    setSelectedQrId(newQr.id);
    setCurrentUrl('');
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
        x: Math.max(0, Math.min(95, Number(newX.toFixed(2)))),
        y: Math.max(0, Math.min(95, Number(newY.toFixed(2)))),
      };
    }));
  };

  const nudgeSelectedQr = (dx: number, dy: number) => {
    if (!selectedQrId) return;
    const qr = qrs.find(q => q.id === selectedQrId);
    if (!qr) return;
    updateQrPosition(qr.id, qr.x + dx, qr.y + dy);
  };

  const setPresetPosition = (preset: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center') => {
    if (!selectedQrId) return;
    let px = 5;
    let py = 5;
    switch (preset) {
      case 'top-left': px = 5; py = 5; break;
      case 'top-right': px = 78; py = 5; break;
      case 'bottom-left': px = 5; py = 78; break;
      case 'bottom-right': px = 78; py = 78; break;
      case 'center': px = 45; py = 45; break;
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

    const newX = Math.max(0, Math.min(95, Number((startQrX + deltaPctX).toFixed(2))));
    const newY = Math.max(0, Math.min(95, Number((startQrY + deltaPctY).toFixed(2))));

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

  const generateDocument = async () => {
    if (!fileType || !containerRef.current || qrs.length === 0) return;
    setIsGenerating(true);

    try {
      const containerRect = containerRef.current.getBoundingClientRect();
      const padding = 4; // 4px padding in the white box
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
          // PDF coordinate system origin is at bottom-left
          const finalY = pdfH - ((relY + totalBoxHeight) * scaleY);

          // Draw white background card/border
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
          if (window.confirm("¡Documento descargado exitosamente!\n\n¿Deseas recargar y limpiar el espacio de trabajo para procesar otro documento?")) {
            resetWorkspace();
          }
        }, 1000);
      } else if (fileType === 'image' && originalImage) {
        const canvas = document.createElement('canvas');
        canvas.width = originalImage.width;
        canvas.height = originalImage.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(originalImage, 0, 0);
        
        const scaleX = originalImage.width / containerRect.width;
        const scaleY = originalImage.height / containerRect.height;
        
        for (const qr of qrs) {
          const relX = (qr.x / 100) * containerRect.width;
          const relY = (qr.y / 100) * containerRect.height;
          
          const finalX = relX * scaleX;
          const finalY = relY * scaleY;
          const finalWidth = totalBoxWidth * scaleX;
          const finalHeight = totalBoxHeight * scaleY;

          // Draw white background card/border
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(finalX, finalY, finalWidth, finalHeight);

          const qrCanvas = document.getElementById(`qr-canvas-${qr.id}`) as HTMLCanvasElement | null;
          if (qrCanvas) {
            const qrFinalX = finalX + (padding * scaleX);
            const qrFinalY = finalY + (padding * scaleY);
            const qrFinalWidth = qrSize * scaleX;
            const qrFinalHeight = qrSize * scaleY;

            ctx.drawImage(qrCanvas, qrFinalX, qrFinalY, qrFinalWidth, qrFinalHeight);
          }
        }
        
        canvas.toBlob((blob) => {
          if (!blob) return;
          const objectUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = objectUrl;
          link.download = `QR_${fileName.split('.')[0]}.png`;
          link.click();
          
          setIsGenerating(false);

          setTimeout(() => {
            URL.revokeObjectURL(objectUrl);
            if (window.confirm("¡Imagen descargada exitosamente!\n\n¿Deseas recargar y limpiar el espacio de trabajo para procesar otra imagen?")) {
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      {/* Configuration Panel */}
      <div className="lg:col-span-4 space-y-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200/60 space-y-5">
          <h2 className="text-base font-semibold flex items-center gap-2 text-neutral-900">
            <Settings className="w-5 h-5 text-emerald-600" />
            Configuración de QRs
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">Añadir Enlace QR</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={currentUrl}
                  onChange={(e) => setCurrentUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddQr()}
                  placeholder="https://ejemplo.com"
                  className="flex-1 px-4 py-2 bg-neutral-50 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors text-sm"
                />
                <button
                  onClick={handleAddQr}
                  disabled={!currentUrl.trim()}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white rounded-xl transition-colors font-medium flex items-center justify-center shadow-sm"
                  title="Añadir este código QR"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* List of active QRs */}
            {qrs.length > 0 && (
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                  Códigos QR Añadidos ({qrs.length})
                </label>
                <div className="bg-neutral-50 rounded-xl border border-neutral-200 p-2.5 space-y-1.5 max-h-[180px] overflow-y-auto">
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
                            <span className="text-[11px] text-neutral-500">
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

            {/* Precision Position Controls for Selected QR */}
            {selectedQr && (
              <div className="p-3.5 bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-emerald-900 font-semibold text-xs">
                    <Crosshair className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Control de Precisión (QR #{selectedIndex + 1})</span>
                  </div>
                  <div className="text-[11px] font-mono text-emerald-700 font-medium">
                    X: {selectedQr.x.toFixed(1)}% | Y: {selectedQr.y.toFixed(1)}%
                  </div>
                </div>

                {/* D-Pad Arrows for micro-movements */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="grid grid-cols-3 gap-1 w-28">
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

                  {/* Step Selector and Quick Presets */}
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-neutral-600">
                      <span>Paso:</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setNudgeStep(0.2)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${nudgeStep === 0.2 ? 'bg-emerald-600 text-white' : 'bg-white border text-neutral-600'}`}
                        >
                          Fino (0.2%)
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
                          Rápido (2%)
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1 text-[10px]">
                      <button
                        onClick={() => setPresetPosition('top-left')}
                        className="p-1 bg-white hover:bg-neutral-100 border border-emerald-200 rounded text-neutral-700"
                      >
                        ↖ Sup. Izq.
                      </button>
                      <button
                        onClick={() => setPresetPosition('top-right')}
                        className="p-1 bg-white hover:bg-neutral-100 border border-emerald-200 rounded text-neutral-700"
                      >
                        ↗ Sup. Der.
                      </button>
                      <button
                        onClick={() => setPresetPosition('bottom-left')}
                        className="p-1 bg-white hover:bg-neutral-100 border border-emerald-200 rounded text-neutral-700"
                      >
                        ↙ Inf. Izq.
                      </button>
                      <button
                        onClick={() => setPresetPosition('bottom-right')}
                        className="p-1 bg-white hover:bg-neutral-100 border border-emerald-200 rounded text-neutral-700"
                      >
                        ↘ Inf. Der.
                      </button>
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-emerald-800/80 leading-snug">
                  💡 También puedes usar las <strong>flechas del teclado (← ↑ → ↓)</strong> para ajustar la posición milimétricamente (mantén Shift para mover más rápido).
                </p>
              </div>
            )}

            {/* Global QR appearance settings */}
            <div className="grid grid-cols-2 gap-4 pt-3 border-t border-neutral-100">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">Color (Trazos)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={fgColor}
                    onChange={(e) => setFgColor(e.target.value)}
                    className="w-10 h-10 rounded cursor-pointer border-0 p-0"
                  />
                  <span className="text-sm text-neutral-500 uppercase">{fgColor}</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">Color (Fondo)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={bgColor}
                    onChange={(e) => setBgColor(e.target.value)}
                    className="w-10 h-10 rounded cursor-pointer border-0 p-0"
                  />
                  <span className="text-sm text-neutral-500 uppercase">{bgColor}</span>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1.5 flex justify-between">
                Tamaño del QR
                <span className="text-neutral-500 font-normal">{qrSize}px</span>
              </label>
              <input
                type="range"
                min="10"
                max="50"
                value={qrSize}
                onChange={(e) => setQrSize(Number(e.target.value))}
                className="w-full accent-emerald-600"
              />
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="play-icon-toggle-pdf"
                checked={showPlayIcon}
                onChange={(e) => setShowPlayIcon(e.target.checked)}
                className="w-4 h-4 text-emerald-600 rounded border-neutral-300 focus:ring-emerald-600 cursor-pointer"
              />
              <label htmlFor="play-icon-toggle-pdf" className="text-sm text-neutral-700 font-medium cursor-pointer">
                Añadir icono de "Play" al centro
              </label>
            </div>
          </div>
        </div>

        {/* Upload Document Panel */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200/60">
          <h2 className="text-base font-semibold mb-4 flex items-center gap-2 text-neutral-900">
            <FileText className="w-5 h-5 text-emerald-600" />
            Cargar Documento
          </h2>
          <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-neutral-300 border-dashed rounded-xl cursor-pointer bg-neutral-50 hover:bg-neutral-100 transition-colors">
            <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center px-4">
              <Upload className="w-8 h-8 mb-3 text-neutral-400" />
              <p className="mb-2 text-sm text-neutral-500">
                <span className="font-semibold">Haz clic para subir</span> o arrastra
              </p>
              <p className="text-xs text-neutral-400">PDF, JPG o PNG soportados</p>
            </div>
            <input type="file" className="hidden" accept="application/pdf,image/*" onChange={handleFileUpload} />
          </label>

          {fileName && (
            <div className="mt-4 p-3 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center justify-between text-emerald-700 text-sm">
              <div className="flex items-center gap-2 truncate">
                {fileType === 'pdf' ? <FileText className="w-4 h-4 shrink-0" /> : <ImageIcon className="w-4 h-4 shrink-0" />}
                <span className="truncate font-medium">{fileName}</span>
              </div>
              <button 
                onClick={resetWorkspace} 
                className="text-neutral-400 hover:text-red-500 p-1"
                title="Quitar archivo"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Preview Panel */}
      <div className="lg:col-span-8 flex flex-col">
        <div className="bg-neutral-200/50 border border-neutral-200 rounded-2xl p-4 flex-1 flex flex-col items-center overflow-auto min-h-[500px]">
          
          {!fileType ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center max-w-sm">
              <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-4">
                <FileText className="w-8 h-8 text-neutral-300" />
              </div>
              <h3 className="text-neutral-700 font-medium mb-2">No hay archivo cargado</h3>
              <p className="text-neutral-500 text-sm">
                Sube un PDF o una Imagen en el panel izquierdo. Luego, añade códigos QR para colocarlos donde desees.
              </p>
            </div>
          ) : (
            <div className="relative w-full flex flex-col items-center">
              {/* Top helper status bar */}
              <div className="w-full flex items-center justify-between mb-3 text-xs text-neutral-600 bg-white/80 backdrop-blur-xs px-4 py-2 rounded-xl border border-neutral-200/80 shadow-2xs">
                <div className="flex items-center gap-2">
                  <Move className="w-3.5 h-3.5 text-emerald-600" />
                  <span>
                    {qrs.length === 0 
                      ? 'Añade tu primer código QR desde el panel izquierdo.'
                      : selectedQrId 
                        ? `Arrastra el QR #${selectedIndex + 1} o muévelo con las flechas del teclado.`
                        : 'Haz clic en cualquier QR para moverlo y ajustar su posición.'}
                  </span>
                </div>
                {selectedQrId && (
                  <button
                    onClick={() => setSelectedQrId(null)}
                    className="text-neutral-400 hover:text-neutral-700 underline font-medium"
                  >
                    Deseleccionar
                  </button>
                )}
              </div>

              {/* Canvas Document Container */}
              <div 
                ref={containerRef} 
                className="relative inline-block shadow-xl max-w-full bg-white select-none"
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
                          {qr.x.toFixed(1)}%, {qr.y.toFixed(1)}%
                        </div>
                      )}
                      
                      {/* Clean white border wrapper around the QR canvas */}
                      <div className="bg-white p-1 rounded overflow-hidden">
                        <QRCodeCanvas 
                          id={`qr-canvas-${qr.id}`}
                          value={qr.url} 
                          size={512} 
                          level={showPlayIcon ? "H" : "M"}
                          fgColor={fgColor} 
                          bgColor={bgColor}
                          includeMargin={false}
                          className="block pointer-events-none"
                          style={{
                            width: `${qrSize}px`,
                            height: `${qrSize}px`,
                            imageRendering: 'pixelated',
                          }}
                          imageSettings={showPlayIcon ? {
                            src: PLAY_ICON_URL,
                            height: 512 * 0.24,
                            width: 512 * 0.24,
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

        {/* Action Bar */}
        <div className="mt-4 flex justify-end">
          <button
            onClick={generateDocument}
            disabled={!fileType || qrs.length === 0 || isGenerating}
            className="flex items-center justify-center gap-2 bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-300 disabled:cursor-not-allowed text-white py-3 px-6 rounded-xl font-medium transition-colors shadow-sm"
          >
            {isGenerating ? (
              <span className="animate-pulse">Procesando Archivo...</span>
            ) : (
              <>
                <Download className="w-5 h-5" />
                Descargar Archivo Estampado ({qrs.length} QR{qrs.length !== 1 ? 's' : ''})
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
