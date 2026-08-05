"use client";

import { useEffect, useRef } from "react";
import {
  resolveHveSequenceFrame,
  resolveHvePreviewFrame,
  type ClipDocumentV2,
  type ResolvedRenderPlan,
} from "@/packages/contracts/src";

type CaptionStyle = ClipDocumentV2["captions"]["style"];

type HveCompositionPreviewProps = {
  plan: ResolvedRenderPlan;
  captionStyle: CaptionStyle;
  outputTimeSeconds: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  secondaryVideoRef?: React.RefObject<HTMLVideoElement | null>;
  safeZonesVisible: boolean;
};

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const bounded = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.roundRect(x, y, width, height, bounded);
  context.clip();
}

function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && context.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else current = candidate;
  }
  if (current) lines.push(current);
  return lines;
}

function drawCaptionBlock(
  context: CanvasRenderingContext2D,
  lines: string[],
  style: CaptionStyle,
  width: number,
  height: number,
  scale: number,
) {
  if (!lines.length) return;
  const fontSize = Math.max(14, style.fontSizePx * scale);
  const lineHeight = Math.round(fontSize * 1.12);
  const margin = Math.max(8, style.safeMarginPx * scale);
  const displayLines = lines.map((line) => style.uppercase ? line.toUpperCase() : line);
  context.save();
  context.font = `${style.fontWeight} ${fontSize}px "HVE Sans", "Arial", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const maxWidth = width - margin * 2;
  const blockHeight = displayLines.length * lineHeight;
  const centerY = style.position === "top"
    ? margin + blockHeight / 2
    : style.position === "center"
      ? height / 2
      : height - margin - blockHeight / 2;
  if (style.background) {
    const textWidth = Math.min(maxWidth, Math.max(...displayLines.map((line) => context.measureText(line).width)) + fontSize * 0.5);
    context.fillStyle = "rgba(5, 15, 21, 0.76)";
    context.beginPath();
    context.roundRect((width - textWidth) / 2, centerY - blockHeight / 2 - fontSize * 0.16, textWidth, blockHeight + fontSize * 0.32, fontSize * 0.18);
    context.fill();
  }
  displayLines.forEach((line, index) => {
    const y = centerY - blockHeight / 2 + lineHeight * (index + 0.5);
    if (style.outlinePx > 0) {
      context.lineJoin = "round";
      context.lineWidth = Math.max(1, style.outlinePx * scale * 2);
      context.strokeStyle = style.outlineColor;
      context.strokeText(line, width / 2, y, maxWidth);
    }
    context.fillStyle = style.color;
    context.fillText(line, width / 2, y, maxWidth);
  });
  context.restore();
}

function drawTextLayer(
  context: CanvasRenderingContext2D,
  layer: Extract<ReturnType<typeof resolveHvePreviewFrame>, object>["layers"][number],
  scale: number,
) {
  if (layer.type !== "text") return;
  const { destinationPx, style } = layer;
  const x = destinationPx.x * scale;
  const y = destinationPx.y * scale;
  const width = destinationPx.width * scale;
  const height = destinationPx.height * scale;
  const fontSize = Math.max(12, style.fontSizePx * scale);
  context.save();
  context.globalAlpha = layer.opacity;
  context.font = `${style.fontWeight} ${fontSize}px "${style.fontFamily}", Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const lines = fitText(context, layer.text, width * 0.92);
  const lineHeight = fontSize * 1.14;
  const totalHeight = lineHeight * lines.length;
  if (style.background) {
    context.fillStyle = "rgba(5, 15, 21, 0.72)";
    context.beginPath();
    context.roundRect(x, y, width, height, Math.min(width, height) * 0.06);
    context.fill();
  }
  lines.forEach((line, index) => {
    const lineY = y + height / 2 - totalHeight / 2 + lineHeight * (index + 0.5);
    context.lineJoin = "round";
    context.lineWidth = Math.max(1, style.outlinePx * scale * 2);
    context.strokeStyle = style.outlineColor;
    context.strokeText(line, x + width / 2, lineY, width * 0.92);
    context.fillStyle = style.color;
    context.fillText(line, x + width / 2, lineY, width * 0.92);
  });
  context.restore();
}

