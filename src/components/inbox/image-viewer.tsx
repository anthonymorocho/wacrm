'use client';

import { useState } from 'react';
import { Minus, Plus, RotateCcw, X, ZoomIn } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  adjustImageZoom,
  clampImageZoom,
  IMAGE_ZOOM_MAX,
  IMAGE_ZOOM_MIN,
} from '@/lib/image-viewer';

interface ImageViewerProps {
  src: string;
  alt: string;
  onError?: () => void;
}

export function ImageViewer({ src, alt, onError }: ImageViewerProps) {
  const t = useTranslations('Inbox.bubble');
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(IMAGE_ZOOM_MIN);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) setZoom(IMAGE_ZOOM_MIN);
  }

  function changeZoom(direction: 1 | -1) {
    setZoom((current) => adjustImageZoom(current, direction));
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative block max-w-60 cursor-zoom-in rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={t('openImage')}
      >
        <img
          src={src}
          alt={alt}
          className="max-h-64 max-w-60 rounded-lg object-contain"
          onError={onError}
        />
        <span className="pointer-events-none absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-1 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <ZoomIn className="size-3" aria-hidden />
          <span>{t('openImage')}</span>
        </span>
      </button>

      <DialogContent
        showCloseButton={false}
        className="flex h-[min(90vh,800px)] max-w-6xl flex-col gap-3 border-border bg-black/95 p-3 text-white sm:p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <DialogTitle className="truncate text-sm text-white">
            {t('imageViewerTitle')}
          </DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => handleOpenChange(false)}
            className="shrink-0 text-white hover:bg-white/10 hover:text-white"
            aria-label={t('closeImage')}
            title={t('closeImage')}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
        <DialogDescription className="sr-only">
          {t('imageViewerDescription')}
        </DialogDescription>

        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-white/10 bg-black/30 p-2 sm:p-4">
          <div className="flex min-h-full min-w-full items-center justify-center">
            <img
              src={src}
              alt={alt}
              draggable={false}
              className="max-h-full max-w-full object-contain transition-transform duration-150"
              style={{ transform: `scale(${zoom})` }}
              onError={onError}
            />
          </div>
        </div>

        <div
          className="flex items-center justify-center gap-1"
          role="toolbar"
          aria-label={t('imageControls')}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => changeZoom(-1)}
            disabled={zoom <= IMAGE_ZOOM_MIN}
            className="text-white hover:bg-white/10 hover:text-white"
            aria-label={t('zoomOut')}
            title={t('zoomOut')}
          >
            <Minus className="size-4" aria-hidden />
          </Button>
          <span className="min-w-14 text-center text-xs font-medium tabular-nums text-white">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => changeZoom(1)}
            disabled={zoom >= IMAGE_ZOOM_MAX}
            className="text-white hover:bg-white/10 hover:text-white"
            aria-label={t('zoomIn')}
            title={t('zoomIn')}
          >
            <Plus className="size-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setZoom(clampImageZoom(IMAGE_ZOOM_MIN))}
            disabled={zoom === IMAGE_ZOOM_MIN}
            className="ml-2 text-white hover:bg-white/10 hover:text-white"
            aria-label={t('resetZoom')}
            title={t('resetZoom')}
          >
            <RotateCcw className="size-4" aria-hidden />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
