FROM python:3.12.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --uid 10001 --create-home --home-dir /home/worker worker \
    && mkdir -p /var/lib/4short/jobs \
    && chown -R worker:worker /var/lib/4short

WORKDIR /app
COPY services/media-worker/pyproject.toml services/media-worker/requirements.txt ./
RUN pip install --requirement requirements.txt
COPY services/media-worker/src ./src
RUN pip install --no-deps .

USER worker
VOLUME ["/var/lib/4short/jobs"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["fourshort-worker"]