/**
 * Canvas projection of a resolver-approved HVE plan.
 *
 * The source <video> remains the media clock/audio source. Canvas only draws
 * the immutable output geometry from the same plan passed to the worker. It
 * is intentionally not mounted for tracked crops, blur or private assets —
 * those paths require a richer verified preview pipeline.
 */
export function HveCompositionPreview({
  plan,
  captionStyle,
  outputTimeSeconds,
  videoRef,
  secondaryVideoRef,
  safeZonesVisible,
}: HveCompositionPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const outputUs = Math.max(0, Math.floor(outputTimeSeconds * 1_000_000));
    const sequenceFrame = resolveHveSequenceFrame(plan.timeMap, outputUs);
    const primaryPoint = sequenceFrame?.kind === "crossfade" ? sequenceFrame.from : sequenceFrame?.point;
    const frame = primaryPoint
      ? resolveHvePreviewFrame(plan, outputUs, { timeMapEntryIndex: primaryPoint.entryIndex })
      : null;
    const rect = canvas.getBoundingClientRect();
    const logicalWidth = Math.max(1, Math.round(rect.width));
    const logicalHeight = Math.max(1, Math.round(rect.height));
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(logicalWidth * pixelRatio);
    const pixelHeight = Math.round(logicalHeight * pixelRatio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, logicalWidth, logicalHeight);
    context.fillStyle = "#0a0a0b";
    context.fillRect(0, 0, logicalWidth, logicalHeight);
    if (!frame || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return;

    const scaleX = logicalWidth / frame.canvas.width;
    const scaleY = logicalHeight / frame.canvas.height;
    const drawSlots = (source: HTMLVideoElement, previewFrame: NonNullable<typeof frame>, opacity = 1) => {
      context.save();
      context.globalAlpha = opacity;
      for (const slot of previewFrame.slots) {
        const destination = slot.destinationPx;
        const crop = slot.sourceCrop;
        const dx = destination.x * scaleX;
        const dy = destination.y * scaleY;
        const dw = destination.width * scaleX;
        const dh = destination.height * scaleY;
        context.save();
        roundedRect(context, dx, dy, dw, dh, slot.cornerRadiusPx * Math.min(scaleX, scaleY));
        context.drawImage(
          source,
          crop.x * source.videoWidth,
          crop.y * source.videoHeight,
          crop.width * source.videoWidth,
          crop.height * source.videoHeight,
          dx,
          dy,
          dw,
          dh,
        );
        context.restore();
      }
      context.restore();
    };
    drawSlots(video, frame);
    if (sequenceFrame?.kind === "crossfade") {
      const secondary = secondaryVideoRef?.current;
      const secondaryFrame = resolveHvePreviewFrame(plan, outputUs, { timeMapEntryIndex: sequenceFrame.to.entryIndex });
      if (secondaryFrame
        && secondary
        && secondary.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && secondary.videoWidth
        && secondary.videoHeight) {
        drawSlots(secondary, secondaryFrame, sequenceFrame.progress);
      }
    }
    for (const layer of frame.layers) drawTextLayer(context, layer, Math.min(scaleX, scaleY));
    const captionLines = frame.captions.flatMap((caption) => caption.lines);
    drawCaptionBlock(context, captionLines, captionStyle, logicalWidth, logicalHeight, Math.min(scaleX, scaleY));
    if (safeZonesVisible) {
      context.save();
      context.setLineDash([6, 6]);
      context.lineWidth = 1;
      context.strokeStyle = "rgba(255, 255, 255, 0.72)";
      const margin = Math.max(8, captionStyle.safeMarginPx * Math.min(scaleX, scaleY));
      context.strokeRect(margin, margin, logicalWidth - margin * 2, logicalHeight - margin * 2);
      context.restore();
    }
  }, [captionStyle, outputTimeSeconds, plan, safeZonesVisible, secondaryVideoRef, videoRef]);

  return <canvas className="clip-phone-preview__composition" ref={canvasRef} aria-label="Композиционный предпросмотр HVE" />;
}
