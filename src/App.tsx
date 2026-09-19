import React from 'react';
import { QrCode } from 'lucide-react';
import PdfStamper from './components/PdfStamper';

export default function App() {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans selection:bg-emerald-200">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-sm shadow-emerald-500/20">
              <QrCode className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-neutral-900 leading-tight">Estampador de QR</h1>
              <p className="text-sm text-neutral-500 leading-tight">Estampa códigos QR en documentos PDF e imágenes</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 py-8">
        <PdfStamper />
      </main>
    </div>
  );
}

