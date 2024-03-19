import DetachableDOM from "../detachableDOM";

// used for development purposes only
const PDF_OVERLAY_ELEMENT_BACKGROUND: string | null = null;

export const PDF_OVERLAY_ELEMENT_CLASS_NAME = "tidy-tabs-pdfViewerOverlay";
let pdfViewerOverlayElement: HTMLElement | null = null;
let pdfViewerOverlayElementAttached = false;

export function createPdfViewerOverlayElement() {
  const pdfViewerOverlayElement = document.createElement("div");
  pdfViewerOverlayElement.setAttribute("id", `${PDF_OVERLAY_ELEMENT_CLASS_NAME}`);

  pdfViewerOverlayElement.style.position = "fixed";
  pdfViewerOverlayElement.style.zIndex = "2147483647";
  pdfViewerOverlayElement.style.top = "0";
  pdfViewerOverlayElement.style.left = "0";
  pdfViewerOverlayElement.style.width = "100%";
  pdfViewerOverlayElement.style.height = "100%";

  if (PDF_OVERLAY_ELEMENT_BACKGROUND) {
    pdfViewerOverlayElement.style.background = PDF_OVERLAY_ELEMENT_BACKGROUND;
  }

  return pdfViewerOverlayElement;
}

export function attach() {
  if (pdfViewerOverlayElementAttached) {
    throw new Error("PDFViewerOverlay is already attached");
  }

  if (!pdfViewerOverlayElement) {
    pdfViewerOverlayElement = createPdfViewerOverlayElement();
  }

  DetachableDOM.appendChild(document.body, pdfViewerOverlayElement);
  pdfViewerOverlayElementAttached = true;
}

export function remove() {
  if (!attached()) {
    throw new Error("PDFViewerOverlay is not attached");
  }

  if (!pdfViewerOverlayElement) {
    throw new Error("Internal error: pdfViewerOverlayElement is null");
  }

  DetachableDOM.remove(pdfViewerOverlayElement);
  pdfViewerOverlayElementAttached = false;
}

export function attached() {
  return pdfViewerOverlayElementAttached;
}

export function isPDFViewerOverlay(element: HTMLElement) {
  return element === pdfViewerOverlayElement;
}
