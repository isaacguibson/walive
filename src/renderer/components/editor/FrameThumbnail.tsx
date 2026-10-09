import { memo, useEffect, useRef, useState } from 'react';
import type { AnimationEngine } from '@editor/animation/animationEngine';
import type { Frame } from '@editor/model';
import { renderFrameThumbnail, thumbnailSize } from '@editor/thumbnail';

const THUMBNAIL_MAX_EDGE = 96;

interface FrameThumbnailProps {
  frame: Frame;
  engine: AnimationEngine;
  /** The active frame is the only one whose pixels can change while it is shown. */
  live: boolean;
}

/** Small preview of a frame. Only drawn while visible so very long timelines stay cheap. */
export const FrameThumbnail = memo(function FrameThumbnail({ frame, engine, live }: FrameThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  const size = thumbnailSize(engine.width, engine.height, THUMBNAIL_MAX_EDGE);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (visible || canvas === null || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!visible || canvas === null) {
      return undefined;
    }
    const draw = () => {
      const context = canvas.getContext('2d');
      if (context === null) {
        return;
      }
      const image = context.createImageData(size.width, size.height);
      image.data.set(renderFrameThumbnail(frame, engine.width, engine.height, size.width, size.height));
      context.putImageData(image, 0, 0);
    };
    draw();
    return live ? engine.subscribeContent(draw) : undefined;
  }, [visible, frame, live, engine, size.width, size.height]);

  return <canvas ref={canvasRef} className="frame-thumbnail" width={size.width} height={size.height} aria-hidden="true" />;
});
