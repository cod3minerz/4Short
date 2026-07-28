"use client";

import { Button, Input } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { track } from "../../lib/analytics";

const youtubeSchema = z.object({
  url: z
    .string()
    .trim()
    .url("Вставьте полную ссылку")
    .refine(
      (value) => /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(new URL(value).hostname),
      "Нужна ссылка на YouTube",
    ),
});

type YoutubeForm = z.infer<typeof youtubeSchema>;

export function BlogUrlForm({
  slug,
  placement,
  onSuccess,
}: {
  slug: string;
  placement: "index" | "inline" | "end" | "modal";
  onSuccess?: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<YoutubeForm>({
    resolver: zodResolver(youtubeSchema),
    defaultValues: { url: "" },
  });

  return (
    <form
      className="blog-url-form"
      noValidate
      onSubmit={handleSubmit(() => {
        track("article_cta_submit", { slug, placement });
        window.dispatchEvent(new CustomEvent("4short:notice"));
        onSuccess?.();
      })}
    >
      <div className="blog-url-form__field">
        <span className="youtube-icon" aria-hidden="true" />
        <Input
          aria-label="Ссылка на видео YouTube"
          aria-invalid={Boolean(errors.url)}
          className="blog-url-form__input"
          placeholder="Вставьте ссылку на YouTube"
          type="url"
          variant="secondary"
          {...register("url")}
        />
      </div>
      <Button className="blog-url-form__button" type="submit">
        Создать шортсы
        <ArrowRight size={17} aria-hidden="true" />
      </Button>
      {errors.url ? (
        <span className="blog-url-form__error" role="alert">
          {errors.url.message}
        </span>
      ) : null}
    </form>
  );
}
