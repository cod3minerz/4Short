FROM public.ecr.aws/docker/library/python:3.12.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# Captions and final MP4 encoding are core HVE behavior. Fail the image build
# rather than shipping a distro FFmpeg variant that silently lacks libass or
# libx264 and discovering it only after a paid render starts.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl fontconfig fonts-dejavu-core libgomp1 libglib2.0-0 tini \
    && ffmpeg -hide_banner -filters 2>&1 | grep -Eq '(^|[[:space:]])ass([[:space:]]|$)' \
    && ffmpeg -hide_banner -encoders 2>&1 | grep -Eq 'libx264' \
    && rm -rf /var/lib/apt/lists/*

# YuNet is a compact OpenCV face detector. Pin the model artifact to the
# OpenCV Zoo 4.10.0 release instead of downloading changing `main` content.
RUN mkdir -p /opt/4short/models \
    && curl --fail --location --retry 3 \
      --output /opt/4short/models/face_detection_yunet_2023mar_int8.onnx \
      https://github.com/opencv/opencv_zoo/raw/4.10.0/models/face_detection_yunet/face_detection_yunet_2023mar_int8.onnx \
    && echo "321aa5a6afabf7ecc46a3d06bfab2b579dc96eb5c3be7edd365fa04502ad9294  /opt/4short/models/face_detection_yunet_2023mar_int8.onnx" | sha256sum --check \
    && chmod 0444 /opt/4short/models/face_detection_yunet_2023mar_int8.onnx

ENV FACE_DETECTOR_FINGERPRINT=321aa5a6afabf7ecc46a3d06bfab2b579dc96eb5c3be7edd365fa04502ad9294

RUN groupadd --system --gid 10001 worker \
    && useradd --system --uid 10001 --gid worker --create-home --home-dir /home/worker worker \
    && mkdir -p /var/lib/4short/jobs /var/lib/4short/models /var/lib/4short/reports \
    && chown -R worker:worker /var/lib/4short

WORKDIR /app
COPY services/media-worker/pyproject.toml services/media-worker/requirements.txt ./
RUN pip install --requirement requirements.txt
COPY services/media-worker/src ./src
RUN pip install --no-deps .

USER worker
VOLUME ["/var/lib/4short/jobs", "/var/lib/4short/models", "/var/lib/4short/reports"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["fourshort-worker"]
