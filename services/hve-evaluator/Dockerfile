FROM public.ecr.aws/docker/library/python:3.12.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HVE_EVALUATOR_MODE=1

# This is deliberately a separate evaluator image.  It is never used by the
# media-worker deployment or user request path: candidate models may consume
# the heavy slot only while producing signed HVE-G5 evidence.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg libgomp1 libglib2.0-0 tini \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --uid 10002 --create-home --home-dir /home/evaluator evaluator \
    && mkdir -p /var/lib/4short/evaluator/models /var/lib/4short/evaluator/output \
    && chown -R evaluator:evaluator /var/lib/4short/evaluator

WORKDIR /app
COPY services/hve-evaluator/pyproject.toml services/hve-evaluator/requirements.txt ./
RUN pip install --requirement requirements.txt
COPY services/hve-evaluator/src ./src
COPY services/media-worker/src/fourshort_worker ./src/fourshort_worker
RUN pip install --no-deps .

USER evaluator
VOLUME ["/var/lib/4short/evaluator/models", "/var/lib/4short/evaluator/output"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["fourshort-hve-active-speaker-candidate", "--help"]
