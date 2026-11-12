import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import { linesFromItems } from './pdf-lines.mjs';

GlobalWorkerOptions.workerSrc = workerUrl;

export async function readPdf(file) {
  const loading = getDocument({data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false});
  try {
    const pdf = await loading.promise;
    const pages = [];
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      pages.push(linesFromItems(content.items));
    }
    const text = pages.join('\n');
    if (!text.trim()) throw new Error('В PDF нет текстового слоя. Для сканов потребуется OCR.');
    return text;
  } finally {
    await loading.destroy();
  }
}
