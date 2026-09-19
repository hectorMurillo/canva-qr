import React, { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { QRCodeCanvas } from 'qrcode.react';
import { PDFDocument, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { Upload, Download, Settings, FileText, Move, Image as ImageIcon, Plus, Trash2 } from 'lucide-react';

// Configure the worker for pdf.js using a CDN to ensure compatibility
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

type QROverlay = {
  id: string;
  url: string;
};

export default function PdfStamper() {
  const [fileType, setFileType] = useState<'pdf' | 'image' | null>(null);
  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null);
  const [originalImage, setOriginalImage] = useState<HTMLImageElement | null>(null);
  
  const [qrs, setQrs] = useState<QROverlay[]>([]);
  const [currentUrl, setCurrentUrl] = useState('');
  
  const [qrSize, setQrSize] = useState(30);
  const [fgColor, setFgColor] = useState('#000000');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [isGenerating, setIsGenerating] = useState(false);
  const [fileName, setFileName] = useState('');
  const [showPlayIcon, setShowPlayIcon] = useState(true);

  const PLAY_ICON_URL = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='12' fill='%23ef4444'/%3E%3Cpath d='M10 7.5l6 4.5-6 4.5v-9z' fill='%23ffffff'/%3E%3C/svg%3E";

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleAddQr = () => {
    if (!currentUrl.trim()) return;
    setQrs(prev => [...prev, { id: crypto.randomUUID(), url: currentUrl.trim() }]);
    setCurrentUrl('');
  };

  const removeQr = (id: string) => {
    setQrs(prev => prev.filter(q => q.id !== id));
  };

  const resetWorkspace = () => {
    setFileType(null);
    setPdfBuffer(null);
    setOriginalImage(null);
    setQrs([]);
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
      const qrElements = containerRef.current.querySelectorAll<HTMLElement>('.qr-overlay-element');

      if (fileType === 'pdf' && pdfBuffer) {
        const pdfDoc = await PDFDocument.load(pdfBuffer);
        const pages = pdfDoc.getPages();
        const page = pages[0];
        
        const { width: pdfW, height: pdfH } = page.getSize();
        const scaleX = pdfW / containerRect.width;
        const scaleY = pdfH / containerRect.height;

        for (const el of Array.from(qrElements) as HTMLElement[]) {
          const qrRect = el.getBoundingClientRect();
          const relX = qrRect.left - containerRect.left;
          const relY = qrRect.top - containerRect.top;
          
          const finalX = relX * scaleX;
          const finalWidth = qrRect.width * scaleX;
          const finalHeight = qrRect.height * scaleY;
          const finalY = pdfH - ((relY + qrRect.height) * scaleY);

          const qrCanvas = el.querySelector('canvas');
          if (qrCanvas) {
            const canvasRect = qrCanvas.getBoundingClientRect();
            
            const canvasRelX = canvasRect.left - qrRect.left;
            const canvasRelY = canvasRect.top - qrRect.top;
            
            const qrFinalX = finalX + (canvasRelX * scaleX);
            const qrFinalY = finalY + ((qrRect.height - canvasRelY - canvasRect.height) * scaleY);
            const qrFinalWidth = canvasRect.width * scaleX;
            const qrFinalHeight = canvasRect.height * scaleY;

            page.drawRectangle({
              x: finalX,
              y: finalY,
              width: finalWidth,
              height: finalHeight,
              color: rgb(1, 1, 1),
            });

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
        
        for (const el of Array.from(qrElements) as HTMLElement[]) {
          const qrRect = el.getBoundingClientRect();
          const relX = qrRect.left - containerRect.left;
          const relY = qrRect.top - containerRect.top;
          
          const finalX = relX * scaleX;
          const finalY = relY * scaleY;
          const finalWidth = qrRect.width * scaleX;
          const finalHeight = qrRect.height * scaleY;
          
          const qrCanvas = el.querySelector('canvas');
          if (qrCanvas) {
            const canvasRect = qrCanvas.getBoundingClientRect();
            
            const canvasRelX = canvasRect.left - qrRect.left;
            const canvasRelY = canvasRect.top - qrRect.top;
            
            const qrFinalX = finalX + (canvasRelX * scaleX);
            const qrFinalY = finalY + (canvasRelY * scaleY);
            const qrFinalWidth = canvasRect.width * scaleX;
            const qrFinalHeight = canvasRect.height * scaleY;

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(finalX, finalY, finalWidth, finalHeight);

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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      {/* Configuration Panel */}
      <div className="lg:col-span-4 space-y-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200/60">
          <h2 className="text-base font-semibold mb-5 flex items-center gap-2">
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
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white rounded-xl transition-colors font-medium flex items-center justify-center"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
            </div>

            {qrs.length > 0 && (
              <div className="bg-neutral-50 rounded-xl border border-neutral-200 p-3 space-y-2 max-h-[150px] overflow-y-auto">
                {qrs.map((qr, index) => (
                  <div key={qr.id} className="flex items-center justify-between gap-2 bg-white p-2 rounded-lg border border-neutral-200 shadow-sm text-sm">
                    <div className="truncate flex-1 flex items-center gap-2">
                      <span className="bg-emerald-100 text-emerald-700 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0">{index + 1}</span>
                      <span className="truncate" title={qr.url}>{qr.url}</span>
                    </div>
                    <button onClick={() => removeQr(qr.id)} className="text-neutral-400 hover:text-red-500 p-1">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

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

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200/60">
           <h2 className="text-base font-semibold mb-5 flex items-center gap-2">
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
            <div className="mt-4 p-3 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center gap-2 text-emerald-700 text-sm">
              {fileType === 'pdf' ? <FileText className="w-4 h-4 shrink-0" /> : <ImageIcon className="w-4 h-4 shrink-0" />}
              <span className="truncate font-medium">{fileName}</span>
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
            <div className="relative w-full flex justify-center">
              {/* Container - important that it is relatively positioned for dragging constraints */}
              <div 
                ref={containerRef} 
                className="relative inline-block shadow-xl max-w-full overflow-hidden bg-white"
                style={{ cursor: 'crosshair' }}
              >
                <canvas 
                  ref={canvasRef} 
                  className="block w-full h-auto"
                  style={{ maxWidth: '100%', pointerEvents: 'none' }}
                />
                
                {/* Draggable QR Code Overlays */}
                {qrs.map((qr, index) => (
                  <motion.div
                    key={qr.id}
                    drag
                    dragMomentum={false}
                    dragConstraints={containerRef}
                    className="absolute cursor-move group qr-overlay-element"
                    style={{ top: `${10 + (index * 5)}%`, left: `${10 + (index * 5)}%` }}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                  >
                    <div className="absolute -top-3 -right-3 w-6 h-6 bg-emerald-500 text-white rounded-full flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                      <Move className="w-3 h-3" />
                    </div>
                    <div className="absolute -top-3 -left-3 w-6 h-6 bg-neutral-900 text-white rounded-full flex items-center justify-center shadow-md z-10 pointer-events-none text-xs font-bold">
                      {index + 1}
                    </div>
                    
                    <div 
                      className="bg-white p-1 shadow-lg ring-2 ring-emerald-500/0 group-hover:ring-emerald-500/50 transition-all rounded overflow-hidden"
                    >
                      <QRCodeCanvas 
                        value={qr.url} 
                        size={512} 
                        level={showPlayIcon ? "H" : "M"}
                        fgColor={fgColor} 
                        bgColor={bgColor}
                        includeMargin={false}
                        className="block"
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
                  </motion.div>
                ))}
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
                Descargar Archivo Estampado
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
