"use client";

import { Modal } from "@heroui/react";
import { X } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { track } from "../../lib/analytics";
import { BlogUrlForm } from "./blog-url-form";

const WEEK = 7 * 24 * 60 * 60 * 1000;

export function ArticleExperience({
  slug,
  ctaTitle,
  ctaDescription,
}: {
  slug: string;
  ctaTitle: string;
  ctaDescription: string;
}) {
  const [progress, setProgress] = useState(0);
  const [open, setOpen] = useState(false);
  const storageKey = `4short:article-cta:${slug}`;

  useEffect(() => {
    track("article_view", { slug });
    let trackedThreshold = false;

    const update = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = scrollable > 0 ? Math.min(1, window.scrollY / scrollable) : 0;
      setProgress(ratio);

      if (ratio < 0.55 || trackedThreshold) return;
      trackedThreshold = true;
      track("article_scroll_55", { slug });

      const suppressedUntil = Number(localStorage.getItem(storageKey) ?? 0);
      if (suppressedUntil > Date.now()) return;
      if (document.querySelector('[role="dialog"]')) return;
      setOpen(true);
      track("article_modal_open", { slug });
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [slug, storageKey]);

  const suppress = (reason: "close" | "success") => {
    localStorage.setItem(storageKey, String(Date.now() + WEEK));
    if (reason === "close") track("article_modal_close", { slug });
    setOpen(false);
  };

  return (
    <>
      <div className="reading-progress" aria-hidden="true">
        <span style={{ "--reading-progress": progress } as CSSProperties} />
      </div>

      <Modal.Backdrop
        isOpen={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && open) suppress("close");
          else setOpen(nextOpen);
        }}
        variant="blur"
      >
        <Modal.Container placement="center">
          <Modal.Dialog className="article-modal squircle">
            <Modal.CloseTrigger aria-label="Закрыть предложение" className="article-modal__close">
              <X size={20} aria-hidden="true" />
            </Modal.CloseTrigger>
            <Modal.Header>
              <span className="article-modal__eyebrow">Попробуйте на своём видео</span>
              <Modal.Heading>{ctaTitle}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p>{ctaDescription}</p>
              <BlogUrlForm
                slug={slug}
                placement="modal"
                onSuccess={() => suppress("success")}
              />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
