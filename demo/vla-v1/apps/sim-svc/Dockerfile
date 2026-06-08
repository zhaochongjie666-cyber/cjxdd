FROM python:3.11-slim

# 中国区 apt 源
RUN sed -i 's|http://deb.debian.org|https://mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's|http://deb.debian.org|https://mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null || true

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先装依赖 (利用 layer cache)
COPY pyproject.toml ./
COPY ../../libs/vla-common /libs/vla-common
COPY ../../libs/vla-db /libs/vla-db
RUN pip install --no-cache-dir -e /libs/vla-common -e /libs/vla-db -e . \
    && pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ \
        fastapi uvicorn[standard] sqlalchemy pydantic pydantic-settings

# 再拷源码
COPY src /app/src
COPY migrations /app/migrations
COPY alembic.ini /app/alembic.ini

ENV PYTHONUNBUFFERED=1
ENV PATH=/app/src:$PATH

EXPOSE 8001

HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=20s \
    CMD curl -f http://localhost:8001/health || exit 1

CMD ["uvicorn", "vla.sim.main:app", "--host", "0.0.0.0", "--port", "8001"]
